'use strict';

const vscode = require('vscode');
const path = require('node:path');
const {promisify} = require('node:util');
const {execFile} = require('node:child_process');
const {executeAndWait} = require('./taskCompletion');
const {profiles,findProgram,inspectDevices,verifyInstaller} = require('./probeDiagnostics');
const exec=promisify(execFile);
const tr=(cn,en)=>vscode.env.language.toLowerCase().startsWith('zh')?cn:en;
const pick=(label,description,action,detail)=>({label,description,action,detail});
const statusText=status=>({
  present:tr('系统已枚举','Enumerated by the OS'),accessible:tr('设备节点可读写','Device node is accessible'),
  permission:tr('访问权限不足','Permission denied'),driver:tr('未安装设备驱动（代码 28）','Device driver missing (code 28)'),
  unknown:tr('设备状态待核实','Device status unknown')
})[status];

function accessHint(id) {
  if(process.platform==='darwin')return tr('在搭载 Apple 芯片的 Mac 笔记本上，首次连接时解锁并允许 USB 配件。','On a Mac laptop with Apple silicon, unlock it and allow the USB accessory when prompted.');
  if(process.platform==='linux')return id==='serial'
    ?tr('核对串口设备的所属组和读写权限。','Check the serial device group and read/write permissions.')
    :tr('核对厂商的 udev 规则，应用规则后重新插拔探针。','Check the vendor’s udev rules and reconnect the probe after applying them.');
  const hints={
    pyocd:tr('CMSIS-DAP v1 使用 HID，v2 使用 WinUSB。','CMSIS-DAP v1 uses HID. Version 2 uses WinUSB.'),
    stm32cubeprogrammer:tr('ST-LINK 的 Windows 驱动包为 STSW-LINK009。','STSW-LINK009 provides ST-LINK drivers for Windows.'),
    jlink:tr('SEGGER 安装程序包含 J-Link 的 USB 驱动。','The SEGGER installer includes J-Link USB drivers.'),
    'dfu-util':tr('选择开发板的 DFU 接口并核对其 USB 驱动绑定。','Check the USB driver binding for the board’s DFU interface.'),
    serial:tr('标准 CDC ACM 使用系统 Usbser。USB 转串口桥可能需要厂商驱动。','CDC ACM uses Usbser. USB-to-UART bridges may need a vendor driver.')
  };
  return process.platform==='win32'?hints[id]:undefined;
}

async function chooseFile(folder,title,filters) {
  const files=await vscode.window.showOpenDialog({defaultUri:folder?.uri,title,filters,canSelectMany:false,canSelectFolders:false});
  return files?.[0]?.fsPath;
}

function runInstall(command,args,folder,label) {
  const task=new vscode.Task({type:'zephyrProbeInstall',id:require('node:crypto').randomUUID()},folder||vscode.TaskScope.Global,label,'Zephyr',
    new vscode.ProcessExecution(command,args));
  task.presentationOptions={reveal:vscode.TaskRevealKind.Always,panel:vscode.TaskPanelKind.Dedicated};
  return executeAndWait(task);
}

async function installation(id,profile,folder,python) {
  let program,args=[];
  if (id==='pyocd') {
    python ||= await chooseFile(folder,tr('选择目标虚拟环境的 Python','Select the target virtual environment’s Python'));
    if (!python) return;
    const {stdout}=await exec(python,['-I','-c','import sys; print(sys.prefix != sys.base_prefix)'],{windowsHide:true,timeout:5000});
    if (stdout.trim()!=='True')throw Error(tr('请选择虚拟环境中的 Python。','Select Python from a virtual environment.'));
    program=python;args=['-m','pip','install','pyocd'];
  } else if (id==='dfu-util' && process.platform==='linux') {
    const apt=await findProgram('apt-get',undefined,[]),sudo=await findProgram('sudo',undefined,[]);
    if (!apt || !sudo) return vscode.env.openExternal(vscode.Uri.parse(profile.url));
    program=sudo;args=[apt,'install','dfu-util'];
  } else if (id==='dfu-util' && process.platform==='darwin') {
    program=await findProgram('brew');
    if (!program) return vscode.env.openExternal(vscode.Uri.parse('https://formulae.brew.sh/formula/dfu-util'));
    args=['install','dfu-util'];
  } else {
    program=await chooseFile(folder,tr('选择厂商签名的安装程序','Select a vendor-signed installer'),{'Windows installer':['exe']});
    if (!program) return;
    if (!await verifyInstaller(program,profile))throw Error(tr('未能验证该安装程序的厂商签名。','Could not verify the expected vendor signature.'));
  }
  const install=tr('安装','Install');
  const choice=await vscode.window.showInformationMessage([program,...args].join(' '),{modal:true},install);
  if (choice!==install || !vscode.workspace.isTrusted) return;
  const code=await runInstall(program,args,folder,profile.label);
  if(code!==0)throw Error(tr('安装没有成功完成。请查看任务终端。','Installation did not finish successfully. See the task terminal.'));
  if(id==='pyocd')return findProgram(profile.program,undefined,[path.dirname(python)],'');
}

