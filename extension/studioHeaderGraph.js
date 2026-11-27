'use strict';

const {inspect_buffer}=require('./liveSourceGraph');
const {link_header_diagram}=require('./sourceClassDiagram');
const {discover_source_headers,direct_includes}=require('./sourceHeaderDiscovery');

function navigation_lines(diagram) {
  const lines=new Map();
  for (const node of diagram.nodes) {
    if (!node.file) continue;
    if (!lines.has(node.file)) lines.set(node.file,new Set());
    const target=lines.get(node.file);
    target.add(node.line);
    for (const member of node.members) target.add(member.line);
  }
  return lines;
}

/** Keep a revision of the root graph and the exact header declarations it exposes. */
class studio_header_graph {
  constructor(vscode,refresh) {
    this.vscode=vscode;
    this.refresh=refresh;
    this.revision=0;
    this.navigation=0;
    this.files=new Map();
    this.watched=new Set();
    this.watchers=new Map();
  }

  leave_header() {
    ++this.navigation;
    this.displayed=undefined;
  }

  invalidate(dependencies=false) {
    if (dependencies) this.discovery=undefined;
    ++this.revision;
    this.leave_header();
  }

  reset() {
    this.invalidate(true);
    this.files.clear();
    this.watch([]);
  }

  affects(uri) {return this.watched.has(this.key(uri));}

  key(uri) {
    const value=uri.toString();
    return uri.scheme==='file' && process.platform==='win32' ? value.toLowerCase() : value;
  }

  watch(uris) {
    this.watched=new Set(uris.map(uri=>this.key(uri)));
    const directories=new Map();
    for (const uri of uris) {
      const dir=this.vscode.Uri.joinPath(uri,'..');
      directories.set(this.key(dir),dir);
    }
    for (const [key,watcher] of this.watchers) {
      if (!directories.has(key)) {watcher.dispose();this.watchers.delete(key);}
    }
    const {workspace,RelativePattern}=this.vscode;
    if (!workspace.createFileSystemWatcher) return;
    const changed=uri=>{if (this.affects(uri)) this.refresh();};
    for (const [key,dir] of directories) {
      if (this.watchers.has(key)) continue;
      const watcher=workspace.createFileSystemWatcher(new RelativePattern(dir,'*'));
      watcher.onDidCreate(changed);watcher.onDidChange(changed);watcher.onDidDelete(changed);
      this.watchers.set(key,watcher);
    }
  }

  async discover(document,text,context,revision) {
    const includes=direct_includes(text);
    if (!includes.length) {this.discovery=undefined;return {headers:[],watchUris:[]};}
    const key=JSON.stringify([document.uri.toString(),includes]);
    if (this.discovery?.key===key) return this.discovery.result;
    const cancelled=()=>this.revision!==revision;
    const options=await context();
    if (cancelled()) return;
    const result=await discover_source_headers({vscode:this.vscode,document,...options,includes,cancelled});
    if (cancelled()) return;
    this.discovery={key,result};
    return result;
  }

  current_buffers(headers) {
    const open=new Map((this.vscode.workspace.textDocuments || []).map(doc=>[this.key(doc.uri),doc]));
    return headers.every(h=>{
      const doc=open.get(this.key(h.uri));
      if (h.document===doc) return !doc || doc.version===h.version;
      return doc ? doc.getText()===h.text : !h.document;
    });
  }

  async analyze(local,document,context) {
    this.invalidate();
    const graphRevision=this.revision;
    let result={headers:[],watchUris:[]};
    if (!local.issue && local.text.includes('#') && this.vscode.workspace.isTrusted) {
      result=await this.discover(document,local.text,context,graphRevision);
    } else this.discovery=undefined;
    if (!result || this.revision!==graphRevision || document.version!==local.current) return;
    const files=new Map(),inputs=[];
    for (const header of result.headers) {
      const uri=header.uri.toString();
      const previous=this.files.get(uri);
      const diagram=previous?.text===header.text ? previous.diagram :
        inspect_buffer(header.uri.path,header.text).graph?.class_diagram;
      files.set(uri,{...header,diagram});
      if (diagram) inputs.push({uri,diagram,line:header.line,conditional:header.conditional});
    }
    const graph=local.graph;
    const diagram=inputs.length ? link_header_diagram(graph.class_diagram,inputs) : graph?.class_diagram;
    this.files=files;
    this.lines=diagram ? navigation_lines(diagram) : new Map();
    this.watch(result.watchUris);
    if (!this.current_buffers(result.headers)) {
      this.refresh();return;
    }
    return {...local,graphRevision,graph:graph && {...graph,class_diagram:diagram}};
  }

  async reveal(file,line,navigationId) {
    this.leave_header();
    const ticket=this.navigation;
    if (!this.lines?.get(file)?.has(line) || !this.vscode.workspace.isTrusted) return;
    const header=this.files.get(file);
    if (!header) return;
    const doc=await this.vscode.workspace.openTextDocument(header.uri).then(value=>value,()=>undefined);
    if (this.navigation!==ticket) return;
    if (!doc || doc.isClosed || doc.getText()!==header.text) {this.refresh();return;}
    this.displayed={doc,version:doc.version,line,navigationId};
    return this.displayed;
  }
}

module.exports={studio_header_graph};
