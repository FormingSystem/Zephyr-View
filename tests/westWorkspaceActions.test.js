'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const {vscode,uri} = require('./integration/adaptive-build-host.cjs');

vscode.env = {language:'en'};
vscode.window = {};
// The build harness loads these dialog modules before installing a window stub.
for (const module of ['fileDialogs','installationDialogs']) delete require.cache[require.resolve('../extension/'+module)];
const original = Module._load;
let actions;
try {
  Module._load = function(name,...args) {return name === 'vscode' ? vscode : original.call(this,name,...args);};
  actions = require('../extension/westWorkspaceActions');
} finally {Module._load = original;}

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(),'west-repair-'));
  t.after(()=>fs.rm(base,{recursive:true,force:true}));
  const root = path.join(base,'workspace');
  const repo = path.join(root,'product');
  await fs.mkdir(repo,{recursive:true});
  await fs.writeFile(path.join(repo,'west.yml'),'manifest:\n  projects: []\n');
  const file = path.join(root,'.west','config');
  const state = {manifest:{root:uri(root),config:uri(file),invalid:true}};
  vscode.window.showOpenDialog = async()=>[uri(repo)];
  vscode.window.showQuickPick = async choices=>choices.find(item=>item.id === 'default');
  vscode.window.showInformationMessage = async (_title,_options,confirm)=>confirm;
  return {base,root,repo,file,state};
}

test('Open existing works in an empty VS Code window and selects the nearest topdir',async t=>{
  const {root} = await fixture(t);
  await fs.mkdir(path.join(root,'.west'));
  assert.equal(await actions.openExisting({},false,()=>true),root);
});

test('repair recreates a missing config under .west after confirmation only',async t=>{
  const {root,file,state} = await fixture(t);
  await fs.mkdir(path.dirname(file));
  const yes = vscode.window.showInformationMessage;
  vscode.window.showInformationMessage = async()=>undefined;
  await actions.repair(state,()=>true);
  await assert.rejects(fs.stat(file),{code:'ENOENT'});
  vscode.window.showInformationMessage = yes;
  await actions.repair(state,()=>true);
  assert.match(await fs.readFile(file,'utf8'),/path = product/);
  assert.equal(path.dirname(path.dirname(file)),root);
});

test('repair refuses malformed INI or an unsaved editor before applying edits',async t=>{
  const {file,state} = await fixture(t);
  await fs.mkdir(path.dirname(file));
  const malformed = '[build]\ngenerator=Ninja\n[broken\n';
  await fs.writeFile(file,malformed);
  await assert.rejects(actions.repair(state,()=>true),/INI syntax/);
  assert.equal(await fs.readFile(file,'utf8'),malformed);
  const valid = '[manifest]\npath=missing\n';
  await fs.writeFile(file,valid);
  vscode.workspace.openTextDocument = async()=>({isDirty:true});
  await assert.rejects(actions.repair(state,()=>true),/Save or reload/);
  assert.equal(await fs.readFile(file,'utf8'),valid);
});

test('repair leaves a config reached through an external .west directory junction untouched',async t=>{
  const {base,root,state} = await fixture(t);
  const remote = path.join(base,'elsewhere');
  await fs.mkdir(remote);
  await fs.writeFile(path.join(remote,'config'),'foreign');
  await fs.symlink(remote,path.join(root,'.west'),process.platform === 'win32'?'junction':'dir');
  await assert.rejects(actions.repair(state,()=>true),/Inspect it manually/);
  assert.equal(await fs.readFile(path.join(remote,'config'),'utf8'),'foreign');
});

test('repair leaves an externally linked config file untouched',async t=>{
  const {base,file,state} = await fixture(t);
  const remote = path.join(base,'foreign-config');
  await fs.mkdir(path.dirname(file));
  await fs.writeFile(remote,'foreign');
  try {await fs.symlink(remote,file,'file');}
  catch(error) {if (process.platform === 'win32' && error.code === 'EPERM') return t.skip('Windows file symlink privilege unavailable'); throw error;}
  await assert.rejects(actions.repair(state,()=>true),/Inspect it manually/);
  assert.equal(await fs.readFile(remote,'utf8'),'foreign');
});
