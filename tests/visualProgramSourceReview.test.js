'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const {EventEmitter} = require('node:events');
const {setImmediate: nextTurn} = require('node:timers/promises');
const {example} = require('../extension/media/threadStudio/programModel');
const {exportProgram, designFile, graphText} = require('../extension/visualProgramFiles');

class Uri {
  constructor(scheme, file) { this.scheme=scheme; this.path=file; this.fsPath=file; }
  static file(file) { return new Uri('file',file); }
  static from({scheme,path}) { return new Uri(scheme,path); }
  static joinPath(root,...parts) { return new Uri(root.scheme,path.join(root.path,...parts)); }
  toString() { return this.scheme+':'+this.path; }
}
class TabInputText {
  constructor(uri) { this.uri=uri; }
}
class TabInputTextDiff {
  constructor(original,modified) { this.original=original; this.modified=modified; }
}
class WorkspaceEdit {
  replace(uri,range,text) { this.text=text; }
}
const vscode = {Uri,TabInputText,TabInputTextDiff,WorkspaceEdit,Range:class {},env:{language:'en'},window:{},workspace:{},commands:{}};
const load = Module._load;
let register;
try {
  Module._load = function(name,...rest) { return name==='vscode'?vscode:load.call(this,name,...rest); };
  register = require('../extension/visualProgramEditor').registerVisualProgram;
} finally { Module._load=load; }

function nextEvent(events,name) {
  return new Promise((resolve,reject)=>{
    const finish=value=>{clearTimeout(timer);resolve(value);};
    const timer=setTimeout(()=>{events.off(name,finish);reject(Error('Did not receive '+name));},10000);
    events.once(name,finish);
  });
}

// Keep the editor and text content provider real. Only VS Code's message, tab and document APIs are mocked.
async function openEditor(t) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'zv-review-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true,maxRetries:4,retryDelay:100}));
  const graph=example(), root=await fs.realpath(await exportProgram(directory,graph));
  const source=path.join(root,'src','main.c'), design=path.join(root,designFile);
  const original=await fs.readFile(source,'utf8'), initialDesign=await fs.readFile(design,'utf8');
  graph.threads[0].initialValue=19;
  let buffer=graphText(graph), handler, editor, contents, saves=0;
  const events=new EventEmitter(), tabs=[], workspace=vscode.workspace, disposable={dispose(){}};
  const doc={uri:Uri.file(design),version:5,getText:()=>buffer,positionAt:i=>i,
    save:async()=>{saves++;await fs.writeFile(design,buffer);return true;}};
  const prompt=type=>(message,...choices)=>new Promise(answer=>{
    const dialog={type,message,choices,answer};
    events.emit(type,dialog);
    events.emit('prompt',dialog);
  });
  const group={tabs}, unrelated={input:new TabInputTextDiff(Uri.file('other-left'),Uri.file('other-right'))};
  tabs.push(unrelated);
  Object.assign(vscode.window,{
    registerCustomEditorProvider:(_,provider)=>{editor=provider;return disposable;},
    showInformationMessage:prompt('approve'),showWarningMessage:prompt('warning'),
    tabGroups:{all:[group],onDidChangeTabs:callback=>{events.on('tabs',callback);return disposable;},
      close:async closed=>{for(const tab of closed) tabs.splice(tabs.indexOf(tab),1);events.emit('tabs',{closed});}}
  });
  Object.assign(workspace,{
    isTrusted:true,textDocuments:[doc],onDidChangeTextDocument:callback=>{events.on('change',callback);return disposable;},
    registerTextDocumentContentProvider:(_,provider)=>{contents=provider;return disposable;},
    applyEdit:async edit=>{
      buffer=edit.text;doc.version++;
      events.emit('change',{document:doc,contentChanges:[{}]});
      return true;
    }
  });
  Object.assign(vscode.commands,{registerCommand:()=>disposable,executeCommand:async (cmd,left,right)=>{
    if(cmd==='vscode.diff') tabs.push({input:new TabInputTextDiff(left,right)});
    if(cmd==='vscode.openWith') events.emit('design',left);
  }});
  register({subscriptions:[],extensionUri:Uri.file(root)},{folder:()=>({uri:Uri.file(root)})});
  const webview={asWebviewUri:uri=>uri,postMessage:async m=>{events.emit('message',m);return true;},
    onDidReceiveMessage:fn=>{handler=fn;return disposable;}};
  const panel={active:true,visible:true,viewColumn:1,webview,onDidDispose:()=>disposable};
  editor.resolveCustomTextEditor(doc,panel);
  function review(promptType='approve') {
    const opened=nextEvent(events,promptType);
    handler({action:'apply',version:doc.version});
    return opened;
  }
  async function edit(value) {
    const changed=nextEvent(events,'message');
    const newGraph=JSON.parse(buffer);newGraph.threads[0].initialValue=value;
    handler({action:'edit',version:doc.version,graph:newGraph});
    const update=await changed;
    assert.equal(update.graph.threads[0].initialValue,value);
  }
  const preview=()=>contents.provideTextDocumentContent(tabs.at(-1).input.original);
  const assertUnwritten=async expected=>{
    assert.equal(saves,0);
    assert.equal(await fs.readFile(source,'utf8'),expected);
    assert.equal(await fs.readFile(design,'utf8'),initialDesign);
  };
  return {review,edit,preview,assertUnwritten,events,tabs,unrelated,source,original,doc,panel,handler};
}

