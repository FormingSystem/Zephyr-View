'use strict';

const path = require('node:path');
const vscode = require('vscode');
const {pickFile,resolveDirectory} = require('./fileDialogs');
const {studio_header_graph} = require('./studioHeaderGraph');
const {containingCheckout} = require('./checkout');
const {export_class_diagram} = require('./studioClassExport');
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
    this.headers=new studio_header_graph(vscode,()=>this.schedule());
    panel.onDidDispose(()=>this.dispose());
  }

  listen() {
    if (this.listeners.length) return;
    const {workspace,debug} = vscode;
    this.listeners.push(
      workspace.onDidChangeTextDocument(e=>{
        if (this.active && e.contentChanges.length && this.affects(e.document)) this.schedule(e.document!==this.document);
      }),
      workspace.onDidSaveTextDocument(d=>{if (this.active && this.affects(d)) this.schedule(d!==this.document);}),
      workspace.onDidCloseTextDocument(d=>{
        if (d!==this.document) {if (this.active && this.headers.affects(d.uri)) this.schedule();return;}
        this.headers.reset();
        this.document=this.snapshot=this.localSnapshot=undefined; this.render();
      }),
      debug.onDidChangeBreakpoints(()=>this.render(false))
    );
    const refresh=()=>{if (this.active) this.schedule();};
    if (this.target.onDidRefreshTarget) this.listeners.push(this.target.onDidRefreshTarget(refresh));
    if (workspace.onDidChangeConfiguration) this.listeners.push(workspace.onDidChangeConfiguration(e=>{
      if (e.affectsConfiguration('zephyrWorkbench',this.folder?.uri)) refresh();
    }));
  }

  async handle(message) {
    if (this.disposed) return;
    if (message.op==='leave') {this.active=false; ++this.request; this.headers.reset(); return;}
    if (!this.panel.visible) return;
    if (message.op==='enter') {
      this.listen(); this.active=true;
      if (!this.document) return this.select(false);
      return this.render();
    }
    if (!this.active) return;
    if (message.op==='leaveHeader') return this.headers.leave_header();
    if (message.op==='revealHeader') return this.reveal_header(message);
    if (message.op==='pick') return this.select(true);
    if (message.op==='exportClassDiagram') return this.export_diagram(message);
    if (message.op==='edit' || message.op==='breakpoint') return this.at_line(message);
  }

  export_diagram({uri,version,graphRevision}) {
    const doc=this.document, ticket=this.request;
    if (!doc) return;
    const current_graph=()=>{
      if (this.disposed || !this.active || ticket!==this.request || doc!==this.document ||
          doc.isClosed || doc.uri.toString()!==uri || doc.version!==version) return;
      const snapshot=this.snapshot;
      if (snapshot?.issue || snapshot?.version!==version || snapshot.graphRevision!==this.headers.revision) return;
      if (graphRevision!==undefined ? graphRevision===snapshot.graphRevision : !this.headers.lines?.size) return snapshot.graph.class_diagram;
    };
    return export_class_diagram(vscode,doc.uri,current_graph,t);
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
      if (document!==this.document) {this.headers.reset();this.localSnapshot=this.snapshot=undefined;}
      this.document=document;
    }
    return this.render();
  }

  affects(document) {return document===this.document || this.headers.affects(document.uri);}

  schedule(dependencies=true) {
    this.headers.invalidate(dependencies);
    clearTimeout(this.timer);
    this.timer=setTimeout(()=>this.render(),190);
  }

  async header_context() {
    const folder=this.folder, doc=this.document;
    const selection=this.target.selection;
    const selected=folder && selection?.folder===folder.uri.toString() && selection.source;
    const configured=folder?.uri.scheme==='file' && this.target.context ?
      require('./workspace').explicitSource(folder,this.target.context) :
      folder && vscode.workspace.getConfiguration('zephyrWorkbench',folder.uri).get('locations')?.ZEPHYR_BASE;
    const enclosing=doc.uri.scheme==='file' && await containingCheckout(path.dirname(doc.uri.fsPath));
    const zephyrBase=enclosing ? vscode.Uri.file(enclosing) : folder && (selected || configured) ?
      resolveDirectory(folder.uri,selected || configured) : undefined;
    return {folder,application:this.application_root(),build:folder && await this.target.buildDir?.(folder),zephyrBase};
  }

  async render(read=true) {
    if (!this.active || this.disposed) return;
    if (this.document && read) {
      const doc=this.document;
      if (this.localSnapshot?.current!==doc.version || this.localSnapshot.dirty!==doc.isDirty)
        this.localSnapshot=read_source_document(doc,this.localSnapshot);
      const source=await this.headers.analyze(this.localSnapshot,doc,()=>this.header_context());
      if (!source || !this.active || this.disposed || doc!==this.document) return;
      if (source.issue && this.snapshot?.graph) source.graph=this.snapshot.graph;
      this.snapshot=source;
    }
    if (this.document && this.snapshot?.graphRevision!==this.headers.revision) return;
    const lines=this.document ? breakpoints_at(this.document).map(bp=>bp.location.range.start.line+1) : [];
    void this.panel.webview.postMessage({type:'projectSource', source:this.snapshot && {...this.snapshot,displayPath:vscode.workspace.asRelativePath(this.document.uri,false)},breakpoints:lines,
      trusted:vscode.workspace.isTrusted});
    if (!read) this.post_header();
  }

  async reveal_header({uri,version,graphRevision,file,line,navigationId}) {
    if (!this.document || this.snapshot?.issue || uri!==this.document.uri.toString() ||
        version!==this.document.version || graphRevision!==this.headers.revision ||
        this.snapshot?.graphRevision!==graphRevision || !Number.isSafeInteger(navigationId)) return;
    if (await this.headers.reveal(file,line,navigationId)) this.post_header();
  }

  post_header() {
    const current=this.headers.displayed;
    if (!current || current.doc.isClosed || current.version!==current.doc.version) return;
    const {doc,line,navigationId}=current;
    void this.panel.webview.postMessage({type:'projectHeader',rootUri:this.document.uri.toString(),
      graphRevision:this.headers.revision,navigationId,line,trusted:vscode.workspace.isTrusted,
      breakpoints:breakpoints_at(doc).map(bp=>bp.location.range.start.line+1),
      source:{uri:doc.uri.toString(),name:path.posix.basename(doc.uri.path),text:doc.getText(),current:doc.version,
        dirty:doc.isDirty,displayPath:vscode.workspace.asRelativePath(doc.uri,false)}});
  }

  async at_line({op,uri,version,line,rootUri,graphRevision}) {
    let doc=this.document;
    if (doc && uri!==doc.uri.toString()) {
      if (rootUri!==doc.uri.toString() || graphRevision!==this.headers.revision ||
          !vscode.workspace.isTrusted || this.headers.displayed?.version!==version) return;
      doc=this.headers.displayed?.doc;
    }
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
    this.headers.reset();
    clearTimeout(this.timer);
    this.listeners.splice(0).forEach(item=>item.dispose());
  }
}

module.exports={studio_project_sources};
