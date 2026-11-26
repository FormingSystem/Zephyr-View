'use strict';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const host = require('./hostExecutables');
const {windowsProbeInventory} = require('./windowsProbeInventory');
const exec = promisify(execFile);
const powershell = () => path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

const profiles = {
  pyocd: {label:'CMSIS-DAP · pyOCD', program:'pyocd', usb:/CMSIS.DAP|DAPLink/i,
    url:'https://pyocd.io/docs/installing.html', guide:'https://pyocd.io/docs/debug_probes.html'},
  stm32cubeprogrammer: {label:'ST-LINK · STM32CubeProgrammer', program:'STM32_Programmer_CLI', usb:/ST.?LINK/i,
    url:'https://www.st.com/en/development-tools/stm32cubeprog.html', guide:process.platform==='win32'?'https://www.st.com/en/development-tools/stsw-link009.html':'https://www.st.com/resource/en/user_manual/um2237-stm32cubeprogrammer-software-description-stmicroelectronics.pdf', signer:/STMicroelectronics/i},
  jlink: {label:'J-Link · SEGGER', program:process.platform==='win32'?'JLink':'JLinkExe', usb:/J.?Link|J.?Trace/i,
    url:'https://www.segger.com/downloads/jlink/', guide:'https://kb.segger.com/J-Link_Troubleshooting', signer:/SEGGER/i},
  'dfu-util': {label:'USB DFU · dfu-util', program:'dfu-util', usb:/\bDFU\b|STM32.{0,4}Bootloader/i,
    url:'https://dfu-util.sourceforge.net/', guide:'https://dfu-util.sourceforge.net/dfu-util.1.html'},
  serial: {label:'USB · UART / CDC ACM', usb:/\(COM\d+\)/i, url:'https://docs.zephyrproject.org/latest/develop/flash_debug/host-tools.html',
    guide:process.platform==='win32'?'https://learn.microsoft.com/en-us/windows-hardware/drivers/usbcon/usb-driver-installation-based-on-compatible-ids':'https://docs.zephyrproject.org/latest/hardware/peripherals/uart.html'}
};

function vendorDirectories(name,platform=process.platform,arch=process.arch,env=process.env) {
  const st = 'STMicroelectronics/STM32Cube/STM32CubeProgrammer';
  if (platform === 'win32') {
    const suffix = name==='JLink' ? 'SEGGER/JLink' : name==='STM32_Programmer_CLI' ? st+'/bin' : undefined;
    if (!suffix) return [];
    return [env.ProgramFiles,env['ProgramFiles(x86)']].filter(Boolean).map(root=>path.win32.join(root,suffix));
  }
  if (name === 'JLinkExe') return [platform === 'darwin' ? '/Applications/SEGGER/JLink' : '/opt/SEGGER/JLink'];
  if (name !== 'STM32_Programmer_CLI') return [];
  if (platform === 'linux') return [path.posix.join(os.homedir(),st,'bin'),'/opt/st/stm32cubeprogrammer/bin'];
  if (platform !== 'darwin') return [];
  const bundle = '/Applications/'+st+'/STM32CubeProgrammer.app/Contents/';
  const folders = arch==='arm64' ? ['Resources','MacOs','MacOS'] : ['MacOs','MacOS','Resources'];
  return folders.map(folder=>bundle+folder+'/bin');
}

async function findProgram(name, selected, extra=[], search) {
  if (!name) return;
  if (selected && path.isAbsolute(selected) && (process.platform!=='win32' || path.extname(selected).toLowerCase()==='.exe') &&
      await host.usableProgram(selected,name)) return selected;
  if (search !== undefined) return host.findProgram(name,{directories:[...extra,...search.split(path.delimiter)],includeHostPath:false});
  return await host.findProgram(name,{directories:extra}) || host.findProgram(name,{directories:vendorDirectories(name),includeHostPath:false});
}

function matchesWindowsDevice(row,profile) {
  const id = row.PNPDeviceID || '';
  if (profile === profiles.serial && !/^(USB|FTDIBUS)\\/i.test(id)) return false;
  // The STSW-LINK009 hardware IDs also identify interfaces without a configured driver name.
  if (profile === profiles.stm32cubeprogrammer && /^USB\\VID_0483&PID_(374[8ABDEF]|375[23])(?=[&\\]|$)/i.test(id)) return true;
  return profile.usb.test(row.Name || '');
}

function windowsDevices(rows,profile) {
  return [].concat(rows||[]).filter(row=>matchesWindowsDevice(row,profile)).map(row=>({
    name:row.Name,id:row.PNPDeviceID,
    status:row.ConfigManagerErrorCode===0?'present':row.ConfigManagerErrorCode===28?'driver': 'unknown',
    detail:row.ConfigManagerErrorCode?'PnP '+row.ConfigManagerErrorCode:undefined
  }));
}

async function accessStatus(id) {
  return fs.access(id,fs.constants.R_OK|fs.constants.W_OK).then(()=>'accessible',e=>e.code==='EACCES'?'permission':'unknown');
}

