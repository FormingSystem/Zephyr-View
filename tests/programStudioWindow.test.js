'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const Module=require('node:module');

function harness(canDetach=true) {
  const groups=[],moves=[],warnings=[];
  const viewType='fixture.studio';
  class TabInputCustom {
    constructor(uri){this.uri=uri;this.viewType=viewType;}
  }
  function activate(group,tab) {
    groups.forEach(g=>{g.isActive=g===group;});
    group.activeTab=tab;
  }
  const home={tabs:[],isActive:true,viewColumn:1};
  groups.push(home);
  const active=()=>groups.find(g=>g.isActive);
  const vscode={TabInputCustom,env:{language:'en'},window:{tabGroups:{all:groups,get activeTabGroup(){return active();}},
    showInformationMessage:m=>warnings.push(m)},commands:{
    getCommands:async()=>canDetach?['workbench.action.moveEditorToNewWindow']:[],
    async executeCommand(cmd,uri,view,options){
      if(cmd==='vscode.openWith'){
        const group=groups.find(g=>g.viewColumn===options.viewColumn)||active();
        const tab=group.tabs.find(t=>t.input.uri===uri)||{input:new TabInputCustom(uri)};
        if(!group.tabs.includes(tab))group.tabs.push(tab);
        activate(group,tab);return;
      }
      assert.equal(cmd,'workbench.action.moveEditorToNewWindow');
      const source=active(),tab=source.activeTab;
      source.tabs.splice(source.tabs.indexOf(tab),1);
      const floating={tabs:[tab],viewColumn:groups.length+1};
      moves.push(tab);groups.push(floating);activate(floating,tab);
    }
  }};
  const loader=Module._load;
  let Window;
  try {
    Module._load=function(id,...rest){return id==='vscode'?vscode:loader.call(this,id,...rest);};
    delete require.cache[require.resolve('../extension/programStudioWindow')];
    Window=require('../extension/programStudioWindow').ProgramStudioWindow;
  } finally {Module._load=loader;}
  return {studio:new Window(viewType),groups,moves,warnings,home,activate};
}

test('switching designs in a detached studio reuses its existing window from the main workspace',async()=>{
  const {studio,moves,groups,home,activate}=harness();
  const show=uri=>studio.open('project',()=>studio.show(uri));
  await Promise.all([show('one'),show('one')]);
  assert.equal(moves.length,1);
  const group=groups.at(-1);
  await studio.show('two'); // New design or sample opened while working in the detached window.
  activate(home,undefined);
  await show('two');
  assert.equal(groups.at(-1),group);
  assert.equal(moves.length,1);
  assert.equal(group.activeTab.input.uri,'two');
});

test('older hosts keep the studio editable and explain unavailable window support',async()=>{
  const {studio,moves,warnings,home}=harness(false);
  await studio.open('project',()=>studio.show('fixture'));
  assert.equal(moves.length,0);assert.equal(home.activeTab.input.uri,'fixture');
  assert.match(warnings[0],/unavailable/);
});
