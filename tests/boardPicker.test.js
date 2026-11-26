'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {listBoardChoices} = require('../extension/boardPicker');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'zephyr-west-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const base = path.join(root,'référence 源码');
  const app = path.join(root,'app with spaces');
  await fs.mkdir(path.join(base,'scripts'),{recursive:true});
  await fs.writeFile(path.join(base,'scripts','list_boards.py'),'');
  await fs.mkdir(app);
  const s = {folder:{uri:{fsPath:app}},setup:{app},target:{cache:new Map()},tools:{west:'west'},
    manifest:{root:{fsPath:root},uri:{fsPath:path.join(base,'west.yml')}}};
  return {s, env:{ZEPHYR_BASE:base}};
}

const currentHelp = '--arch-root ROOT --board-root ROOT --soc-root ROOT -a, --all-targets';
const unused = () => assert.fail('Unexpected board source');
const hardware = {name:'dual',qualifiers:['soc/app','soc/net'],revisions:['1.0']};
const items = ['dual/soc/app','dual/soc/net','dual@1.0/soc/app','dual@1.0/soc/net'];

test('a capable west keeps every root as one command argument, normalizes targets and preserves revisions', async t => {
  const {s,env} = await fixture(t);
  const selectedBase = env.ZEPHYR_BASE;
  s.setup.plan = {configure:['-DZEPHYR_BASE='+selectedBase]};
  env.ZEPHYR_BASE = path.join(s.setup.app,'unrelated source');
  env.ARCH_ROOT = path.join(s.setup.app,'处理 器');
  const calls = [];
  const run = async (program,args,options) => {
    assert.equal(program,'west');
    assert.equal(options.cwd,s.manifest.root.fsPath);
    assert.equal(options.env.PYTHONIOENCODING,'utf-8');
    assert.equal(options.env.ZEPHYR_BASE,selectedBase);
    calls.push(args);
    return {stdout:args.includes('--help') ? currentHelp : 'dual@1/soc/net\r\ndual@/soc/app\r\ndual/soc/app\r\n'};
  };
  assert.deepEqual(await listBoardChoices(s,env,'west',run,unused),
    {items:['dual/soc/app','dual@1/soc/net'],diagnostics:[]});
  assert.deepEqual(calls,[['boards','--help'],['boards','--all-targets','--board-root',s.setup.app,
    '--soc-root',s.setup.app,'--arch-root',env.ARCH_ROOT]]);
});

test('older Zephyr interfaces use the checkout catalog without retrying with unsupported flags or bare board names', async t => {
  const {s,env} = await fixture(t);
  for (const help of ['--board-root ROOT --arch-root ROOT','--board-root ROOT --arch-root ROOT --soc-root ROOT',
    '--all-targets --board-root ROOT']) {
    const calls = [];
    const run = async (_west,args) => { calls.push(args); return {stdout:help}; };
    const catalog = async (_state,_env,_name,roots) => {
      assert.deepEqual(roots.board_root,[s.setup.app]);
      assert.deepEqual(roots.soc_root,[s.setup.app]);
      return {boards:[hardware,{name:'legacy',qualifiers:[],revisions:[]}],diagnostics:[]};
    };
    assert.deepEqual((await listBoardChoices(s,env,'west',run,catalog)).items,[...items,'legacy']);
    assert.deepEqual(calls,[['boards','--help']]);
  }
});

test('a separate source checkout, CMake and explicit module selections use their own board catalog', async t => {
  const {s,env} = await fixture(t);
  const catalog = async () => ({boards:[hardware],diagnostics:[]});
  for (const name of ['ZEPHYR_MODULES','EXTRA_ZEPHYR_MODULES','ZEPHYR_EXTRA_MODULES']) {
    assert.deepEqual((await listBoardChoices(s,{...env,[name]:'modules/本地'},'west',unused,catalog)).items,items);
  }
  assert.deepEqual((await listBoardChoices(s,env,'CMake',unused,catalog)).items,items);
  s.manifest.uri.fsPath = path.join(s.setup.app,'west.yml');
  assert.deepEqual((await listBoardChoices(s,env,'west',unused,catalog)).items,items);
});

test('a broken manifest board leaves valid catalog targets visible with diagnostics and no command dump', async t => {
  const {s,env} = await fixture(t);
  const run = async (_program,args) => {
    if (args.includes('--help')) return {stdout:currentHelp};
    throw Object.assign(Error('Command failed: private arguments'),{stderr:'Traceback…\nValueError: bad board\n'});
  };
  const boardIssue = {kind:'boardFile',path:path.join(s.setup.app,'board.yml'),message:'Invalid board'};
  const catalog = async () => ({boards:[hardware],diagnostics:[boardIssue]});
  const result = await listBoardChoices(s,env,'west',run,catalog);
  assert.deepEqual(result,{items,diagnostics:[{kind:'west',message:'ValueError: bad board'},boardIssue]});
});
