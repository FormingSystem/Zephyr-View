'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {installerFormats,localStep,packageStep,deploymentMethod} = require('../extension/probeDeploymentPlans');

test('each probe separates managed deployment, vendor packages and the OS driver',()=>{
  for(const platform of ['win32','linux','darwin']){
    assert.equal(deploymentMethod('pyocd',platform),'python');
    assert.equal(deploymentMethod('serial',platform),'system');
    assert.equal(deploymentMethod('stm32cubeprogrammer',platform),'vendor');
    assert.equal(deploymentMethod('unknown',platform),undefined);
  }
  assert.deepEqual(['win32','linux','darwin'].map(os=>deploymentMethod('dfu-util',os)),['portable','linuxPackage','brew']);
  assert.deepEqual(['win32','linux','darwin'].map(os=>deploymentMethod('jlink',os)),['winget','vendor','brew']);
});

test('managed probe installs preserve the manager path, package and elevation boundary',()=>{
  assert.deepEqual(packageStep('jlink','winget','winget.exe').args,
    ['install','--exact','--id','NordicSemiconductor.JLink','--source','winget']);
  assert.deepEqual(packageStep('jlink','brew','/opt/homebrew/bin/brew').args,['install','--cask','segger-jlink']);
  for(const [manager,executable] of [['apt','/usr/bin/apt-get'],['dnf','/usr/bin/dnf']]){
    assert.deepEqual(packageStep('dfu-util',manager,executable),{program:'sudo',args:[executable,'install','dfu-util']});
    assert.deepEqual(packageStep('dfu-util',manager,executable,true),{program:executable,args:['install','dfu-util']});
  }
  assert.equal(packageStep('pyocd','brew','brew'),undefined);
});

test('local installers must match the selected vendor and OS and preserve paths as single arguments',()=>{
  assert.deepEqual(installerFormats('jlink','win32'),['exe']);
  assert.deepEqual(installerFormats('serial','linux'),[]);
  assert.deepEqual(localStep('stm32cubeprogrammer','/tmp/ST Programmer.linux','linux','linux',false),
    {program:'/tmp/ST Programmer.linux',args:[]});
  assert.deepEqual(localStep('stm32cubeprogrammer','/tmp/Setup Cube.app','app','darwin',false),
    {program:'/usr/bin/open',args:['-W','/tmp/Setup Cube.app']});
  assert.equal(localStep('stm32cubeprogrammer','/tmp/Setup.exe','exe','darwin',false),undefined);
});

test('pyOCD installs into a virtual environment and never runs pip with system Python',async t=>{
  const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
  const {venvBinary}=require('../extension/componentCatalog');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'probe-deployment-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const base=path.join(root,'project'),storage=path.join(root,'extension');
  const folder={uri:{fsPath:base,toString:()=>base}};
  const context={globalStorageUri:{fsPath:storage}};
  const system=path.join(root,'system-python'),local=venvBinary(path.join(base,'.venv'),'python');
  const venvs=new Set([local]),steps=[];
  const vscode={workspace:{isTrusted:true}};
  const target=require.resolve('../extension/probeDeployment');
  const Module=require('node:module'),load=Module._load;
  const modules={
    vscode,
    './probeDiagnostics':{profiles:{pyocd:{label:'pyOCD'}}},
    './installationDialogs':{t:(_,en)=>en},
    './fileDialogs':{},
    './buildSetup':{taskEnvironment:()=>({})},
    'node:child_process':{execFile(p,args,opts,cb){cb(null,{stdout:venvs.has(p)?'True':'False'});}},
    './componentInstall':{with_install_lock:(_,fn)=>fn(),async runStep(folder,env,label,step){
      steps.push(step);
      if(step.args.includes('pip')){
        const exe=path.join(path.dirname(step.program),process.platform==='win32'?'pyocd.exe':'pyocd');
        await fs.mkdir(path.dirname(exe),{recursive:true});
        await fs.writeFile(exe,'fixture',{mode:0o755});
      }
    }}
  };
  let api;
  try{
    Module._load=function(name,parent,...rest){
      if(parent?.filename===target && Object.hasOwn(modules,name))return modules[name];
      return load.call(this,name,parent,...rest);
    };
    api=require(target);
  }finally{Module._load=load;}
  t.after(()=>{delete require.cache[target];});
  const s={folder,tools:{python:system}};
  const result=await api.deployProbe(context,s,'pyocd');
  assert.equal(result.status,'installed');
  assert.deepEqual(steps,[{program:local,args:['-I','-m','pip','install','pyocd']}]);
  venvs.clear();steps.length=0;
  const managed=await api.deployProbe(context,s,'pyocd');
  assert.equal(steps.length,2);
  assert.deepEqual(steps[0].args.slice(0,3),['-I','-m','venv']);
  assert.equal(steps[0].program,system);
  assert.equal(steps[1].program,venvBinary(steps[0].args[3],'python'));
  assert.ok(path.relative(storage,managed.file).split(path.sep)[0]==='probes');
  steps.length=0;vscode.workspace.isTrusted=false;
  assert.equal(await api.deployProbe(context,s,'pyocd'),undefined);
  assert.deepEqual(steps,[]);
});

test('bundled Linux rules install offline, preserve local changes and reject altered source files',async t=>{
  const {driverMethod,stageRules}=require('../extension/probeDrivers');
  const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'zephyr-probe-rules-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  assert.equal(driverMethod('stm32cubeprogrammer','win32'),'stsw-link009');
  assert.equal(driverMethod('pyocd','linux'),'udev');
  assert.equal(driverMethod('serial','win32'),undefined);
  const target=path.join(root,'target');
  await fs.mkdir(target);
  const bad=path.join(root,'bad');
  await fs.mkdir(bad);
  await fs.writeFile(path.join(bad,'50-cmsis-dap.rules'),'changed');
  await assert.rejects(stageRules('pyocd',root,target,bad),/SHA-256/);
  for(const [id,count] of [['pyocd',1],['stm32cubeprogrammer',3]]){
    const prepared=await stageRules(id,root,target);
    assert.equal(prepared.length,count);
    for(const rule of prepared)await fs.copyFile(rule,path.join(target,path.basename(rule)));
    assert.deepEqual(await stageRules(id,root,target),[]);
  }
  const file=path.join(target,'50-cmsis-dap.rules');
  await fs.writeFile(file,'local admin');
  await assert.rejects(stageRules('pyocd',root,target),{code:'RULE_CONFLICT'});
  assert.equal(await fs.readFile(file,'utf8'),'local admin');
});

test('Windows stages only ST-LINK driver INFs using system signature enforcement',async t=>{
  const {stDriverFiles,windowsDriverStep}=require('../extension/probeDrivers');
  const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ST package with spaces-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  await Promise.all(['stlink_dbg_winusb.inf','stlink_bridge_winusb.inf','stlink_VCP.inf','other.inf','stlink_winusb_install.bat'].map(name=>fs.writeFile(path.join(dir,name),'')));
  const files=await stDriverFiles(dir);
  assert.equal(files.length,3);
  assert.ok(files.every(file=>path.extname(file)==='.inf' && path.basename(file)!=='other.inf'));
  const step=windowsDriverStep(files[0],'C:\\Windows');
  assert.match(step.env.ZEPHYR_PNP_UTIL,/Windows\\System32\\pnputil.exe$/);
  assert.equal(step.env.ZEPHYR_ST_INF,files[0]);
  assert.ok(!step.args.some(arg=>arg.includes(files[0])));
});