async function probeSupport(context,folder,runner) {
  const known=Object.hasOwn(profiles,runner)?runner:['esp32','mcumgr','bossac'].includes(runner)?'serial':undefined;
  let id=known;
  const toolsKey='probeSupport.tools:'+folder?.uri.toString();
  while (true) {
    if (!id) {
      const selected=await vscode.window.showQuickPick(Object.entries(profiles).map(([key,p])=>pick(p.label,'',key)),
        {title:tr('选择探针或传输方式','Choose a probe or transport')});
      if (!selected)return;
      id=selected.action;
    }
    const p=profiles[id], saved=context.workspaceState.get(toolsKey,{}),trusted=vscode.workspace.isTrusted;
    const python=require('./environment').overrides(context,folder)?.python;
    const dirs=python?[path.dirname(python)]:[];
    if(folder)dirs.push(path.join(folder.uri.fsPath,'.venv',process.platform==='win32'?'Scripts':'bin'));
    dirs.push(...require('./toolDirectories').searchDirectories(context,folder));
    const file=await findProgram(p.program,saved[id],dirs);
    let devices,problem;
    try {if(trusted) devices=await inspectDevices(p);}catch(e){problem=e.message;}
    const list=[];
    if(p.program)list.push(pick(p.program,file||tr('工具路径未找到','Tool path not found'),'tool',file?undefined:tr('选择本机已有的可执行文件','Choose an installed executable')));
    for(const d of devices||[])list.push(pick(d.name,statusText(d.status),'refresh',d.id+(d.detail?' · '+d.detail:'')));
    if(!devices?.length)list.push(pick(tr('探针或端口','Probe or port'),!trusted?tr('工作区未受信任','Workspace is untrusted'):
      problem?tr('无法读取系统设备','Could not read system devices'):devices?tr('未发现匹配设备','No matching device found'):tr('此主机暂不支持枚举','Device discovery unavailable on this host'),'refresh',problem));
    list.push(pick(tr('重新检测','Detect again'),'', 'refresh'),pick(tr('官方下载','Official download'),new URL(p.url).hostname,'download'),
      pick(tr('驱动及访问说明','Driver and access instructions'),new URL(p.guide).hostname,'guide',accessHint(id)));
    const canInstall=id==='pyocd' || (id==='dfu-util'&&['darwin','linux'].includes(process.platform)) || (p.signer&&process.platform==='win32');
    if(trusted && canInstall)list.push(pick(p.signer?tr('运行本地厂商安装程序…','Run local vendor installer…'):tr('安装工具…','Install tool…'),p.label,'install'));
    list.push(pick(tr('选择其他探针或传输方式','Choose another probe or transport'),'','profiles'));
    const choice=await vscode.window.showQuickPick(list,{title:p.label+' · '+(vscode.env.remoteName||process.platform),matchOnDescription:true});
    if(!choice)return;
    if(choice.action==='profiles'){id=undefined;continue;}
    if(choice.action==='download'||choice.action==='guide'){await vscode.env.openExternal(vscode.Uri.parse(choice.action==='guide'?p.guide:p.url));continue;}
    if(!vscode.workspace.isTrusted)continue;
    if(choice.action==='tool'){
      const selected=await chooseFile(folder,tr('选择已安装的工具','Choose installed tool'));
      if(selected && await findProgram(p.program,selected,[],'')===selected)await context.workspaceState.update(toolsKey,{...saved,[id]:selected});
    }
    if(choice.action==='install') {
      try {
        const installed=await installation(id,p,folder,python);
        if(typeof installed==='string')await context.workspaceState.update(toolsKey,{...saved,[id]:installed});
      }catch(e){await vscode.window.showErrorMessage(e.message);}
    }
  }
}

module.exports={probeSupport};
