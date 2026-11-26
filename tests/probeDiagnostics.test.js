'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {profiles,windowsDevices,findProgram,inspectDevices,inspectDeviceGroups,serialDevices,vendorDirectories}=require('../extension/probeDiagnostics');

test('matches interfaces independently and reports only driver evidence supplied by the OS',()=>{
  const rows=[
    {Name:'ST-LINK Debug',PNPDeviceID:'a',ConfigManagerErrorCode:28},
    {Name:'STLINK Virtual COM Port (COM3)',PNPDeviceID:'USB\\port',ConfigManagerErrorCode:0},
    {Name:'CMSIS-DAP v2',PNPDeviceID:'c',ConfigManagerErrorCode:10},
    {Name:'STM32 BOOTLOADER',PNPDeviceID:'d',ConfigManagerErrorCode:0}
  ];
  const devices=id=>windowsDevices(rows,profiles[id]).map(d=>[d.id,d.status]);
  assert.deepEqual(devices('stm32cubeprogrammer'),[['a','driver'],['USB\\port','present']]);
  assert.deepEqual(devices('serial'),[['USB\\port','present']]);
  assert.deepEqual(devices('pyocd'),[['c','unknown']]);
  assert.deepEqual(devices('dfu-util'),[['d','present']]);
  assert.deepEqual(devices('jlink'),[]);
});

test('USB serial ports exclude Bluetooth and virtual COM devices; ST hardware IDs survive a missing driver',()=>{
  const port = id=>({Name:'Serial port (COM12)',PNPDeviceID:id,ConfigManagerErrorCode:0});
  const rows = [port('BTHENUM\\id'),port('ROOT\\port'),port('FTDIBUS\\port'),port('USB\\port')];
  assert.deepEqual(windowsDevices(rows,profiles.serial).map(device=>device.id),['FTDIBUS\\port','USB\\port']);
  const device = {Name:'USB Device',PNPDeviceID:'USB\\VID_0483&PID_374B&MI_00\\instance',ConfigManagerErrorCode:28};
  assert.equal(windowsDevices([device],profiles.stm32cubeprogrammer)[0].status,'driver');
  assert.deepEqual(windowsDevices([{...device,PNPDeviceID:'USB\\VID_0483&PID_374B0'}],profiles.stm32cubeprogrammer),[]);
});

test('Windows shares one native read and reports a failed scan separately from an empty bus',
  {skip:process.platform!=='win32'},async()=>{
    const {pyocd,serial}=profiles;
    let queries=0;
    const run=async(_program,_args,options)=>{
      queries++;
      await fs.access(options.env.ZEPHYR_PROBE_READER);
      return {stdout:JSON.stringify([
        {Name:'CMSIS-DAP',PNPDeviceID:'HID\\probe',ConfigManagerErrorCode:0},
        {Name:'USB UART (COM7)',PNPDeviceID:'USB\\port',ConfigManagerErrorCode:null}
      ])};
    };
    const matched=await inspectDeviceGroups({pyocd,serial},'win32',run);
    assert.equal(queries,1);
    assert.equal(matched.pyocd.devices[0].status,'present');
    assert.equal(matched.serial.devices[0].status,'unknown');
    const vacant=await inspectDeviceGroups({pyocd},'win32',async()=>({stdout:'[]'}));
    assert.deepEqual(vacant.pyocd,{devices:[]});
    const failed=await inspectDeviceGroups({pyocd},'win32',async()=>{throw Error('device provider unavailable');});
    assert.deepEqual(failed.pyocd,{problem:'device provider unavailable'});
});

