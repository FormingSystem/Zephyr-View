'use strict';

const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const execute = require('node:util').promisify(require('node:child_process').execFile);
const {sources,installerHost,hostPlan,systemPackage,localPackage,venvBinary} = require('./componentCatalog');
const {findProgram,hostBinDirectories,usableProgram} = require('./hostExecutables');
const {t,exists,directory,select,checkout,destination} = require('./installationDialogs');
const {taskEnvironment} = require('./buildSetup');
const {useInstalled} = require('./environment');
const {sdkPlan} = require('./sdkInstall');
const {pickFile} = require('./fileDialogs');
const busy = new Set();
const source = name => Object.hasOwn(sources,name) && vscode.env.openExternal(vscode.Uri.parse(sources[name]));
const official = t('打开官方下载页','Open official download page');

async function pythonPlan(s,name,activeVenv) {
  if(!s.tools.python)throw Error(t('请先安装或选择 Python 解释器','Install or select a Python interpreter first'));
  const requirements=name==='dependencies'&&checkout(s)&&path.join(checkout(s),'scripts','requirements-base.txt');
  if(name==='dependencies' && (!requirements || !await exists(requirements)))throw Error(t('请先配置包含 scripts/requirements-base.txt 的 Zephyr 源码目录','Select a Zephyr checkout containing scripts/requirements-base.txt first'));
  const mode=await select(t('安装 Python 包','Install Python packages'),[
    ['offline',t('本地 wheel 包目录（离线）','Local wheel directory (offline)')],
    ['online',t('从当前 pip 软件源安装','Install from the configured pip package index')] ]);
  if(!mode)return;
  const wheels=mode==='offline' && await directory(s,t('选择包含 .whl 的目录','Choose a directory containing .whl files'));
  if(mode==='offline'&&!wheels)return;
  const scope=await select(t('Python 虚拟环境','Python virtual environment'),[
    ...(activeVenv?[['active',t('使用当前虚拟环境','Use the current virtual environment')+' · '+activeVenv]]:[]),
    ['new',t('创建新环境','Create a new environment')],['existing',t('更新已有虚拟环境','Update an existing virtual environment')] ]);
  if(!scope)return;
  const location=scope==='active'?activeVenv:scope==='new'?await destination(s,'.venv'):await directory(s,t('选择包含 pyvenv.cfg 的目录','Choose a directory containing pyvenv.cfg'));
  if(!location)return;
  const args=[path.join(__dirname,'install_python.py'),'--destination',location];
  if(scope!=='new')args.push('--existing');
  if(wheels)args.push('--wheels',wheels);
  if(requirements)args.push('--requirements',requirements);
  return {steps:[{program:s.tools.python,args}],venv:location,patch:{python:venvBinary(location,'python')},
    detail:[requirements||'west',wheels||t('使用已配置的软件源（联网）','Use configured package index (network)'), '→ '+location].join('\n')};
}

async function hostInstaller(s,name,automatic) {
  const release=process.platform==='linux' ? await fs.readFile('/etc/os-release','utf8').catch(()=>'') : '';
  const {manager,formats,help}=installerHost(process.platform,release);
  const pkg=hostPlan(name,manager);
  const executable=pkg && await findProgram(manager==='winget'?'winget':pkg.program);
  if(automatic && executable)return packageInstaller(s,name,manager,executable,true);
  const choices=[];
  if(executable)choices.push(['package',t('用软件包管理器安装','Install with package manager')+' · '+manager]);
  if(formats.length)choices.push(['local',t('打开本地安装包','Open a local installer')+' (.'+formats.join(', .')+')…']);
  choices.push(['existing',t('选择已有程序…','Select an existing executable…')]);
  choices.push(['official',official]);
  if(help && !executable)choices.push(['manager',t('获取软件包管理器','Get package manager')+' · '+manager]);
  const mode=await select(name,choices);
  if(!mode)return;
  if(mode==='local')return localInstaller(s,name,formats);
  if(mode==='existing'){
    const file=await pickFile({defaultUri:s.folder.uri,title:name});
    if(!file)return;
    return {steps:[],host:{name,file:file.fsPath},detail:file.fsPath};
  }
  if(mode==='official'){await source(name);return;}
  if(mode==='manager'){await vscode.env.openExternal(vscode.Uri.parse(help));return;}
  return packageInstaller(s,name,manager,executable);
}

