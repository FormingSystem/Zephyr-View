'use strict';

const path = require('node:path');
const hostTools = {
  cmake: {url:'https://cmake.org/download/', winget:'Kitware.CMake', apt:'cmake', dnf:'cmake', brew:'cmake'},
  ninja: {url:'https://github.com/ninja-build/ninja/releases', winget:'Ninja-build.Ninja', apt:'ninja-build', dnf:'ninja-build', brew:'ninja'},
  git: {url:'https://git-scm.com/downloads', winget:'Git.Git', apt:'git', dnf:'git', brew:'git'},
  gperf: {url:'https://www.gnu.org/software/gperf/', winget:'oss-winget.gperf', apt:'gperf', dnf:'gperf', brew:'gperf'},
  wget: {url:'https://www.gnu.org/software/wget/', winget:'JernejSimoncic.Wget', apt:'wget', dnf:'wget', brew:'wget'},
  '7z': {url:'https://www.7-zip.org/download.html', winget:'7zip.7zip'},
  dtc: {url:'https://git.kernel.org/pub/scm/utils/dtc/dtc.git/', winget:'oss-winget.dtc', apt:'device-tree-compiler', dnf:'dtc', brew:'dtc'},
  python: {url:'https://www.python.org/downloads/', winget:'Python.Python.3.12',
    apt:['python3','python3-venv','python3-dev','python3-tk'], dnf:'python3', brew:['python3','python-tk']}
};
const sources = Object.freeze({
  ...Object.fromEntries(Object.entries(hostTools).map(([name,info])=>[name,info.url])),
  west:'https://pypi.org/project/west/',
  dependencies:'https://docs.zephyrproject.org/latest/develop/getting_started/index.html',
  ZEPHYR_SDK_INSTALL_DIR:'https://github.com/zephyrproject-rtos/sdk-ng/releases'
});

function linuxManager(osRelease) {
  const values = [...osRelease.matchAll(/^(?:ID|ID_LIKE)=(.*)$/gm)]
    .flatMap(match=>match[1].replace(/['"]/g,'').trim().toLowerCase().split(/\s+/));
  if (values.some(value=>['debian','ubuntu'].includes(value))) return 'apt';
  if (values.some(value=>['fedora','rhel'].includes(value))) return 'dnf';
}
function hostPlan(name, manager, location) {
  const tool = Object.hasOwn(hostTools,name) && hostTools[name];
  if (!tool || !Object.hasOwn(tool,manager) || !['apt','dnf','winget','brew'].includes(manager)) return;
  if (manager==='winget') {
    const args=['install','--exact','--id',tool.winget,'--source','winget'];
    if (location && ['cmake','git','python'].includes(name)) args.push('--location',location);
    return {program:'winget.exe',args};
  }
  const pkg=tool[manager];
  return {program:manager==='apt'?'apt-get':manager,args:['install',...[pkg].flat()]};
}
function installerHost(platform, release='') {
  if (platform==='darwin') return {manager:'brew',formats:['pkg','dmg'],help:'https://brew.sh/'};
  if (platform==='win32') return {manager:'winget',formats:['msi','exe'],help:'https://learn.microsoft.com/windows/package-manager/winget/'};
  const manager=platform==='linux' && linuxManager(release);
  if (manager) return {manager,formats:manager==='apt'?['deb']:['rpm']};
  return {formats:[]};
}

function systemPackage(step,asRoot) {
  return asRoot ? step : {program:'sudo',args:[step.program,...step.args]};
}

function localPackage(file,format,asRoot) {
  if (format==='pkg') return systemPackage({program:'/usr/sbin/installer',args:['-pkg',file,'-target','/']},asRoot);
  if (format==='dmg') return {program:'/usr/bin/open',args:[file]};
  if (format==='deb') return systemPackage({program:'apt-get',args:['install',file]},asRoot);
  if (format==='rpm') return systemPackage({program:'dnf',args:['install',file]},asRoot);
  if (format==='msi') return {program:'msiexec.exe',args:['/i',file]};
  if (format==='exe') {
    const command='$ErrorActionPreference="Stop"; $p=Start-Process -FilePath $env:ZEPHYR_LOCAL_INSTALLER -Wait -PassThru; exit $p.ExitCode';
    return {program:'powershell.exe',args:['-NoProfile','-NonInteractive','-Command',command],env:{ZEPHYR_LOCAL_INSTALLER:file}};
  }
  throw new Error('Unsupported installer format: '+format);
}
const sdkVersion = value => typeof value === 'string' && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(value);
function fullSdkBundles(names, version, host) {
  const prefix='zephyr-sdk-'+version+'_'+host;
  return names.filter(name=>name.startsWith(prefix) &&
    /^(?:_(?:gnu|llvm))?\.(?:tar\.(?:xz|gz|zst)|7z|zip)$/.test(name.slice(prefix.length)));
}
function listedSdk(output,version){
  let current;
  for(const line of output.split(/\r?\n/)){
    const header=/^(\S+):\s*$/.exec(line);
    if(header)current=header[1];
    const location=/^\s+path:\s*(.+)$/.exec(line);
    if(current===version && location)return location[1].trim();
  }
}
const venvBinary = (directory,name,windows=process.platform==='win32') =>
  path.join(directory,windows?'Scripts':'bin',windows?name+'.exe':name);
module.exports={sources,linuxManager,hostPlan,installerHost,systemPackage,localPackage,sdkVersion,fullSdkBundles,listedSdk,venvBinary};
