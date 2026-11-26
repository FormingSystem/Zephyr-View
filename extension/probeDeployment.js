'use strict';

const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const exec = require('node:util').promisify(require('node:child_process').execFile);
const {createHash} = require('node:crypto');
const {deploymentMethod,packageStep,installerFormats,localStep} = require('./probeDeploymentPlans');
const {profiles,verifyInstaller} = require('./probeDiagnostics');
const {findProgram} = require('./hostExecutables');
const {venvBinary,linuxManager} = require('./componentCatalog');
const {with_install_lock,runStep} = require('./componentInstall');
const {pickFile,pickDirectory} = require('./fileDialogs');
const {t} = require('./installationDialogs');
const {taskEnvironment} = require('./buildSetup');
const {driverMethod,deployRules,stDriverFiles,windowsDriverStep} = require('./probeDrivers');

function deploymentActions(id,platform=process.platform) {
  const method=deploymentMethod(id,platform);
  const driver=driverMethod(id,platform);
  return {
    canDeploy:!!method && !['system','vendor'].includes(method),
    deployLabel:method==='vendor'?t('官方下载','Official download'):t('下载并部署','Download and install'),
    canInstallLocal:installerFormats(id,platform).length>0,
    canDeployDriver:!!driver,
    driverLabel:driver==='udev'?t('安装 USB 访问规则','Install USB access rules'):t('下载 ST-LINK 驱动','Download ST-LINK driver'),
    canInstallLocalDriver:driver==='stsw-link009'
  };
}

function storageDirectory(context,s) {
  const scope=createHash('sha256').update(s.folder.uri.toString()).digest('hex').slice(0,24);
  return path.join(context.globalStorageUri.fsPath,'probes',scope);
}

async function isVenv(python) {
  if(!python || !path.isAbsolute(python))return false;
  try {
    const {stdout}=await exec(python,['-I','-c','import sys; print(sys.prefix != sys.base_prefix)'],{windowsHide:true,timeout:5000});
    return stdout.trim()==='True';
  } catch {return false;}
}

function pythonRequired(s) {
  if(!s.tools?.python)throw Error(t('请先在工作区配置 Python，或选择已安装的探针工具目录。',
    'Configure Python in the workspace first, or select an existing probe tool directory.'));
  return s.tools.python;
}

async function pythonPlan(context,s) {
  const local=path.join(s.folder.uri.fsPath,'.venv');
  const managed=path.join(storageDirectory(context,s),'pyocd-venv');
  const options=new Set([s.tools?.python,venvBinary(local,'python'),venvBinary(managed,'python')]);
  let python;
  for(const candidate of options)if(await isVenv(candidate)){python=candidate;break;}
  const steps=[];
  if(!python){
    steps.push({program:pythonRequired(s),args:['-I','-m','venv',managed]});
    python=venvBinary(managed,'python');
  }
  steps.push({program:python,args:['-I','-m','pip','install','pyocd']});
  return {steps,file:path.join(path.dirname(python),process.platform==='win32'?'pyocd.exe':'pyocd')};
}

function portablePlan(context,s) {
  const directory=path.join(storageDirectory(context,s),'dfu-util-0.11');
  const architecture=process.arch==='x64'?'win64':'win32';
  return {steps:[{program:pythonRequired(s),args:[path.join(__dirname,'install_dfu.py'),directory,architecture]}],
    file:path.join(directory,'dfu-util.exe')};
}

async function managerPlan(id,method) {
  const manager=method==='linuxPackage'?linuxManager(await fs.readFile('/etc/os-release','utf8').catch(()=>'')):method;
  if(!manager)return {url:profiles[id].url};
  const executable=await findProgram(manager==='apt'?'apt-get':manager);
  if(!executable)return {url:profiles[id].url};
  const step=packageStep(id,manager,executable,process.getuid?.()===0);
  return {steps:[step]};
}

