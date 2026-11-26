'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {boardCatalogBase, readBoardCatalog} = require('../extension/boardCatalog');

test('the board reader and its module settings follow the selected checkout across sibling repositories', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'board-catalog-'));
  t.after(() => fs.rm(root, {recursive:true, force:true}));
  const opened = path.join(root,'opened'), sibling = path.join(root,'sibling');
  const app = path.join(opened,'samples','demo');
  await fs.mkdir(app,{recursive:true});
  for (const base of [opened,sibling]) {
    const scripts = path.join(base,'scripts');
    await fs.mkdir(scripts,{recursive:true});
    await fs.writeFile(path.join(scripts,'list_boards.py'), [
      'import os','from pathlib import Path','from types import SimpleNamespace',
      'def find_boards(args):',
      '    assert Path(os.environ["ZEPHYR_BASE"]) == Path(__file__).resolve().parent.parent',
      '    return [SimpleNamespace(name=p.name, dir=p) for p in args.board_roots]'
    ].join('\n'));
  }
  const state = {folder:{uri:{fsPath:app}}, tools:{}, checkout:opened,
    manifest:{root:{fsPath:root},uri:{fsPath:path.join(sibling,'west.yml')},checkout:sibling},
    setup:{app,cacheStatus:'current',plan:{configure:[]}},
    target:{cacheFile:{},cache:new Map([['ZEPHYR_BASE',sibling],['BOARD_ROOT',path.join(sibling,'stale-root')]])}};
  const env = {...process.env};
  delete env.ZEPHYR_BASE;
  delete env.BOARD_ROOT;
  assert.equal(await boardCatalogBase(state,env),opened);
  state.tools.west = 'west';
  const result = await readBoardCatalog(state,env);
  assert.deepEqual(result.boards.map(b=>b.name),['demo','opened']);
  assert.deepEqual(result.diagnostics,[]);
  state.setup.plan.configure = ['-DZEPHYR_BASE='+opened];
  assert.equal((await readBoardCatalog(state,{...env,ZEPHYR_BASE:sibling})).boards.at(-1).name,'opened');
  state.setup.plan.configure = ['-DZEPHYR_BASE='+path.join(root,'missing')];
  assert.equal(await boardCatalogBase(state,env),undefined);
});

test('a rejected manifest retains only the bound checkout’s valid local projects unless modules are overridden', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'partial-manifest-'));
  t.after(() => fs.rm(root,{recursive:true,force:true}));
  const base = path.join(root,'kernel'), sibling = path.join(root,'other'), app = path.join(base,'app');
  const workspace = path.join(root,'workspace'), port = path.join(workspace,'modules','port');
  const alternative = path.join(root,'replacement'), unrelated = path.join(root,'unrelated');
  await Promise.all([app,port,alternative,unrelated].map(dir=>fs.mkdir(dir,{recursive:true})));
  for (const dir of [base,sibling]) {
    const scripts = path.join(dir,'scripts');
    await fs.mkdir(scripts,{recursive:true});
    await fs.writeFile(path.join(scripts,'list_boards.py'),[
      'from types import SimpleNamespace',
      'def find_boards(args):',
      '    return [SimpleNamespace(name=p.name,dir=p) for p in args.board_roots]'
    ].join('\n'));
    await fs.writeFile(path.join(scripts,'zephyr_module.py'),[
      'from pathlib import Path','from types import SimpleNamespace',
      'def process_module(p):',
      '    assert Path(p).is_dir()',
      '    return {"name":Path(p).name,"build":{"settings":{"board_root":"."}}}',
      'def parse_modules(base,modules,extra_modules):',
      '    assert modules is not None',
      '    return [SimpleNamespace(project=p,meta=process_module(p)) for p in modules+extra_modules]'
    ].join('\n'));
    await fs.writeFile(path.join(scripts,'yaml.py'),'class YAMLError(Exception): pass\n');
  }
  const diagnostics = [{kind:'manifestFile',path:path.join(workspace,'west.yml'),message:'Invalid project entry'}];
  const state = {folder:{uri:{fsPath:app}}, setup:{app,plan:{configure:[]}}, target:{cache:new Map()}, checkout:base,
    tools:{west:'west'}, manifest:{invalid:true,checkout:base,root:{fsPath:workspace},diagnostics,
      projects:[{name:'working',path:'modules/port'},{name:'missing'},{name:'unrelated',path:'../unrelated'}]}};
  const env = {...process.env,ZEPHYR_BASE:base};
  for (const key of ['ZEPHYR_MODULES','EXTRA_ZEPHYR_MODULES','ZEPHYR_EXTRA_MODULES']) delete env[key];
  const read = () => readBoardCatalog(state,env,undefined,{board_root:[],arch_root:[],soc_root:[]});
  const recovered = await read();
  assert.deepEqual(recovered.boards.map(b=>b.name),['port','kernel']);
  assert.deepEqual(recovered.diagnostics,diagnostics);
  state.setup.plan.configure = ['-DZEPHYR_MODULES='+alternative];
  assert.deepEqual((await read()).boards.map(b=>b.name),['replacement','kernel']);
  state.setup.plan.configure = ['-DZEPHYR_BASE='+sibling];
  assert.deepEqual((await read()).boards.map(b=>b.name),['other']);
});
