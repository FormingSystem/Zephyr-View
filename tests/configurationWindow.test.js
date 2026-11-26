'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {ConfigurationWindow} = require('../extension/configurationWindow');

function fixture() {
  const main = {viewColumn:2};
  const floating = {viewColumn:3};
  const groups = {all:[{viewColumn:1},main,floating],activeTabGroup:main};
  const panel = {active:true,viewColumn:main.viewColumn};
  const calls = [];
  const options = {panel, groups, scope:'target-a', state:{draft:'y'}, execute:async (...args)=>{calls.push(args);}};
  return {window:new ConfigurationWindow(), main, floating, groups, panel, calls, options};
}

test('full-screen configuration enters only the new active window and returns to the originating group', async () => {
  const {window, main, floating, groups, panel, calls, options} = fixture();
  await window.move({...options,detach:true,presentation:true});
  await window.activate(panel,groups,options.execute);
  assert.deepEqual(calls,[['workbench.action.moveEditorToNewWindow']]);
  groups.activeTabGroup = floating;
  panel.viewColumn = floating.viewColumn;
  await window.activate(panel,groups,options.execute);
  await window.activate(panel,groups,options.execute);
  assert.equal(calls.length,2);
  assert.deepEqual(calls[1],['workbench.action.toggleFullScreen']);
  await window.move({...options,detach:false});
  assert.deepEqual(calls[2],['moveActiveEditor',{to:'position',by:'group',value:main.viewColumn}]);
  assert.equal(window.detached,false);
});

test('resizable windows hand off drafts once for the original target', async () => {
  const {window, panel, groups, floating, calls, options} = fixture();
  await window.move({...options,detach:true});
  assert.equal(window.forTarget(panel,options.scope),undefined);
  groups.activeTabGroup = floating;
  panel.viewColumn = floating.viewColumn;
  await window.activate(panel,groups,options.execute);
  assert.equal(calls.length,1);
  window.ready(panel);
  const transfer = window.forTarget(panel,options.scope);
  assert.deepEqual(transfer.state,options.state);
  window.delivered(transfer);
  assert.equal(window.forTarget(panel,options.scope),undefined);
  await window.move({...options,detach:false});
  window.ready(panel);
  assert.equal(window.forTarget(panel,'target-b'),undefined);
  assert.equal(window.forTarget(panel,options.scope),undefined);
});

test('a failed move keeps the previous layout and permits another attempt', async () => {
  const {window, options} = fixture();
  await assert.rejects(window.move({...options,detach:true,presentation:true,execute:async()=>{throw Error('move failed');}}));
  assert.equal(window.detached,false);
  assert.equal(window.presentation,false);
  await window.move({...options,detach:true});
  assert.equal(window.detached,true);
});

test('native tab moves return the current draft and drop the floating-window layout', async () => {
  const {window, main, floating, groups, panel, options} = fixture();
  await window.move({...options,detach:true});
  groups.activeTabGroup = floating;
  panel.viewColumn = floating.viewColumn;
  await window.activate(panel,groups,options.execute);
  window.ready(panel);
  window.delivered(window.forTarget(panel,options.scope));
  const changed = {studioMapView:{scope:options.scope},draft:'changed'};
  window.remember(panel,options.scope,changed);
  groups.activeTabGroup = main;
  panel.viewColumn = main.viewColumn;
  assert.ok(await window.activate(panel,groups,options.execute));
  assert.equal(window.detached,false);
  window.ready(panel);
  assert.equal(window.forTarget(panel,options.scope).state.draft,changed.draft);
});

test('closing a detached editor keeps its last matching draft until configuration reopens', async () => {
  const {window, panel, options} = fixture();
  await window.move({...options,detach:true});
  const changed = {studioMapView:{scope:options.scope},draft:'updated before close'};
  window.remember(panel,options.scope,changed);
  window.remember(panel,options.scope,{studioMapView:{scope:'unrelated'}});
  assert.ok(window.close());
  const reopened = {};
  window.ready(reopened);
  assert.equal(window.forTarget(reopened,options.scope).state.draft,changed.draft);
  assert.equal(window.detached,false);
});

test('clearing the current target leaves other application drafts recoverable', async () => {
  const {window, panel, options} = fixture();
  const earlier = ['other-target',[['prj.conf',{text:'CONFIG_ASSERT=y'}]]];
  await window.move({...options,detach:true,state:{studioDraftsV1:[earlier,[options.scope,[]]]}});
  window.ready(panel);
  window.delivered(window.forTarget(panel,options.scope));
  window.remember(panel,options.scope,{studioMapView:{scope:options.scope},studioDraftsV1:[]});
  window.ready(panel);
  assert.deepEqual(window.forTarget(panel,options.scope).state.studioDraftsV1,[earlier]);
});