test('Edit JSON beside refocuses the same document in its text group from a visible inactive graph',async t=>{
  const {doc,panel,handler,original,assertUnwritten} = await openEditor(t);
  const text = {input:new TabInputText(doc.uri)};
  vscode.window.tabGroups.all = [
    {viewColumn:1,tabs:[text]}, // A text tab can also be hidden behind the graph.
    {viewColumn:2,tabs:[{input:new TabInputText(Uri.file('another.zephyr-program.json'))}]},
    {viewColumn:3,tabs:[text]}
  ];
  const focused = [];
  vscode.window.showTextDocument = (document,options)=>focused.push({document,options});
  panel.active = false;
  handler({action:'text'});
  await nextTurn();
  assert.deepEqual(focused,[{document:doc,options:{viewColumn:3,preserveFocus:false,preview:false}}]);
  panel.visible = false;
  handler({action:'text'});
  await nextTurn();
  assert.equal(focused.length,1);
  await assertUnwritten(original);
});

test('approval of an outdated review closes only its diff and immediately permits another review',async t=>{
  const h=await openEditor(t);
  const first=await h.review();
  assert.equal(h.preview(),h.original);
  await h.edit(73);
  const warning=nextEvent(h.events,'warning');
  first.answer('Apply reviewed changes');
  assert.match((await warning).message,/fresh diff/);
  assert.deepEqual(h.tabs,[h.unrelated]);
  await h.assertUnwritten(h.original);
  // Leave the stale warning on screen while requesting a fresh diff from the design.
  await nextTurn();
  const second=await h.review();
  assert.equal(h.tabs.length,2);
  const returned=nextEvent(h.events,'design');
  second.answer('Back to design');
  await returned;
  assert.deepEqual(h.tabs,[h.unrelated]);
  await h.assertUnwritten(h.original);
});

test('a dirty source opened through a separate directory alias protects a design opened by real path',async t=>{
  const h=await openEditor(t);
  const root=path.dirname(path.dirname(h.source)), alias=path.join(path.dirname(root),'workspace-alias');
  await fs.symlink(root,alias,process.platform==='win32'?'junction':'dir');
  const sourceAlias=path.join(alias,'src','main.c');
  assert.notEqual(sourceAlias,h.source);
  assert.equal(await fs.realpath(sourceAlias),await fs.realpath(h.source));
  const unsaved=h.original+'/* this change exists only in the editor at the alias */\n';
  const buffer={uri:Uri.file(sourceAlias),isDirty:true,getText:()=>unsaved};
  vscode.workspace.textDocuments.push(buffer);
  const dialog=await h.review('prompt');
  assert.equal(dialog.type,'warning','the disk comparison alone permits an unsafe apply');
  assert.equal(h.preview(),unsaved);
  assert.deepEqual(dialog.choices,['Back to design']);
  const returned=nextEvent(h.events,'design');
  dialog.answer('Back to design');
  await returned;
  await h.assertUnwritten(h.original);
  await nextTurn();

  buffer.isDirty=false;
  const approval=await h.review();
  buffer.isDirty=true;
  const stale=nextEvent(h.events,'warning');
  approval.answer('Apply reviewed changes');
  assert.match((await stale).message,/fresh diff/);
  assert.deepEqual(h.tabs,[h.unrelated]);
  await h.assertUnwritten(h.original);
});

test('on-disk and unsaved hand edits can be reviewed while preserving the source and design',async t=>{
  const h=await openEditor(t);
  const handEdit=h.original+'/* external edit */\n';
  const first=await h.review();
  await fs.writeFile(h.source,handEdit);
  const stale=nextEvent(h.events,'warning');
  first.answer('Apply reviewed changes');
  assert.match((await stale).message,/fresh diff/);
  await h.assertUnwritten(handEdit);
  await nextTurn();
  for (const original of [handEdit,handEdit+'/* unsaved change */\n']) {
    if(original!==handEdit) vscode.workspace.textDocuments.push({uri:Uri.file(h.source),isDirty:true,getText:()=>original});
    const warning=await h.review('warning');
    assert.deepEqual(warning.choices,['Back to design']);
    assert.equal(h.preview(),original);
    const returned=nextEvent(h.events,'design');
    warning.answer('Back to design');
    await returned;
    assert.deepEqual(h.tabs,[h.unrelated]);
    await h.assertUnwritten(handEdit);
    await nextTurn();
  }
});
