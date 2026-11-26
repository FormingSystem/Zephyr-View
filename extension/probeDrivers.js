'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {createHash} = require('node:crypto');

const bundled=path.join(__dirname,'vendor','pyocd-udev');
const rules={
  pyocd:{
    '50-cmsis-dap.rules':'adc2ab93a6a05773215210907d5d2cfcd8cf345ae62f94abcac24b3699bc00b2'
  },
  stm32cubeprogrammer:{
    '49-stlinkv2.rules':'e6d046a2cc09d2babe4e1c2d5aa2f38cad051e30163cb1d023218121988da3cc',
    '49-stlinkv2-1.rules':'69f0ced84674c57f328e061c50b0cc243cc87ed54a032eb83d4012cde2738fec',
    '49-stlinkv3.rules':'3686cf60338cf312017d6a176fb4d40b6b50dfb85fa246a3f0fcddffcfb3c788'
  }
};
const digest=data=>createHash('sha256').update(data).digest('hex');

function driverMethod(id,platform=process.platform) {
  if(platform==='linux' && Object.hasOwn(rules,id))return 'udev';
  if(platform==='win32' && id==='stm32cubeprogrammer')return 'stsw-link009';
}

async function stageRules(id,staging,destination,source=bundled) {
  const prepared=[];
  for(const [name,hash] of Object.entries(rules[id])){
    const target=path.join(destination,name);
    const existing=await fs.readFile(target).catch(error=>{if(error.code!=='ENOENT')throw error;});
    if(existing){
      if(digest(existing)!==hash)throw Object.assign(Error(target),{code:'RULE_CONFLICT',path:target});
      continue;
    }
    const bytes=await fs.readFile(path.join(source,name));
    if(digest(bytes)!==hash)throw Error('SHA-256 · '+name);
    const file=path.join(staging,name);
    await fs.writeFile(file,bytes,{flag:'wx'});
    prepared.push(file);
  }
  return prepared;
}

async function deployRules(id,{t,confirm,run,current,findSystem}) {
  const destination='/etc/udev/rules.d';
  const detail=t('pyOCD 官方规则允许本机用户读写匹配的 USB 探针。将安装到下列目录并重新载入 udev。','The upstream pyOCD rules allow local users to read and write matching USB probes. Install in this directory and reload udev.')+'\n'+destination;
  if(!await confirm(detail) || !current())return {status:'cancelled'};
  const commands=await Promise.all(['install','udevadm',...(process.getuid()===0?[]:['sudo'])].map(findSystem));
  if(commands.some(command=>!command))throw Error(t('此主机需要 install、udevadm 及管理员权限。','This host requires install, udevadm and administrator privileges.'));
  const [install,udevadm,sudo]=commands;
  const staging=await fs.mkdtemp(path.join(os.tmpdir(),'zephyr-udev-'));
  try{
    const files=await stageRules(id,staging,destination);
    const steps=[];
    for(const file of files)
      steps.push({program:install,args:['-D','-m','0644','--',file,path.join(destination,path.basename(file))]});
    steps.push({program:udevadm,args:['control','--reload-rules']});
    for(const step of steps){
      if(!current())return {status:'cancelled'};
      await run(sudo?{program:sudo,args:[step.program,...step.args]}:step);
    }
    return {status:'reconnect'};
  }catch(error){
    if(error.code==='RULE_CONFLICT')throw Error(t('已保留不同的本地 udev 规则，请核对文件后重试','Existing udev rule differs. Review the preserved file before retrying')+' · '+error.path);
    throw error;
  }finally{await fs.rm(staging,{recursive:true,force:true});}
}

async function stDriverFiles(directory) {
  const names=await fs.readdir(directory,{withFileTypes:true});
  return names.filter(entry=>entry.isFile() && /^stlink_(dbg_winusb|bridge_winusb|vcp)\.inf$/i.test(entry.name))
    .map(entry=>path.join(directory,entry.name)).sort();
}

function windowsDriverStep(file,systemRoot) {
  // PnPUtil verifies the INF against its signed driver catalog. Do not run scripts from the download.
  const root=path.win32.join(systemRoot,'System32');
  const script="$ErrorActionPreference='Stop'; $p=Start-Process -FilePath $env:ZEPHYR_PNP_UTIL -ArgumentList ('/add-driver \"{0}\" /install' -f $env:ZEPHYR_ST_INF) -Verb RunAs -PassThru -Wait; exit $p.ExitCode";
  return {program:path.win32.join(root,'WindowsPowerShell','v1.0','powershell.exe'),args:['-NoProfile','-NonInteractive','-Command',script],
    env:{ZEPHYR_PNP_UTIL:path.win32.join(root,'pnputil.exe'),ZEPHYR_ST_INF:file}};
}

module.exports={driverMethod,stageRules,deployRules,stDriverFiles,windowsDriverStep};
