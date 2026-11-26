'use strict';

const vscode = require('vscode');
const path = require('node:path');
const {FirmwareLog,encoding} = require('./firmwareLog');
const {randomBytes} = require('node:crypto');
const {pickFile, pickDirectory} = require('./fileDialogs');
const {program_source_preview} = require('./program_source_preview');
const {exportProgram, preview_program, inspectProgram, updateProgram, designFile, graphText, step_source_line} = require('./visualProgramFiles');
const model = require('./media/threadStudio/programModel');

const viewType = 'zephyrWorkbench.visualProgram';
const suffix = '.zephyr-program.json';
const zh = () => vscode.env.language.toLowerCase().startsWith('zh');
const say = (chinese, english) => zh() ? chinese : english;
const localFile = uri => uri.scheme === 'file' || uri.scheme === 'vscode-remote';
const commands = vscode.commands;
const {window, workspace, Uri} = vscode;

function decode(text) {
  if (text.length > 2 * 1024 * 1024) throw Error(say('设计文件超过 2 MiB。','The design exceeds 2 MiB.'));
  const graph = JSON.parse(text);
  const stack = [[graph,0]];
  while (stack.length) {
    const [item,depth] = stack.pop();
    if (!item || typeof item !== 'object') continue;
    if (depth > 32) throw Error(say('嵌套层级过深。请打开 JSON 检查设计。','The design is nested too deeply. Open the JSON to inspect it.'));
    for (const child of Object.values(item)) stack.push([child,depth+1]);
  }
  if (graph?.version !== 1 || !Array.isArray(graph.threads) || !Array.isArray(graph.objects)) {
    throw Error(say('无法识别此程序设计格式。可打开 JSON 检查版本和节点。','Unrecognized program format. Open the JSON to inspect the version and nodes.'));
  }
  return graph;
}

function replaceDocument(document, text) {
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(document.positionAt(0),document.positionAt(document.getText().length)),text);
  return workspace.applyEdit(edit);
}

function editorHtml(view, root) {
  const nonce = randomBytes(20).toString('hex');
  const asset = name => view.asWebviewUri(Uri.joinPath(root,'threadStudio',name));
  const scripts = ['model','programModel','ui','programFlow','programAuthoring','programReview','programCanvas','programInspector','programView','programTrace','programPlayback','programEditor'];
  const styles = ['programView','programPlayback','programEditor'];
  return `<!doctype html><html lang="${zh()?'zh-CN':'en'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${view.cspSource} data:; style-src ${view.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'">
${styles.map(s=>'<link rel="stylesheet" href="'+asset(s+'.css')+'">').join('')}
</head><body><header id="commands"></header><div id="feedback" role="status"></div><main id="designer"></main>
${scripts.map(s=>'<script nonce="'+nonce+'" src="'+asset(s+'.js')+'"></script>').join('')}</body></html>`;
}

class VisualProgramEditor {
  constructor(context, target) {
    this.context = context;
    this.target = target;
    this.root = Uri.joinPath(context.extensionUri,'media');
    this.recording = Uri.joinPath(context.extensionUri,'examples','visual-program');
    this.samples = new WeakMap();
    this.sessions = new Map();
    this.number = 0;
  }

  async open() {
    const folder = this.target.folder()?.uri;
    const key = folder?.toString() || '';
    const previous = this.sessions.get(key);
    if (previous && !previous.isClosed) return this.show(previous.uri);
    if (folder) {
      const project = Uri.joinPath(folder,designFile);
      if ((await workspace.fs.stat(project).catch(() => null))?.type === vscode.FileType.File) return this.show(project);
    }
    return this.create(model.starter());
  }

  async demo() {
    const read = async name => Buffer.from(await workspace.fs.readFile(Uri.joinPath(this.recording,name))).toString('utf8');
    const [graph,log] = await Promise.all([read('graph.json'),read('console.txt')]);
    return this.create(decode(graph), log);
  }

  async create(graph, log) {
    const folder = this.target.folder()?.uri;
    let uri;
    do {
      const name = 'program-' + (++this.number) + suffix;
      uri = folder ? Uri.joinPath(folder,name) : Uri.file(path.join(require('node:os').homedir(), name));
    } while (await workspace.fs.stat(uri).then(()=>true,()=>false) || workspace.textDocuments.some(d=>d.uri.path===uri.path));
    const document = await workspace.openTextDocument(uri.with({scheme:'untitled'}));
    if (!await replaceDocument(document, graphText(graph))) return;
    if (log) this.samples.set(document,log);
    this.sessions.set(folder?.toString() || '', document);
    return this.show(document.uri);
  }

  show(uri) { return commands.executeCommand('vscode.openWith',uri,viewType,{preview:false}); }

