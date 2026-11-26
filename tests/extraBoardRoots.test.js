'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {selected_root, distinct_roots} = require('../extension/boardRoots');
const {rootOptions, pickerRoots} = require('../extension/boardCatalog');

test('the board picker accepts a board root or its boards subdirectory and rejects unrelated folders', async t => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'extra-boards-'));
  t.after(() => fs.rm(fixture, {recursive:true,force:true}));
  const boards = path.join(fixture,'boards');
  const unrelated = path.join(fixture,'unrelated');
  await Promise.all([fs.mkdir(boards),fs.mkdir(unrelated)]);
  assert.equal(await selected_root(boards),fixture);
  assert.equal(await selected_root(fixture),fixture);
  assert.equal(await selected_root(unrelated),undefined);
});

test('board lookup merges effective CMake and environment roots without replacing the project list', () => {
  const app = path.join(os.tmpdir(),'app');
  const state = {setup:{app,cacheStatus:'current',plan:{configure:['-DBOARD_ROOT=a;b']}},
    target:{cache:new Map([['BOARD_ROOT','stale']])}};
  assert.deepEqual(rootOptions(state,{BOARD_ROOT:'b;c'}).board_root, ['a','b','c'].map(x=>path.join(app,x)));
  assert.deepEqual(distinct_roots(['a',path.join(app,'a'),'b'],app), ['a','b']);
  state.setup.plan.configure.push('-DSOC_ROOT=a','-DARCH_ROOT=c');
  const roots=rootOptions(state,{SOC_ROOT:'b',ARCH_ROOT:'c;d'});
  assert.deepEqual(roots.soc_root,['a','b'].map(x=>path.join(app,x)));
  assert.deepEqual(roots.arch_root,['c','d'].map(x=>path.join(app,x)));
});

test('local CMake set and PREPEND preserve roots supplied by the caller in Zephyr merge order', async t => {
  const app = await fs.mkdtemp(path.join(os.tmpdir(),'zephyr-app-roots-'));
  t.after(() => fs.rm(app,{recursive:true,force:true}));
  await fs.writeFile(path.join(app,'CMakeLists.txt'),'set(BOARD_ROOT discarded)\nset(BOARD_ROOT vendor)\nlist(PREPEND BOARD_ROOT\n\tlocal)\nfind_package(Zephyr)\n');
  const s = {setup:{app,plan:{configure:['-DBOARD_ROOT=command']}},target:{cache:new Map()}};
  const roots = await pickerRoots(s,{BOARD_ROOT:'environment'});
  assert.deepEqual(roots.board_root,['command','environment','local','vendor','.'].map(name=>path.join(app,name)));
});