async function serialDevices(platform,directory='/dev') {
  const port = platform === 'darwin' ? /^cu\.(?!Bluetooth-Incoming-Port$|debug-console$).+/i : /^(ttyUSB|ttyACM)\d+$/;
  const names = (await fs.readdir(directory)).filter(name => port.test(name));
  return Promise.all(names.map(async name => {
    const id = path.join(directory,name);
    return {name,id,status:await accessStatus(id)};
  }));
}

async function linuxUsbDevices() {
  const root='/sys/bus/usb/devices';
  const names=await fs.readdir(root);
  const rows=await Promise.all(names.filter(name=>!name.includes(':')).map(async name=>{
    const read=key=>fs.readFile(path.join(root,name,key),'utf8').then(value=>value.trim(),()=>'');
    const [product,manufacturer,bus,dev]=await Promise.all(['product','manufacturer','busnum','devnum'].map(read));
    if (!bus || !dev) return;
    const id='/dev/bus/usb/'+bus.padStart(3,'0')+'/'+dev.padStart(3,'0');
    return {identity:manufacturer+' '+product, name:product||manufacturer,id,status:await accessStatus(id)};
  }));
  return rows.filter(Boolean);
}

function macUsbDevices(output) {
  const entries=[];
  let current;
  for (const line of output.split(/\r?\n/)) {
    const node = /^[| \t]*\+-o (.+?)\s+<class /.exec(line);
    if (node) {
      current = {location:node[1]};
      entries.push(current);
      continue;
    }
    const property = /^[| \t]*"USB (Product Name|Vendor Name|Serial Number)" = "(.*)"\s*$/.exec(line);
    if (current && property) current[property[1]]=property[2];
  }
  return entries.map(entry=>({
    identity:[entry.location,entry['Product Name'],entry['Vendor Name']].join(' '),
    name:entry['Product Name'] || entry.location, id:entry.location, status:'present',detail:entry['Serial Number']
  }));
}

async function legacyWindowsUsbDevices(run) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)',
    'Add-Type -LiteralPath $env:ZEPHYR_PROBE_READER',
    'ConvertTo-Json -InputObject @([WindowsProbeDevices]::Enumerate()) -Compress'
  ].join('\n');
  const env = {...process.env,ZEPHYR_PROBE_READER:path.join(__dirname,'WindowsProbeDevices.cs')};
  const {stdout} = await run(powershell(),['-NoProfile','-NonInteractive','-Command',script],
    {env,windowsHide:true,timeout:15000,maxBuffer:4096*1024});
  return JSON.parse(stdout);
}

async function usbMatcher(platform,run) {
  if (platform==='win32') {
    const rows=await windowsProbeInventory(run,legacyWindowsUsbDevices);
    return profile=>windowsDevices(rows,profile);
  }
  const rows=platform==='linux' ? await linuxUsbDevices() :
    macUsbDevices((await run('/usr/sbin/ioreg',['-p','IOUSB','-l','-w','0'],{timeout:10000,maxBuffer:4096*1024})).stdout);
  return profile=>rows.filter(row=>profile.usb.test(row.identity)).map(({identity,...device})=>device);
}

async function deviceReports(entries,getMatcher) {
  if (!entries.length) return [];
  try {
    const match=await getMatcher();
    return entries.map(([id,profile])=>[id,{devices:match(profile)}]);
  } catch (error) {
    return entries.map(([id])=>[id,{problem:error.message}]);
  }
}

async function inspectDeviceGroups(groups=profiles,platform=process.platform,run=exec) {
  const entries=Object.entries(groups);
  if (!['win32','darwin','linux'].includes(platform)) return Object.fromEntries(entries.map(([id])=>[id,{}]));
  const isPort=([,profile])=>platform!=='win32' && profile===profiles.serial;
  const [usb,ports]=await Promise.all([
    deviceReports(entries.filter(entry=>!isPort(entry)),()=>usbMatcher(platform,run)),
    deviceReports(entries.filter(isPort),async()=>{
      const ports=await serialDevices(platform);
      return ()=>ports;
    })
  ]);
  return Object.fromEntries([...usb,...ports]);
}

async function inspectDevices(profile,platform,run) {
  const {one}=await inspectDeviceGroups({one:profile},platform,run);
  if (one.problem) throw Error(one.problem);
  return one.devices;
}

async function verifyInstaller(file,profile) {
  if (process.platform!=='win32' || !profile.signer || path.extname(file).toLowerCase()!=='.exe') return false;
  const script='$s=Get-AuthenticodeSignature -LiteralPath $env:ZEPHYR_PROBE_INSTALLER; if ($s.Status -eq 0) { $s.SignerCertificate.Subject }';
  const {stdout}=await exec(powershell(),['-NoProfile','-NonInteractive','-Command',script],{
    windowsHide:true,timeout:15000,env:{...process.env,ZEPHYR_PROBE_INSTALLER:file}});
  return profile.signer.test(stdout);
}

module.exports={profiles,findProgram,inspectDevices,inspectDeviceGroups,serialDevices,vendorDirectories,windowsDevices,verifyInstaller};
