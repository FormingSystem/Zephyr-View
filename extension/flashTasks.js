'use strict';

const vscode = require('vscode');
const path = require('node:path');
const {execFile} = require('node:child_process');
const exec = require('node:util').promisify(execFile);
const {FlashMetadata} = require('./flashMetadata');
const {executeAndWait} = require('./taskCompletion');
const {plan,command} = require('./media/flashPlan');
const {taskEnvironment} = require('./buildSetup');
const {profiles,findProgram} = require('./probeDiagnostics');
const {pathKey} = require('./hostExecutables');

function text(english,chinese) {return vscode.env.language.startsWith('zh') ? chinese : english;}

function toolsEnvironment(context,s,names) {
  const env = {...taskEnvironment(context,s)};
  const saved = s.flash?.tools || context.workspaceState.get('probeSupport.tools:'+s.folder.uri.toString(),{});
  const key = pathKey(env);
  const tools = names.map(id=>saved[id]).filter(tool=>typeof tool==='string' && path.isAbsolute(tool));
  env[key] = [...new Set(tools.map(tool=>path.dirname(tool))),env[key]].filter(Boolean).join(path.delimiter);
  return env;
}

async function selectWorkspaceTask(folder) {
  const tasks = (await vscode.tasks.fetchTasks()).filter(task =>
    task.scope?.uri?.toString() === folder.uri.toString() && task.execution &&
    (task.source==='Workspace' || ['shell','process'].includes(task.definition.type)));
  if (!tasks.length) {
    await vscode.window.showInformationMessage(text('Define a flashing task in this folder’s .vscode/tasks.json first.',
      '请先在本工程的 .vscode/tasks.json 中定义厂商烧写任务。'));
    return;
  }
  return (await vscode.window.showQuickPick(tasks.map(task=>({label:task.name,detail:task.detail,task})),{
    title:text('Select the workspace task that programs this board','选择用于烧写当前板的工程任务')}))?.task;
}

function taskPreview(task) {
  const step = task.execution;
  const value = part => typeof part === 'string' ? part : part?.value || '';
  if (step.commandLine) return step.commandLine;
  if (step.process || step.command) return command(value(step.process || step.command),(step.args || []).map(value));
  return task.detail || task.name;
}

async function flashOutcome(task,code) {
  if (code===0) {
    await vscode.window.showInformationMessage(text('Flash task completed successfully: ','烧写任务执行成功：')+task.name);
    return;
  }
  const open=text('Show task terminal','查看任务终端');
  const message=code===undefined
    ? text('Flash task ended without an exit code; it may have been stopped.','烧写任务已结束，未提供退出码，可能已中止。')
    : vscode.l10n.t('Firmware flashing exited with code {0}. Check the task output.',code);
  const action=code===undefined ? vscode.window.showWarningMessage(message,open) : vscode.window.showErrorMessage(message,open);
  if (await action !== open) return;
  const terminal=vscode.window.terminals.find(item=>item.name===task.name) ||
    vscode.window.terminals.find(item=>item.name.endsWith(task.name));
  if (terminal) terminal.show();
  else await vscode.commands.executeCommand('workbench.action.terminal.focus');
}

class FlashTasks {
  constructor(context, running) {
    this.context=context;
    this.running=running;
    this.metadata=new FlashMetadata();
  }

  async describe(s,fresh=false) {
    if (!vscode.workspace.isTrusted || !s.folder || !s.target.generated) return;
    const saved=this.context.workspaceState.get('probeSupport.tools:'+s.folder.uri.toString(),{});
    const dirs=[...(s.toolDirectories || [])];
    if (s.tools.python && path.isAbsolute(s.tools.python)) dirs.unshift(path.dirname(s.tools.python));
    const found=await Promise.all(Object.entries(profiles).filter(([,profile])=>profile.program)
      .map(async ([id,profile])=>[id,await findProgram(profile.program,saved[id],dirs)]));
    const tools=Object.fromEntries(found.filter(([,file])=>file));
    return this.metadata.describe(s,taskEnvironment(this.context,s),fresh,tools);
  }