async function localPlan(s,id) {
  const formats=installerFormats(id);
  if(!formats.length)return;
  const profile=profiles[id];
  const uri=await pickFile({defaultUri:s.folder.uri,title:t('选择官方安装程序','Select the official installer'),
    filters:{[profile.label]:formats}});
  if(!uri)return;
  const file=uri.fsPath,format=path.extname(file).slice(1).toLowerCase();
  const step=localStep(id,file,format,process.platform,process.getuid?.()===0);
  if(!step)throw Error(t('安装包与当前平台不匹配','Installer does not match this platform'));
  if(format==='exe' && !await verifyInstaller(file,profile))
    throw Error(t('安装程序的厂商签名无效','The installer has an invalid vendor signature'));
  if(format==='linux')await fs.access(file,fs.constants.X_OK).catch(()=>{
    throw Error(t('此安装程序没有执行权限','This installer does not have execute permission')+' · '+file);
  });
  return {steps:[step],diskImage:format==='dmg'};
}

async function installPlan(context,s,id,action) {
  if(action==='localInstaller')return localPlan(s,id);
  if(action!=='deploy')return;
  const method=deploymentMethod(id);
  if(method==='vendor')return {url:profiles[id].url};
  if(method==='python')return pythonPlan(context,s);
  if(method==='portable')return portablePlan(context,s);
  if(['winget','brew','linuxPackage'].includes(method))return managerPlan(id,method);
}

async function openOfficial(url) {
  if(!await vscode.env.openExternal(vscode.Uri.parse(url)))
    throw Error(t('无法打开官方下载页','Could not open the official download page')+' · '+url);
  return {status:'external'};
}

async function installDriver(s,id,action,current) {
  const method=driverMethod(id);
  const title=profiles[id].label;
  const run=step=>runStep(s.folder,process.env,title,step);
  if(action==='driver' && method==='udev'){
    const accept=t('安装规则','Install rules');
    return deployRules(id,{t,current,run,
      confirm:async detail=>await vscode.window.showInformationMessage(title,{modal:true,detail},accept)===accept,
      findSystem:name=>findProgram(name,{directories:['/usr/bin','/usr/sbin','/bin','/sbin'],includeHostPath:false})});
  }
  if(method!=='stsw-link009')return;
  if(action==='driver')return openOfficial(profiles[id].guide);
  const directory=await pickDirectory({defaultUri:s.folder.uri,
    title:t('选择已解压的 STSW-LINK009 驱动目录（含 .inf 和 .cat）','Select the extracted STSW-LINK009 directory containing .inf and .cat files')});
  if(!directory || !current())return {status:'cancelled'};
  const files=await stDriverFiles(directory.fsPath);
  if(!files.length)throw Error(t('此目录中没有 ST-LINK 驱动 INF 文件。请解压 STSW-LINK009 并选择包含 INF 的目录。',
    'ST-LINK driver INF files were not found. Extract STSW-LINK009 and select the directory containing its INF files.'));
  let reboot=false;
  for(const file of files){
    if(!current())return {status:'cancelled'};
    const code=await runStep(s.folder,process.env,title,windowsDriverStep(file,process.env.SystemRoot),[0,3010]);
    if(code===3010)reboot=true;
  }
  return {status:reboot?'restart':'reconnect'};
}

async function deployProbe(context,s,id,action='deploy',current=()=>true) {
  const allowed=()=>vscode.workspace.isTrusted && current();
  if(!s.folder || !Object.hasOwn(profiles,id) || !allowed())return;
  return with_install_lock(s.folder,async()=>{
    if(action==='driver'||action==='localDriver')return installDriver(s,id,action,allowed);
    const plan=await installPlan(context,s,id,action);
    if(!plan || !allowed())return {status:'cancelled'};
    if(plan.url)return openOfficial(plan.url);
    const env=taskEnvironment(context,s);
    for(const step of plan.steps){
      if(!allowed())return {status:'cancelled'};
      await runStep(s.folder,env,profiles[id].label,step);
    }
    if(plan.diskImage)return {status:'diskImage'};
    if(plan.file)await fs.access(plan.file,fs.constants.X_OK).catch(()=>{
      throw Error(t('安装任务已退出，未找到预期的程序','Installation ended without the expected executable')+' · '+plan.file);
    });
    return {status:'installed',file:plan.file};
  });
}

module.exports={deploymentActions,deployProbe};