  async pick() {
    const uri = await pickFile({title:say('打开可视化程序设计','Open a visual program'),defaultUri:this.target.folder()?.uri,
      filters:{'Zephyr program':['zephyr-program.json','json']}});
    if (uri) await this.show(uri);
  }

  resolveCustomTextEditor(document, panel) {
    const web = panel.webview;
    web.options = {enableScripts:true, localResourceRoots:[this.root]};
    let disposed = false;
    const send = data => disposed ? Promise.resolve(false) : web.postMessage(data);
    const notice = message => send({notice:message});
    const follower = new FirmwareLog((text,options)=>send({type:'follow',text,options}),
      error=>{void send({type:'stopped'});void notice(errorMessage(error));});
    const update = force => {
      try { return send({type:'document',version:document.version,graph:decode(document.getText()),force,
        trusted:workspace.isTrusted,attached:localFile(document.uri) && path.basename(document.uri.fsPath) === designFile}); }
      catch (err) { return send({type:'invalid',message:err.message,version:document.version}); }
    };
    let queue = Promise.resolve();
    const handle = async m => {
      if (!m || typeof m.action !== 'string') return;
      if (disposed) return;
      if (m.action === 'ready') {
        await update(true);
        const text = this.samples.get(document);
        if (text) {this.samples.delete(document); await send({type:'trace',text,autoplay:true});}
        return;
      }
      if (m.action === 'stopFollow') {follower.stop();return send({type:'stopped'});}
      if (m.action === 'edit') {
        if (m.version !== document.version) return update(true);
        const text = graphText(m.graph);
        decode(text);
        if (text === document.getText() || !await replaceDocument(document,text)) return update(true);
        return;
      }
      if (!panel.active) return;
      if (m.action === 'text') return commands.executeCommand('vscode.openWith',document.uri,'default');
      if (m.action === 'save') return commands.executeCommand('workbench.action.files.save');
      if (m.action === 'copy') return commands.executeCommand('workbench.action.files.saveAs');
      if (m.action === 'open') return this.pick();
      if (m.action === 'new') return this.create(model.starter());
      if (m.action === 'demo') return this.demo();
      if (m.action === 'window') return commands.executeCommand('workbench.action.moveEditorToNewWindow');
      if (!workspace.isTrusted) return;
      if (m.action === 'trace' || m.action === 'follow') return this.readTrace(send,follower,m.action==='follow',()=>!disposed);
      if (m.version !== document.version) return update(true);
      if (m.action === 'source') return this.open_source(document,m);
      if (m.action === 'export') return this.export(document,notice);
      if (m.action === 'apply') return this.apply(document,notice);
    };
    let reviewing = false;
    const listener = web.onDidReceiveMessage(message => {
      const dispatch = async () => {
        if (message?.action !== 'apply') return handle(message);
        if (reviewing) return;
        reviewing = true;
        try { await handle(message); }
        finally { reviewing = false; }
      };
      const result = queue.then(dispatch).catch(async error => {
        if (message?.action === 'edit') await update(true);
        await notice(errorMessage(error));
      });
      // Keep document edits ordered while file pickers and diff reviews are open.
      if (message?.action === 'edit' || message?.action === 'ready') queue = result;
    });
    const changes = workspace.onDidChangeTextDocument(e=>{ if (e.document===document && e.contentChanges.length) void update(false); });
    panel.onDidDispose(()=>{disposed=true;follower.stop();changes.dispose();listener.dispose();});
    this.sessions.set(this.target.folder()?.uri.toString() || '',document);
    web.html = editorHtml(web,this.root);
  }

  async open_source(design, request) {
    if (!localFile(design.uri) || path.basename(design.uri.fsPath)!==designFile) return;
    const names = ['src/main.c','src/user_hooks.c','prj.conf','CMakeLists.txt'];
    if (!names.includes(request.file)) return;
    const uri = Uri.joinPath(design.uri,'..',request.file);
    const document = await workspace.openTextDocument(uri);
    const line = request.file==='src/main.c' ?
      step_source_line(decode(design.getText()),document.getText(),request.step,request.protocol) : undefined;
    const range = line ? document.lineAt(line-1).range : undefined;
    await window.showTextDocument(document,{preview:false,selection:range});
    if (request.file==='src/main.c' && request.step && !line) {
      void window.showInformationMessage(say('工程源码与图中预览不同，已打开实际文件。请审查源码更新后再按步骤定位。',
        'Project source differs from the preview. Review the source changes to enable step navigation.'));
    }
  }

  async export(document, notice) {
    const graph = decode(document.getText());
    const parent = await pickDirectory({title:say('选择新应用的父目录','Choose the parent folder for the new application'),defaultUri:this.target.folder()?.uri});
    if (!parent) return;
    const root = await exportProgram(parent.fsPath,graph);
    await notice(say('已生成应用 · ','Application created · ')+root);
    const open = say('在新窗口打开工程','Open project in new window');
    const edit = say('编辑导出的设计','Edit the exported design');
    const choice = await window.showInformationMessage(say('可视化工程已导出。','Visual application exported.'),edit,open);
    if (choice === edit) await this.show(Uri.file(path.join(root,designFile)));
    if (choice === open) await commands.executeCommand('vscode.openFolder',Uri.file(root),true);
  }

