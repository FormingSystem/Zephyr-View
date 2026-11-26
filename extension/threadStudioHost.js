'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const {pickDirectory} = require('./fileDialogs');
const {path:displayPath} = require('./media/pathDisplay');
const {analyzeApplication, fingerprint} = require('./threadAnalysis');
const {generate} = require('./media/threadStudio/model');
const {ThreadDebug} = require('./threadDebug');

const say = (zh,en) => vscode.env.language.startsWith('zh') ? zh : en;

/** Create a fresh child of the selected folder. A concurrent export cannot overwrite an existing project. */
async function exportDraft(parent, draft) {
  const files = generate(draft);
  const project = path.join(parent,'zephyr-threads-'+draft.kind);
  await fs.mkdir(project);
  const written = [];
  try {
    await fs.mkdir(path.join(project,'src'));
    for (const [name,content] of Object.entries(files)) {
      const file = path.join(project,name);
      await fs.writeFile(file,content,{flag:'wx'});
      written.push([file,content]);
    }
    return project;
  } catch (error) {
    for (const [file,content] of written) {
      if (await fs.readFile(file,'utf8').catch(()=>null) === content) await fs.unlink(file).catch(()=>{});
    }
    await fs.rmdir(path.join(project,'src')).catch(()=>{});
    await fs.rmdir(project).catch(()=>{});
    throw error;
  }
}

class ThreadStudioHost {
  constructor(post, isCurrent) {
    this.post = post;
    this.isCurrent = isCurrent;
    this.sequence = 0;
    this.generation = 0;
    this.runtime = new ThreadDebug(vscode.debug, () => {
      if (this.active()) this.post({debug:this.runtime.snapshot(this.state.folder)});
    });
  }

  active() { return Boolean(this.state && this.isCurrent(this.scope)); }

  enter(state, scope) {
    if (this.scope !== scope) this.leave();
    this.state = state;
    this.scope = scope;
    return {application:state.setup.app, workspace:state.folder?.uri.fsPath, trusted:vscode.workspace.isTrusted,
      analysis:this.result?.data, debug:this.runtime.snapshot(state.folder)};
  }

  leave() {
    this.generation++;
    this.state = this.scope = this.result = undefined;
  }

  async handle(m) {
    if (!this.active() || !vscode.workspace.isTrusted) return;
    const state = this.state, generation = this.generation;
    const current = () => this.generation === generation && this.active();
    if (m.action === 'launch') return vscode.commands.executeCommand('zephyrWorkbench.launch');
    if (m.action === 'debug') return this.runtime.request(state.folder,m.op,m.id,m.token);
    if (m.action === 'export') return this.export(state,m.draft,current);
    if (m.action === 'source') return this.openSource(m.id,current);
    if (m.action !== 'analyze' || !state.setup.app) return;
    const request = ++this.sequence;
    const latest = () => current() && request === this.sequence;
    const build = state.setup.cacheStatus === 'current' && state.target?.buildDir?.fsPath;
    const result = await analyzeApplication(state.setup.app,build,!vscode.env.language.startsWith('zh'),latest);
    if (result && latest()) {
      this.result = result;
      this.post({analysis:result.data});
    }
  }

  async openSource(id,current) {
    const row = this.result?.locations.get(id);
    if (!row) return;
    const canonical = await fs.realpath(row.file).catch(() => null);
    const disk = canonical === row.file && await fs.readFile(canonical,'utf8').catch(() => null);
    if (!current()) return;
    if (typeof disk !== 'string' || fingerprint(disk) !== row.digest) {
      this.post({notice:say('源码已改变或移动，请重新分析。','Source changed or moved. Analyze again.')});
      return;
    }
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(canonical));
    if (doc.isDirty || !current()) {
      if (current()) this.post({notice:say('源码已修改，请保存后重新分析。','Source changed. Save and analyze again.')});
      return;
    }
    const pos = new vscode.Position(row.line-1,0);
    return vscode.window.showTextDocument(doc,{selection:new vscode.Range(pos,pos),viewColumn:vscode.ViewColumn.Beside,preview:true});
  }

  async export(state,draft,current) {
    const parent = await pickDirectory({title:say('选择新线程工程的父目录','Select a parent folder for the new thread project'),defaultUri:state.folder?.uri});
    if (!parent || !current()) return;
    let root;
    try {root = await exportDraft(parent.fsPath,draft);}
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (current()) this.post({notice:say('同名工程已存在，请另选父目录。','This project already exists. Select another parent folder.')});
      return;
    }
    if (current()) this.post({notice:say('已生成工程：','Created project: ')+displayPath(root)});
    const open = say('在新窗口打开','Open in New Window');
    if (await vscode.window.showInformationMessage(say('线程工程已保存到 ','Thread project saved to ')+displayPath(root),open) === open)
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(root), true);
  }

  dispose() {this.leave(); this.runtime.dispose();}
}

module.exports = {ThreadStudioHost,exportDraft};
