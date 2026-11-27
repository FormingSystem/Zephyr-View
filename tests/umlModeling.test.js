'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const {open_modeling}=require('../extension/umlModeling');
const {preview_model}=require('../extension/plantumlPreview');
const en=(_zh,text)=>text;
const uri=path=>({path,toString:()=> 'file://'+path});

function fixture() {
  const calls=[],folder=uri('/app'),file=uri('/app/sequence.puml'),files=new Map();
  class WorkspaceEdit {createFile(target,options){Object.assign(this,{target,options});}}
  const workspace={isTrusted:true,applyEdit:async({target,options})=>{
    if (files.has(target.path) && !options.overwrite) return false;
    files.set(target.path,options.contents.toString());return true;
  },openTextDocument:async uri=>({uri}),getConfiguration:()=>({get:()=> 'Local'})};
  const window={showQuickPick:async choices=>choices.find(c=>c.item?.id==='sequence'),
    showSaveDialog:async()=>file,showWarningMessage:async()=>undefined,showInformationMessage:async()=>undefined,
    showTextDocument:async document=>window.activeTextEditor={document}};
  const vscode={WorkspaceEdit,workspace,window,QuickPickItemKind:{Separator:-1},Uri:{joinPath:(base,name)=>uri(base.path+'/'+name)},
    extensions:{getExtension:()=>undefined},commands:{executeCommand:async(...args)=>calls.push(args)}};
  return {vscode,workspace,window,calls,files,folder,file};
}

test('new diagrams contain editable PlantUML and template selection leaves existing files intact',async()=>{
  const h=fixture();await open_modeling(h.vscode,h.folder,en);
  assert.match(h.files.get(h.file.path),/^@startuml/);assert.deepEqual(h.calls,[]);
  assert.equal(h.window.activeTextEditor.document.uri,h.file);
  h.files.set(h.file.path,'edited diagram');
  await open_modeling(h.vscode,h.folder,en);assert.equal(h.files.get(h.file.path),'edited diagram');
});

test('existing diagrams open without a rendering provider; cancelled choices create nothing',async()=>{
  const h=fixture();
  h.window.showQuickPick=async items=>items.find(x=>x.action==='open');
  h.window.showOpenDialog=async()=>[h.file];
  await open_modeling(h.vscode,h.folder,en);
  assert.equal(h.window.activeTextEditor.document.uri,h.file);
  h.window.showQuickPick=async()=>undefined;await open_modeling(h.vscode,undefined,en);
  assert.equal(h.files.size,0);assert.deepEqual(h.calls,[]);
});

test('preview offers provider details when absent; remote preview requires explicit choice on the same document',async()=>{
  const h=fixture();
  h.window.showInformationMessage=async(_,...actions)=>actions[0];
  await preview_model(h.vscode,h.file,en);
  assert.deepEqual(h.calls.splice(0),[['extension.open','jebbs.plantuml']]);
  h.vscode.extensions.getExtension=()=>({});
  h.workspace.getConfiguration=()=>({get:()=> 'PlantUMLServer'});
  h.window.showInformationMessage=async()=>undefined;
  await preview_model(h.vscode,h.file,en);assert.deepEqual(h.calls,[]);
  h.window.showInformationMessage=async(_,...actions)=>actions[0];
  await preview_model(h.vscode,h.file,en);assert.deepEqual(h.calls.splice(0),[['plantuml.preview']]);
  h.window.showInformationMessage=async(_,...actions)=>{h.window.activeTextEditor=undefined;return actions[0];};
  await preview_model(h.vscode,h.file,en);assert.deepEqual(h.calls,[]);
});