async function packageInstaller(s,name,manager,executable,defaults=false) {
  let location;
  if(!defaults && manager==='winget'&&['cmake','git','python'].includes(name)){
    const mode=await select(t('安装路径','Installation location'),[['default',t('使用安装程序默认位置','Installer default')],['custom',t('选择安装位置','Choose installation location')] ]);
    if(!mode)return;
    if(mode==='custom'){location=await destination(s,name);if(!location)return;}
  }
  const plan=hostPlan(name,manager,location);
  plan.program=executable;
  const step=['apt','dnf'].includes(manager)?systemPackage(plan,process.getuid()===0):plan;
  return {steps:[step],managed:true,host:{name,location,brew:manager==='brew'?executable:undefined},detail:[step.program+' '+step.args.join(' '),
    t('宿主机软件包管理器将联网安装，可能修改 PATH 并请求管理员授权。','The host package manager downloads packages and may update PATH or request administrator approval.')].join('\n')};
}

async function localInstaller(s,name,formats){
  const uri=await pickFile({defaultUri:s.folder.uri,title:t('选择此工具的官方安装包','Choose the official installer for this tool'),filters:{[name]:formats}});
  if(!uri)return;
  const extension=path.extname(uri.fsPath).slice(1).toLowerCase();
  if(!formats.includes(extension))throw Error(t('安装包格式与宿主机不匹配','Installer format does not match the host'));
  const step=localPackage(uri.fsPath,extension,process.getuid?.()===0);
  if(extension==='dmg')return {steps:[step],diskImage:true,detail:[uri.fsPath,
    t('打开磁盘映像，按映像中的说明安装。','Open the disk image and follow the installation instructions inside.')].join('\n')};
  return {steps:[step],host:{name},detail:[uri.fsPath,
    t('运行所选的本地安装程序。安装位置、联网行为和权限请求由该程序控制。','Run the selected local installer. It controls destination, network access and permission requests.')].join('\n')};
}

function osHost(){
  const os=require('node:os');
  return os.hostname()+' · '+os.platform()+' / '+os.machine();
}

async function verifyHost({name,location,brew,file},env) {
  const windows=process.platform==='win32';
  const executable=windows?name+'.exe':name==='python'?'python3':name;
  const directories=location?['','bin','cmd'].map(child=>path.join(location,child)):hostBinDirectories(env);
  if(!location && windows && env.LOCALAPPDATA)directories.push(path.join(env.LOCALAPPDATA,'Microsoft','WinGet','Links'));
  if(brew){
    const formula=name==='python'?'python3':name;
    const result=await execute(brew,['--prefix',formula],{env,timeout:10000}).catch(()=>undefined);
    const prefix=result?.stdout.trim();
    if(prefix)directories.unshift(path.join(prefix,'bin'));
  }
  const candidates=file?[file]:directories.filter(Boolean).map(dir=>path.join(dir.replace(/^"|"$/g,''),executable));
  for(const candidate of candidates){
    if(!await usableProgram(candidate,name,env,process.platform))continue;
    try{
      const result=await execute(candidate,name==='7z'?['i']:['--version'],{env,timeout:5000,windowsHide:true});
      const version=(result.stdout||result.stderr).trim().split(/\r?\n/).find(Boolean);
      if(version)return {file:candidate,version};
    }catch{ /* A PATH entry may be an unavailable launcher or a different program. */ }
  }
}

