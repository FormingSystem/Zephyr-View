'use strict';

const path = require('node:path');
const {randomBytes} = require('node:crypto');
const vscode = require('vscode');
const {inspect_buffer,max_bytes} = require('./liveSourceGraph');

const command = 'zephyrWorkbench.liveSource';
const t = (zh,en) => vscode.env.language.startsWith('zh') ? zh : en;
const supported = document => document && (/\.(?:c|h|cc|hh|cpp|hpp|cxx|hxx)$/i.test(document.uri.path) ||
  ['c','cpp'].includes(document.languageId));

function preview_html(web, resources) {
  const nonce = randomBytes(16).toString('hex');
  const asset = name => web.asWebviewUri(vscode.Uri.joinPath(resources,name));
  return `<!DOCTYPE html><html lang="${t('zh-CN','en')}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${web.cspSource}; script-src 'nonce-${nonce}'">
<link rel="stylesheet" href="${asset('liveSource.css')}"></head><body>
<header><strong id="name"></strong><small id="status" role="status"></small></header>
<nav id="modes" aria-label="${t('源码图视图','Source diagram views')}"></nav>
<main id="diagram"></main><script nonce="${nonce}" src="${asset('ui.js')}"></script><script nonce="${nonce}" src="${asset('liveSource.js')}"></script></body></html>`;
}

/** One side-by-side preview follows its bound buffer until the user opens another source in it. */
class live_source_preview {
  constructor(context) {
    this.resources = vscode.Uri.joinPath(context.extensionUri,'media','threadStudio');
    context.subscriptions.push(this,vscode.commands.registerCommand(command,uri=>this.open(uri)));
  }

  async open(uri) {
    let document = uri instanceof vscode.Uri ? await vscode.workspace.openTextDocument(uri) : vscode.window.activeTextEditor?.document;
    if (!supported(document)) {
      const choices = await vscode.window.showOpenDialog({canSelectMany:false,filters:{'C / C++':['c','h','cc','hh','cpp','hpp','cxx','hxx']}});
      if (!choices) return;
      document = await vscode.workspace.openTextDocument(choices[0]);
    }
    let editor = vscode.window.visibleTextEditors.find(item=>item.document===document);
    if (!editor) editor = await vscode.window.showTextDocument(document,{preview:false});
    if (!this.panel) this.create_panel();
    else this.panel.reveal(undefined,true);
    if (document !== this.document) this.snapshot = undefined;
    this.document = document;
    this.column = editor.viewColumn;
    this.panel.title = t('源码图 · ','Source diagram · ')+path.basename(document.fileName);
    this.schedule(0);
  }

  create_panel() {
    const panel = vscode.window.createWebviewPanel(command,t('C 源码图','C source diagram'),
      {viewColumn:vscode.ViewColumn.Beside,preserveFocus:true},
      {enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[this.resources]});
    this.panel = panel;
    const listeners = [
      panel.webview.onDidReceiveMessage(message=>{
        if (message?.action==='ready') this.schedule(0);
        else if (message?.action==='source') void this.reveal_line(message);
      }),
      vscode.workspace.onDidChangeTextDocument(event=>{
        if (event.document===this.document && event.contentChanges.length) this.schedule(220);
      }),
      vscode.workspace.onDidSaveTextDocument(doc=>{if (doc===this.document) this.schedule(0);}),
      vscode.workspace.onDidCloseTextDocument(doc=>{if (doc===this.document) panel.dispose();})
    ];
    panel.onDidDispose(()=>{
      clearTimeout(this.timer);
      listeners.forEach(listener=>listener.dispose());
      this.panel = this.document = this.snapshot = undefined;
    });
    panel.webview.html = preview_html(panel.webview,this.resources);
  }

  schedule(delay) {
    clearTimeout(this.timer);
    this.timer = setTimeout(()=>this.update(),delay);
  }

  update() {
    const doc = this.document;
    if (!this.panel || !doc || doc.isClosed) return;
    const {graph,issue,line} = doc.offsetAt(doc.lineAt(doc.lineCount-1).range.end)>max_bytes ?
      {issue:'size'} : inspect_buffer(doc.fileName,doc.getText());
    if (graph) this.snapshot = {graph,version:doc.version,uri:doc.uri.toString()};
    void this.panel.webview.postMessage({name:path.basename(doc.fileName),dirty:doc.isDirty,issue,line,...this.snapshot,
      uri:doc.uri.toString(),current:doc.version});
  }

  async reveal_line({line,version,uri}) {
    const doc = this.document;
    if (!doc || doc.isClosed || doc.uri.toString()!==uri || version!==doc.version || version!==this.snapshot?.version ||
      !Number.isSafeInteger(line) || line<1 || line>doc.lineCount) return;
    await vscode.window.showTextDocument(doc,{viewColumn:this.column,preview:false,selection:doc.lineAt(line-1).range});
  }

  dispose() { clearTimeout(this.timer); this.panel?.dispose(); }
}

function register_live_source(context) { return new live_source_preview(context); }
module.exports = {register_live_source};
