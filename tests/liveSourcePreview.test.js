'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const {EventEmitter,once}=require('node:events');

class Uri {
  constructor(path) { this.path = path; }
  toString() { return 'file://'+this.path; }
  static joinPath(uri,...names) { return new Uri([uri.path,...names].join('/')); }
}

function document_at(name,initial) {
  return {fileName:name,uri:new Uri(name),languageId:'c',version:1,isDirty:false,text:initial,
    get lineCount() { return this.text.split('\n').length; },
    getText() { return this.text; }, lineAt(line) { return {range:{start:{line},end:{line}}}; },
    offsetAt() { return this.text.length; }};
}

function host(doc) {
  const events=new EventEmitter(), disposables=[], shown=[];
  const on=name=>listener=>{events.on(name,listener);return {dispose:()=>events.off(name,listener)};};
  const panel={onDidDispose:on('dispose'),reveal(){},dispose:()=>events.emit('dispose'),webview:{
    onDidReceiveMessage:on('request'),asWebviewUri:uri=>uri,postMessage:message=>events.emit('render',message)}};
  const vscode={Uri,ViewColumn:{Beside:-2},env:{language:'en'},
    window:{visibleTextEditors:[{document:doc,viewColumn:1}],activeTextEditor:{document:doc},
      createWebviewPanel:(_type,_title,location)=>{assert.equal(location.preserveFocus,true);return panel;},
      showTextDocument:async(doc,options)=>{shown.push({doc,options});return {document:doc,viewColumn:1};}},
    commands:{registerCommand(){return {dispose(){}};}},
    workspace:{onDidChangeTextDocument:on('edit'),onDidSaveTextDocument:on('save'),onDidCloseTextDocument:on('close')}};
  const load=Module._load;
  let controller;
  try {
    Module._load=function(id,...args) { return id==='vscode'?vscode:load.call(this,id,...args); };
    const {register_live_source}=require('../extension/liveSourcePreview');
    controller=register_live_source({extensionUri:new Uri('/extension'),subscriptions:disposables});
  } finally { Module._load=load; }
  function edit(text) {
    doc.text=text;doc.version++;doc.isDirty=true;
    events.emit('edit',{document:doc,contentChanges:[{}]});
  }
  const next=async()=>{const [message]=await once(events,'render',{signal:AbortSignal.timeout(3000)});return message;};
  return {events,edit,controller,next,shown,panel};
}

test('live C preview retains the prior diagram on incomplete typing and navigates only at its own version',async t=>{
  const doc=document_at('/app/main.c','void task(){ k_sem_take(&ready,K_FOREVER); }');
  const h=host(doc);t.after(()=>h.controller.dispose());
  let rendered=h.next();await h.controller.open();const first=await rendered;
  assert.equal(first.graph.signals[0].source.name,'ready');
  const navigate=msg=>h.events.emit('request',{action:'source',uri:doc.uri.toString(),version:msg.version,line:1});
  navigate(first);assert.equal(h.shown[0].options.viewColumn,1);
  rendered=h.next();h.edit('void task(){');const incomplete=await rendered;
  assert.deepEqual(incomplete.graph,first.graph);assert.equal(incomplete.issue,'incomplete');
  navigate(incomplete);assert.equal(h.shown.length,1);
  rendered=h.next();
  h.edit('void task(){ k_sem_give(&unused); }');
  h.edit('void task(){ k_sem_give(&other); }');
  const restored=await rendered;
  assert.equal(restored.graph.signals[0].destination.name,'other');
  assert.equal(restored.current,doc.version);assert.ok(restored.dirty);navigate(restored);
  assert.equal(h.shown.length,2);
  rendered=h.next();h.edit('');assert.deepEqual((await rendered).graph.signals,[]);
  h.events.emit('close',doc);assert.equal(h.controller.panel,undefined);
  assert.equal(h.events.listenerCount('edit'),0);
});