  async probes(s) {
    const saved=this.context.workspaceState.get('probeSupport.tools:'+s.folder.uri.toString(),{});
    const {stdout}=await exec(s.flash?.tools?.pyocd || saved.pyocd || 'pyocd',['list','--json'],{
      env:toolsEnvironment(this.context,s,['pyocd']),cwd:s.folder.uri.fsPath,windowsHide:true,timeout:10000});
    const result=JSON.parse(stdout);
    if (!Array.isArray(result.boards)) throw Error(text('No pyOCD probe list was returned.','pyOCD 未返回探针列表。'));
    return result.boards.filter(probe=>typeof probe.unique_id==='string').map(probe=>({
      id:probe.unique_id,label:probe.description || probe.board_name || probe.unique_id}));
  }

  async act(s,selection,current,refresh,post) {
    if (!selection || !s.flash || selection.id!==s.flash.id || this.running.has(s.build.toString())) return;
    const op=selection.op;
    if (op==='run' || op==='task') return this.run(s,selection,op==='task',current,refresh);
    const request=plan(s.flash,selection);
    const runners=[...new Set(request.names)];
    if (op==='support') {
      await vscode.commands.executeCommand('zephyrWorkbench.probeSupport',runners.length===1?runners[0]:undefined);
      if (current()) await refresh();
      return;
    }
    if (op==='scan' && request.device && runners.length===1 && runners[0]==='pyocd') {
      const probes=await this.probes(s);
      if (!current()) return;
      await post({flashProbes:s.flash.id,probes});
      if (!probes.length) await vscode.window.showInformationMessage(text('No pyOCD probes found.','未发现 pyOCD 探针。'));
    }
  }

  async run(s, selection, workspaceTask, current, refresh) {
    const key=s.build.toString();
    if (!current() || !s.flash || selection?.id !== s.flash.id || this.running.has(key)) return;
    this.running.add(key);
    try {
      const task=await this.confirm(s,selection,workspaceTask,current);
      if (!task || !current()) return;
      const fresh=await this.describe(s,true);
      if (!current() || fresh?.id !== selection.id) {
        await vscode.window.showWarningMessage(text('The target or its firmware changed. Review the new preview.','目标或固件已变化，请重新核对预览。'));
        return;
      }
      const code=await executeAndWait(task,refresh);
      void flashOutcome(task,code);
    } finally {this.running.delete(key); await refresh();}
  }

  async confirm(s,selection,workspaceTask,current) {
    const model=s.flash;
    let task, preview;
    if (workspaceTask) {
      task=await selectWorkspaceTask(s.folder);
      if (!task || !current()) return;
      preview=task.name+'\n'+taskPreview(task);
    } else {
      const request=plan(model,selection);
      if (!request.args) return;
      const options={cwd:model.cwd,env:toolsEnvironment(this.context,s,request.names)};
      const execution=new vscode.ProcessExecution(model.west,request.args,options);
      task=new vscode.Task({type:'zephyrFlash'},s.folder,text('Flash firmware','烧写固件'),'Zephyr',execution);
      task.presentationOptions={reveal:vscode.TaskRevealKind.Always,panel:vscode.TaskPanelKind.Dedicated};
      const images=request.images.map((image,i)=>[image.name,image.board,request.names[i],
        ...(image.args?.[request.names[i]] || [])].join(' · '));
      const target=selection.device ? text('Device ID: ','设备 ID：')+selection.device :
        text('This runner selects the device. Verify the intended target is connected.','此运行器自行识别设备，请核对连接的目标。');
      preview=[...images,target,command(model.west,request.args)].join('\n');
    }
    const label=text('Flash firmware','烧写固件');
    const accepted=await vscode.window.showWarningMessage(text('Program the connected target?','确认向连接的目标写入固件？'),
      {modal:true,detail:preview},label);
    return accepted===label ? task : undefined;
  }
}
module.exports={FlashTasks,taskPreview};
