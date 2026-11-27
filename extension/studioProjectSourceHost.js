'use strict';

const path = require('node:path');
const vscode = require('vscode');
const {pickFile,resolveDirectory} = require('./fileDialogs');
const {read_source_document,source_pattern,source_suffixes,supports_source} = require('./sourceDocument');

const t = (zh,en) => vscode.env.language.startsWith('zh') ? zh : en;

function breakpoints_at(document) {
  return vscode.debug.breakpoints.filter(point => point instanceof vscode.SourceBreakpoint &&
    point.location.uri.toString() === document.uri.toString());
}

function contains_uri(root, uri) {
  if (root.scheme !== uri.scheme || root.authority !== uri.authority) return false;
  const relative = root.scheme === 'file' ? path.relative(root.fsPath,uri.fsPath) : path.posix.relative(root.path,uri.path);
  return relative !== '..' && !relative.startsWith('..'+(root.scheme==='file' ? path.sep : '/')) && !path.isAbsolute(relative);
}

/** Bind the studio source browser to documents explicitly opened in this window. */
class studio_project_sources {
  constructor(panel, design, target) {
    this.panel=panel;
    this.design=design;
    this.target=target;
    this.folder=vscode.workspace.getWorkspaceFolder?.(design.uri) || target.folder();
    this.request=0;
    this.listeners=[];
    panel.onDidDispose(()=>this.dispose());
  }

  listen() {
    if (this.listeners.length) return;
    const {workspace,debug} = vscode;
    this.listeners.push(
      workspace.onDidChangeTextDocument(e=>{
        if (this.active && e.document===this.document && e.contentChanges.length) this.schedule();
      }),
      workspace.onDidSaveTextDocument(d=>{if (d===this.document) this.render();}),
      workspace.onDidCloseTextDocument(d=>{
        if (d!==this.document) return;
        this.document=this.snapshot=undefined; this.render();
      }),
      debug.onDidChangeBreakpoints(()=>this.render(false))
    );
  }

  async handle(message) {
    if (this.disposed) return;
    if (message.op==='leave') {this.active=false; ++this.request; return;}
    if (!this.panel.visible) return;
    if (message.op==='enter') {
      this.listen(); this.active=true;
      if (!this.document) return this.select(false);
      return this.render();
    }
    if (!this.active) return;
    if (message.op==='pick') return this.select(true);
    if (message.op==='edit' || message.op==='breakpoint') return this.at_line(message);
  }

  application_root() {
    const folder=this.folder;
    if (!folder) return;
    const selection=this.target.selection;
    if (selection?.folder===folder.uri.toString() && selection.app) return resolveDirectory(folder.uri,selection.app);
    const preferred=vscode.workspace.getConfiguration('zephyrWorkbench',folder.uri).get('locations')?.application;
    return preferred ? resolveDirectory(folder.uri,preferred) : folder.uri;
  }

  async default_uri() {
    const app=this.application_root();
    const designRoot=['file','vscode-remote'].includes(this.design.uri.scheme) ? vscode.Uri.joinPath(this.design.uri,'..') : undefined;
    const roots=new Map();
    for (const root of [designRoot,app]) {
      if (!root || (app && root.toString()!==app.toString() && contains_uri(root,app))) continue;
      roots.set(root.toString(),root);
    }
    const editors=[vscode.window.activeTextEditor,...vscode.window.visibleTextEditors];
    for (const root of roots.values()) {
      const visible=editors.find(editor=>supports_source(editor?.document) && contains_uri(root,editor.document.uri));
      if (visible) return visible.document.uri;
      const main=vscode.Uri.joinPath(root,'src','main.c');
      if ((await vscode.workspace.fs.stat(main).catch(()=>null))?.type & vscode.FileType.File) return main;
    }
  }

  async choose_uri() {
    const browse = {label:t('浏览文件…','Browse files…'),alwaysShow:true};
    const root=this.application_root();
    const found = root ? await vscode.workspace.findFiles(new vscode.RelativePattern(root,source_pattern),
      '**/{.git,.west,.venv,node_modules,build,build-*}/**',200) : [];
    const visible = vscode.window.visibleTextEditors.filter(e=>supports_source(e.document)).map(e=>e.document.uri);
    const locations = new Map([...visible,...found].map(uri=>[uri.toString(),uri]));
    const files = Array.from(locations.values(), uri=>({label:path.basename(uri.path),
      description:vscode.workspace.asRelativePath(uri,(vscode.workspace.workspaceFolders?.length ?? 0)>1),uri}));
    files.sort((a,b)=>a.description.localeCompare(b.description));
    const choice = await vscode.window.showQuickPick([...files,browse],{
      placeHolder:t('按文件名或路径搜索源码','Search source files by name or path'),matchOnDescription:true});
    return choice===browse ? pickFile({defaultUri:root,filters:{'C / C++':source_suffixes}}) : choice?.uri;
  }

  async select(pick) {
    const ticket=++this.request;
    const uri = await (pick ? this.choose_uri() : this.default_uri());
    let document;
    if (uri) {
      try { document=await vscode.workspace.openTextDocument(uri); }
      catch (error) {
        if (ticket===this.request && this.active && !this.disposed) {
          void vscode.window.showWarningMessage(t('无法打开所选源码','Could not open the selected source')+' · '+error.message);
        }
        return;
      }
    }
    if (ticket!==this.request || !this.active || this.disposed) return;
    if (document && supports_source(document)) {
      if (document!==this.document) this.snapshot=undefined;
      this.document=document;
    }
    this.render();
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer=setTimeout(()=>this.render(),190);
  }

  render(read=true) {
    if (!this.active || this.disposed) return;
    if (this.document && (read || !this.snapshot)) {
      this.snapshot=read_source_document(this.document,this.snapshot);
    }
    const lines=this.document ? breakpoints_at(this.document).map(bp=>bp.location.range.start.line+1) : [];
    void this.panel.webview.postMessage({type:'projectSource', source:this.snapshot && {...this.snapshot,displayPath:vscode.workspace.asRelativePath(this.document.uri,false)},breakpoints:lines,
      trusted:vscode.workspace.isTrusted});
  }

  async at_line({op,uri,version,line}) {
    const doc=this.document;
    if (!doc || doc.isClosed || doc.uri.toString()!==uri || doc.version!==version ||
      !Number.isSafeInteger(line) || line<1 || line>doc.lineCount) return;
    const range=doc.lineAt(line-1).range;
    if (op==='edit') {
      const found=vscode.window.visibleTextEditors.find(editor=>editor.document===doc);
      return vscode.window.showTextDocument(doc,{viewColumn:found?.viewColumn ?? vscode.ViewColumn.Beside,selection:range,preview:false});
    }
    if (!vscode.workspace.isTrusted || !['file','vscode-remote'].includes(doc.uri.scheme)) return;
    const existing=breakpoints_at(doc).filter(bp=>bp.location.range.start.line===line-1);
    if (existing.length) vscode.debug.removeBreakpoints(existing);
    else vscode.debug.addBreakpoints([new vscode.SourceBreakpoint(new vscode.Location(doc.uri,range.start))]);
  }

  dispose() {
    this.disposed=true; ++this.request;
    clearTimeout(this.timer);
    this.listeners.splice(0).forEach(item=>item.dispose());
  }
}

module.exports={studio_project_sources};