test('resolves existing local tools in user selection, virtual environment, then PATH order',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'probe-tools-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const dirs=await Promise.all(['custom','venv','path'].map(async name=>{
    const dir=path.join(root,name);await fs.mkdir(dir);return dir;
  }));
  const filename='pyocd'+(process.platform==='win32'?'.exe':'');
  const paths=dirs.map(dir=>path.join(dir,filename));
  await Promise.all(paths.map(file=>fs.writeFile(file,'',{mode:0o700})));
  assert.equal(await findProgram('pyocd',paths[0],[dirs[1]],dirs[2]),paths[0]);
  assert.equal(await findProgram('pyocd','missing',[dirs[1]],dirs[2]),paths[1]);
  assert.equal(await findProgram('pyocd',undefined,[],dirs[2]),paths[2]);
  assert.equal(await findProgram('pyocd',undefined,[],''),undefined);
});

test('macOS reads USB probe identities even below a hub and leaves device access unconfirmed',async()=>{
  const stdout=[
    '+-o Root  <class IORegistryEntry, id 0x1>',
    '  +-o USB Hub@02000000  <class IOUSBHostDevice, id 0x2>',
    '    +-o ARM@02100000  <class IOUSBHostDevice, id 0x3>',
    '    |   "USB Product Name" = "CMSIS-DAP v2"',
    '    |   "USB Serial Number" = "0012"',
    '    +-o J-Link@02200000  <class IOUSBHostDevice, id 0x4>',
    '        "USB Vendor Name" = "SEGGER"'
  ].join('\n');
  const read=async(program,args)=>{
    assert.equal(program,'/usr/sbin/ioreg');
    assert.deepEqual(args,['-p','IOUSB','-l','-w','0']);
    return {stdout};
  };
  assert.deepEqual(await inspectDevices(profiles.pyocd,'darwin',read),[
    {name:'CMSIS-DAP v2',id:'ARM@02100000',status:'present',detail:'0012'}
  ]);
  assert.deepEqual(await inspectDevices(profiles.jlink,'darwin',read),[
    {name:'J-Link@02200000',id:'J-Link@02200000',status:'present',detail:undefined}
  ]);
  assert.deepEqual(await inspectDevices(profiles['dfu-util'],'darwin',read),[]);
});

test('vendor tool discovery follows the installed host architecture and Windows installation roots',()=>{
  const tool='STM32_Programmer_CLI';
  for (const [arch,folder] of [['arm64','Resources'],['x64','MacOs']]) {
    assert.ok(vendorDirectories(tool,'darwin',arch)[0].endsWith('/Contents/'+folder+'/bin'));
  }
  assert.deepEqual(vendorDirectories('JLinkExe','darwin'),['/Applications/SEGGER/JLink']);
  assert.deepEqual(vendorDirectories('JLink','win32','x64',{ProgramFiles:'Q:/Programs'}),
    [path.win32.join('Q:/Programs','SEGGER','JLink')]);
  assert.deepEqual(vendorDirectories('dfu-util','darwin'),[]);
});

test('macOS offers serial callout devices and Linux offers ttyUSB and ttyACM nodes',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'serial-ports-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const names=['cu.usbmodem12','tty.usbmodem12','cu.SLAB_USBtoUART','cu.debug-console','cu.Bluetooth-Incoming-Port','ttyACM0','ttyUSB2','tty0'];
  await Promise.all(names.map(name=>fs.writeFile(path.join(directory,name),'')));
  for (const [platform,expected] of [['darwin',['cu.SLAB_USBtoUART','cu.usbmodem12']],['linux',['ttyACM0','ttyUSB2']]]) {
    const ports=await serialDevices(platform,directory);
    assert.deepEqual(ports.map(port=>port.name).sort(),expected);
    assert.ok(ports.every(port=>port.status==='accessible'));
  }
});

test('the host can enumerate CMSIS-DAP and serial interfaces without a connected probe',
  {skip:!['win32','darwin','linux'].includes(process.platform)},async()=>{
    const reports = await inspectDeviceGroups();
    for (const id of Object.keys(profiles)) {
      assert.equal(reports[id].problem,undefined,id + ': ' + reports[id].problem);
      assert.ok(Array.isArray(reports[id].devices),id);
    }
});
