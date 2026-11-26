'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const os = require('node:os');
const fs = require('node:fs/promises');
const vscode = {Uri:{},l10n:{},env:{language:'en'},workspace:{isTrusted:true},window:{},tasks:{}};
const original = Module._load;
let directories, sourcePlan, isZephyrSource;
try {
  Module._load = function(name,...args) {return name === 'vscode' ? vscode : original.call(this,name,...args);};
  directories = require('../extension/toolDirectories');
  ({sourcePlan} = require('../extension/sourceSetup'));
  ({isZephyrSource} = require('../extension/discoverLocations'));
} finally { Module._load = original; }

test('project tools resolve from the new workspace location; external overrides stay outside shared settings', () => {
  const originalRoot = path.resolve('first','项目 A'), newRoot = path.resolve('moved','工程 B');
  const tools = path.join(originalRoot,'工具 集','bin');
  const external = path.resolve('external','bin');
  const stored = directories.relativeDirectory(originalRoot, tools);
  assert.equal(stored,'工具 集/bin');
  assert.equal(directories.relativeDirectory(originalRoot,external),undefined);
  vscode.workspace.getConfiguration = () => ({get:() => [stored]});
  const context = {workspaceState:{get:() => [external]}};
  assert.deepEqual(directories.searchDirectories(context,{uri:{fsPath:newRoot}}),[path.join(newRoot,'工具 集','bin'),external]);
});

test('west initializes its manifest workspace and standalone CMake downloads only source into the chosen path', () => {
  const tools = {west:'west',git:'git'}, root = path.resolve('任意 安装路径');
  const west = sourcePlan(tools,'west',root,'v4.2.0');
  const cmake = sourcePlan(tools,'CMake',root,'main');
  assert.deepEqual(west.args,['init','-m','https://github.com/zephyrproject-rtos/zephyr','--mr','v4.2.0',root]);
  assert.equal(west.source,path.join(root,'zephyr'));
  assert.equal(cmake.program,'git');
  assert.deepEqual(cmake.args,['clone','--depth','1','--branch','main','--','https://github.com/zephyrproject-rtos/zephyr',root]);
  assert.equal(cmake.source,root);
});

test('recognizes unpacked Zephyr source by its metadata in an arbitrarily named directory',async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'移动 source '));
  t.after(() => fs.rm(root,{recursive:true,force:true}));
  const cmake = path.join(root,'share','zephyr-package','cmake');
  await fs.mkdir(cmake,{recursive:true});
  assert.equal(await isZephyrSource(root),false);
  await fs.writeFile(path.join(root,'VERSION'),'VERSION_MAJOR = 4');
  await fs.writeFile(path.join(cmake,'ZephyrConfig.cmake'),'# fixture');
  assert.equal(await isZephyrSource(root),true);
});