async function runStep(folder,env,title,step) {
  const id=randomUUID(),definition={type:'zephyrProvision',id};
  const task=new vscode.Task(definition,folder,title,'Zephyr',new vscode.ProcessExecution(step.program,step.args,{cwd:step.cwd||folder.uri.fsPath,env:{...env,...step.env}}));
  task.presentationOptions={reveal:vscode.TaskRevealKind.Always,panel:vscode.TaskPanelKind.Dedicated};
  const code = await require('./taskCompletion').executeAndWait(task);
  if (code === undefined) throw Error(t('任务已结束，未收到退出码','Task ended without an exit code'));
  if (code !== 0) throw Error(title+' · '+t('退出码','Exit code')+' '+code);
}

async function with_install_lock(folder,work) {
  const key=folder.uri.toString();
  if(busy.has(key)){void vscode.window.showInformationMessage(t('工作区已有安装任务','An installation is already active in this workspace'));return;}
  busy.add(key);
  try{return await work();}finally{busy.delete(key);}
}

async function install_one(context,s,name,current,options={}) {
  if(!Object.hasOwn(sources,name) || !current())return;
  try{
    const plan=name==='ZEPHYR_SDK_INSTALL_DIR'?await sdkPlan(context,s):
      ['west','dependencies'].includes(name)?await pythonPlan(s,name,options.activeVenv):await hostInstaller(s,name,options.automatic);
    if(!plan)return;
    const accept=plan.diskImage?t('打开映像','Open disk image'):plan.steps.length?t('安装','Install'):t('用于此工作区','Use in this workspace');
    if(!current())return;
    if(!(options.automatic && plan.managed) &&
      await vscode.window.showInformationMessage(name,{modal:true,detail:osHost()+'\n'+plan.detail},accept)!==accept)return;
    if(!current())return;
    const env=taskEnvironment(context,s);
    if(plan.newLocation && await exists(plan.newLocation))throw Error(t('安装目录已存在，请重新选择','The installation directory already exists. Choose a new location.')+' · '+plan.newLocation);
    for(const step of plan.steps)await runStep(s.folder,env,name,step);
    if(!current())return;
    if(plan.diskImage){
      void vscode.window.showInformationMessage(t('完成映像中的安装后，可在工具行选择已有程序。','After installing from the image, select the executable in the tool row.'));
      return;
    }
    if(plan.host){
      const tool=await verifyHost(plan.host,env);
      if(!current())return;
      if(!tool){
        void vscode.window.showWarningMessage(t('安装程序已退出。当前扩展进程尚未找到可运行的工具，请使用“配置”选择其程序，或重启 VS Code 后重新检测。','The installer exited. The executable is not available to this extension process. Select it with Configure or restart VS Code and detect again.')+
          (plan.host.location?' · '+plan.host.location:''));
        return;
      }
      await useInstalled(context,s.folder,{[name]:tool.file});
      if(!options.guided)void vscode.window.showInformationMessage(tool.version+' · '+tool.file);
      return true;
    }
    if(plan.sdkVersion){
      const actual=await fs.readFile(path.join(plan.patch.ZEPHYR_SDK_INSTALL_DIR,'sdk_version'),'utf8');
      if(actual.trim()!==plan.sdkVersion)throw Error(t('所选目录中的 SDK 版本与安装计划不符','The SDK version in the selected directory differs from the install plan'));
    }
    if(plan.venv && await exists(venvBinary(plan.venv,'west')))plan.patch.west=venvBinary(plan.venv,'west');
    if(plan.patch)await useInstalled(context,s.folder,plan.patch);
    if(!options.guided)void vscode.window.showInformationMessage(t('完成','Completed')+' · '+name);
    return true;
  }catch(error){
    if(await vscode.window.showErrorMessage(error.message,official)===official)await source(name);
  }
}
async function install(context,s,name,current) {
  if(!s.folder || !current())return;
  return with_install_lock(s.folder,()=>install_one(context,s,name,current));
}
module.exports={source,install,install_one,with_install_lock};
