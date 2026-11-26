'use strict';

const {localPackage,systemPackage} = require('./componentCatalog');

function deploymentMethod(id,platform=process.platform) {
  if(id==='pyocd')return 'python';
  if(id==='serial')return 'system';
  if(id==='stm32cubeprogrammer')return 'vendor';
  if(id==='jlink')return ({win32:'winget',darwin:'brew'})[platform] || 'vendor';
  if(id==='dfu-util')return ({win32:'portable',linux:'linuxPackage',darwin:'brew'})[platform] || 'vendor';
}

function packageStep(id,manager,program,asRoot=false) {
  if(id==='jlink' && manager==='winget')
    return {program,args:['install','--exact','--id','NordicSemiconductor.JLink','--source','winget']};
  if(id==='jlink' && manager==='brew')return {program,args:['install','--cask','segger-jlink']};
  if(id!=='dfu-util')return;
  if(manager==='brew')return {program,args:['install','dfu-util']};
  if(['apt','dnf'].includes(manager))return systemPackage({program,args:['install','dfu-util']},asRoot);
}

function installerFormats(id,platform=process.platform) {
  if(!['stm32cubeprogrammer','jlink'].includes(id))return [];
  if(platform==='win32')return ['exe'];
  if(platform==='darwin')return id==='jlink'?['pkg','dmg']:['app'];
  if(platform==='linux')return id==='jlink'?['deb','rpm']:['linux'];
  return [];
}

function localStep(id,file,format,platform,asRoot) {
  if(!installerFormats(id,platform).includes(format))return;
  if(format==='app')return {program:'/usr/bin/open',args:['-W',file]};
  if(format==='linux')return {program:file,args:[]};
  return localPackage(file,format,asRoot);
}

module.exports={deploymentMethod,packageStep,installerFormats,localStep};