  async apply(document, notice) {
    if (!localFile(document.uri)) return;
    const graph = decode(document.getText()), version = document.version;
    const proposal = await preview_program(document.uri.fsPath,graph);
    const dirty_source = () => workspace.textDocuments.find(d => localFile(d.uri) && d.isDirty &&
      path.relative(d.uri.fsPath,proposal.target)==='');
    const dirty = dirty_source();
    if (!dirty && !proposal.changed) {
      await notice(say('生成的源码已与设计一致。','Generated source already matches this design.'));
      return;
    }
    this.previews ??= new program_source_preview(this.context);
    const review = await this.previews.show(dirty?.getText() ?? proposal.original,proposal.next,
      say('src/main.c · 当前源码 ↔ 设计生成','src/main.c · Current source ↔ Generated design'));
    const return_to_design = async () => {
      await review.close();
      if (!document.isClosed) await this.show(document.uri);
    };
    const stale = async () => {
      await return_to_design();
      void window.showWarningMessage(say('设计或源码已经改变，请重新审查差异。','The design or source has changed. Review a fresh diff.'));
    };
    const back = say('返回设计','Back to design');
    if (dirty || proposal.edited) {
      const message = say('当前源码包含手工修改。可对照差异，或返回设计导出新副本。',
        'The current source has local edits. Review the diff, or return to the design to export a copy.');
      if (await window.showWarningMessage(message,back)===back) await return_to_design();
      return;
    }
    const apply = say('应用已审查的修改','Apply reviewed changes');
    const prompt = say('应用差异将保存设计并更新 src/main.c。','Applying this diff saves the design and updates src/main.c.');
    const choice = await window.showInformationMessage(prompt,apply,back);
    if (choice===back) return return_to_design();
    if (choice!==apply) return;
    if (document.isClosed || document.version!==version || dirty_source()) {
      return stale();
    }
    try {
      const current = await inspectProgram(document.uri.fsPath,graph);
      if (current.original!==proposal.original) throw Object.assign(Error(),{code:'SOURCE_EDITED'});
      if (document.isClosed || document.version!==version || dirty_source()) return stale();
      if (!await document.save()) return;
      if (document.version!==version || dirty_source()) return stale();
      await updateProgram(document.uri.fsPath,graph,proposal);
    } catch (error) {
      if (error.code === 'SOURCE_EDITED') return stale();
      throw error;
    }
    await return_to_design();
    await notice(say('已更新 src/main.c，可重新构建。','Updated src/main.c. Rebuild to run the changes.'));
  }

  async readTrace(send,follower,follow,active) {
    const file = await pickFile({title:follow ? say('跟踪正在写入的固件日志','Follow a live firmware log') : say('打开固件运行日志','Open a firmware trace log'),defaultUri:this.target.folder()?.uri,
      filters:{'Trace log':['log','txt','trace'],'All files':['*']}});
    if (!file || !active()) return;
    if (follow && localFile(file)) return follower.start(file.fsPath);
    follower.stop();
    await send({type:'stopped'});
    const stat = await workspace.fs.stat(file);
    if (stat.size > 4 * 1024 * 1024) throw Error(say('请选择 4 MiB 以内的采集片段。','Choose a trace segment up to 4 MiB.'));
    const bytes = Buffer.from(await workspace.fs.readFile(file));
    return send({type:'trace',name:path.basename(file.fsPath),text:bytes.toString(encoding(bytes))});
  }
}

function errorMessage(error) {
  if (error.code === 'SOURCE_EDITED') return say('设计或生成源码已被修改。请先保存手工编辑，再导出新副本比较。','The design or source changed. Save your edits and export a fresh copy to compare.');
  if (error.code === 'NOT_GENERATED_PROJECT' || error.code === 'ENOENT') return say('找不到本设计生成的源码。请先导出新应用。','Generated source was not found for this design. Export a new application first.');
  if (error.code === 'EEXIST') return say('目标已存在或正被更新。请另选目录或稍后重试。','The destination exists or an update is in progress. Choose another directory or retry.');
  return error.message;
}

function registerVisualProgram(context, target) {
  const editor = new VisualProgramEditor(context,target);
  context.subscriptions.push(window.registerCustomEditorProvider(viewType,editor,{webviewOptions:{retainContextWhenHidden:true}}),
    commands.registerCommand('zephyrWorkbench.visualProgram',()=>editor.open()),
    commands.registerCommand('zephyrWorkbench.openVisualFile',()=>editor.pick()));
}

module.exports = {registerVisualProgram, viewType};
