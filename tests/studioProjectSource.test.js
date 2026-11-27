'use strict';

const assert=require('node:assert/strict');
const {test}=require('node:test');
const {EventEmitter,once}=require('node:events');
const Module=require('node:module');
const path=require('node:path').posix;

class Uri {
  constructor(name,scheme='vscode-remote',authority='wsl+studio') {
    this.path=name; this.fsPath=name;this.scheme=scheme;this.authority=authority;
  }
  static joinPath(base,...segments) { return base.with({path:path.join(base.path,...segments)}); }
  with({path:name}) { return new Uri(name,this.scheme,this.authority); }
  toString() { return this.scheme+'://'+this.authority+this.path; }
}
class SourceBreakpoint { constructor(location) {this.location=location;} }
class Location { constructor(uri,start) {this.uri=uri;this.range={start};} }
function document(uri,text) {
  return {uri,text,fileName:uri.path,languageId:'c',version:1,isDirty:false,
    get lineCount(){return this.text.split('\n').length;},lineAt(line){return {range:{start:{line},end:{line}}};},
    offsetAt(){return this.text.length;},getText(){return this.text;}};
}

function fixture(t) {
  const folder={uri:new Uri('/work')}, peer={uri:new Uri('/other')};
  const events=new EventEmitter(),docs=new Map(),messages=[];
  const on=name=>listener=>{events.on(name,listener);return {dispose:()=>events.off(name,listener)};};
  const workspace={isTrusted:true,fs:{stat:async uri=>{
    if (docs.has(uri.toString())) return {type:1};throw Error('No file');
  }},
    onDidChangeTextDocument:on('change'),onDidSaveTextDocument:on('save'),onDidCloseTextDocument:on('close'),
    asRelativePath:uri=>uri.path,openTextDocument:async uri=>docs.get(uri.toString()),
    getWorkspaceFolder:uri=>uri.path.startsWith('/work/') ? folder : peer,
    getConfiguration:()=>({get:()=>undefined}),findFiles:async()=>Array.from(docs.values(),d=>d.uri)};
  const window={visibleTextEditors:[],showQuickPick:async()=>undefined};
  const debug={breakpoints:[],onDidChangeBreakpoints:on('points'),
    addBreakpoints(points){this.breakpoints.push(...points);events.emit('points');},
    removeBreakpoints(points){this.breakpoints=this.breakpoints.filter(p=>!points.includes(p));events.emit('points');}};
  const vscode={Uri,FileType:{File:1},env:{language:'en'},SourceBreakpoint,Location,workspace,window,debug,
    RelativePattern:class {constructor(base,pattern){Object.assign(this,{base,pattern});}}};
  const mod=require.resolve('../extension/studioProjectSourceHost'),dialogs=require.resolve('../extension/fileDialogs');
  const load=Module._load;
  let ctor;
  try {
    delete require.cache[mod];delete require.cache[dialogs];
    Module._load=function(id,...args){return id==='vscode' ? vscode : load.call(this,id,...args);};
    ctor=require(mod).studio_project_sources;
  } finally {Module._load=load;}
  const panel={visible:true,onDidDispose:on('dispose'),webview:{postMessage:async msg=>{
    messages.push(msg);events.emit('rendered',msg);
  }}};
  const design={uri:new Uri('/work/apps/current/design.zephyr-program.json')};
  const host=new ctor(panel,design,{selection:{folder:folder.uri.toString(),app:'apps/current'},folder:()=>folder});
  t.after(()=>host.dispose());
  const add=(name,text,scheme)=>{const doc=document(new Uri(name,scheme),text);docs.set(doc.uri.toString(),doc);return doc;};
  return {host,add,events,workspace,window,debug,last:()=>messages.at(-1)};
}

test('the default document belongs to the active app even when another app in the same folder is visible',async t=>{
  const h=fixture(t);
  const external=h.add('/other/src/main.c','void unrelated(void) {}');
  const sibling=h.add('/work/apps/current-demo/src/main.c','void unrelated(void) {}');
  const main=h.add('/work/apps/current/src/main.c','void target(void) {}');
  h.window.visibleTextEditors=[external,sibling].map(document=>({document}));
  await h.host.handle({op:'enter'});
  assert.equal(h.last().source.uri,main.uri.toString());
  assert.equal(h.last().source.graph.symbols[0].name,'target');
});

test('editing observes the unsaved document version; a new incomplete file never inherits another file’s graph',async t=>{
  const h=fixture(t),main=h.add('/work/apps/current/src/main.c','void task(void) {k_sem_take(&sem,K_FOREVER);}');
  await h.host.handle({op:'enter'});
  assert.equal(h.last().source.graph.signals[0].direction,'in');
  main.text='void task(void) {k_sem_give(&sem);}';main.version++;main.isDirty=true;
  const refreshed=once(h.events,'rendered',{signal:AbortSignal.timeout(3000)});
  h.events.emit('change',{document:main,contentChanges:[{}]});
  const [edit]=await refreshed;
  assert.equal(edit.source.dirty,true);assert.equal(edit.source.current,2);
  assert.equal(edit.source.text,main.text);assert.equal(edit.source.graph.signals[0].direction,'out');
  const broken=h.add('/work/apps/current/src/draft.h','struct partial {');
  h.window.showQuickPick=async items=>items.find(item=>item.uri===broken.uri);
  await h.host.handle({op:'pick'});
  assert.equal(h.last().source.issue,'incomplete');assert.equal(h.last().source.uri,broken.uri.toString());
  assert.equal(h.last().source.graph,undefined);
  h.window.showQuickPick=async()=>undefined;
  await h.host.handle({op:'pick'});assert.equal(h.last().source.uri,broken.uri.toString());
});

test('source breakpoints require the bound URI, revision, valid line and trusted workspace',async t=>{
  const h=fixture(t),main=h.add('/work/apps/current/src/main.c','void example(void) {\n action();\n}');
  await h.host.handle({op:'enter'});
  const request={op:'breakpoint',line:2,uri:main.uri.toString(),version:main.version};
  for (const update of [{line:0},{line:4},{line:NaN},{uri:'file:///unrelated.c'},{version:99}]) {
    await h.host.handle({...request,...update});
  }
  h.workspace.isTrusted=false;await h.host.handle(request);
  assert.deepEqual(h.debug.breakpoints,[]);
  h.workspace.isTrusted=true;await h.host.handle(request);
  assert.equal(h.debug.breakpoints[0].location.uri,main.uri);
  assert.deepEqual(h.last().breakpoints,[2]);
  await h.host.handle(request);assert.deepEqual(h.debug.breakpoints,[]);
  await h.host.handle({op:'leave'});await h.host.handle(request);assert.deepEqual(h.debug.breakpoints,[]);
});

test('leaving while a picker is open does not apply the late selection on reentry',async t=>{
  const h=fixture(t),main=h.add('/work/apps/current/src/main.c','void current(void) {}');
  const temp=h.add('/work/apps/current/src/temp.c','void next(void) {}');
  await h.host.handle({op:'enter'});
  const pending=once(h.events,'choices');let settle;
  h.window.showQuickPick=items=>new Promise(resolve=>{settle=resolve;h.events.emit('choices',items);});
  const pick=h.host.handle({op:'pick'}),[items]=await pending;
  await h.host.handle({op:'leave'});
  settle(items.find(item=>item.uri===temp.uri));await pick;
  await h.host.handle({op:'enter'});assert.equal(h.last().source.uri,main.uri.toString());
});
