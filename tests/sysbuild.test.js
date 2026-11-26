'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const {buildMode,buildLayout} = require('../extension/sysbuild');
const {host,uri,workspace_state,yaml} = require('./integration/adaptive-build-host.cjs');

const cwd = path.resolve('workspace');
const app = path.join(cwd,'firmware');
const base = path.join(cwd,'zephyr');
const noWestLookup = () => assert.fail('A known build mode does not need west configuration');
const options = {app,cwd,base,target:{},method:'west',westDefault:()=>undefined};

async function layoutFor(options,definitions) {
  return buildLayout(await buildMode(options),options,definitions);
}

test('new trees use the explicit choice first, then west settings for west builds',async () => {
  const direct = await layoutFor({...options,method:'CMake',westDefault:noWestLookup},[]);
  assert.equal(direct.source,app);
  assert.equal(direct.enabled,false);
  const system = await layoutFor({...options,westDefault:()=> 'ON'},[]);
  assert.equal(system.source,path.join(base,'share','sysbuild'));
  assert.deepEqual(system.westOptions,['--sysbuild']);
  assert.deepEqual((await layoutFor({...options,preference:false},[])).westOptions,[]);
  const unspecified = await layoutFor({...options,method:'CMake',base:undefined,preference:true},[]);
  assert.equal(unspecified.issue,'systemSource');
});

test('an existing cache determines the build mode and the source of a sysbuild tree',async () => {
  const single = await layoutFor({...options,target:{cacheFile:{}},preference:true},[]);
  assert.equal(single.enabled,false);
  assert.deepEqual(single.westOptions,[]);
  const source = path.join(cwd,'other-source','share','sysbuild');
  const target = {cacheFile:{},system:{cache:new Map([['CMAKE_HOME_DIRECTORY',source]])}};
  const reused = await layoutFor({...options,target,base:undefined,preference:false,westDefault:noWestLookup},[]);
  assert.ok(reused.enabled);
  assert.equal(reused.source,source);
  assert.deepEqual(reused.westOptions,['--sysbuild']);
});

test('single-image plans omit sysbuild switches unless west enables sysbuild by default',async () => {
  for (const overrides of [{target:{cacheFile:{}}},{preference:false}]) {
    for (const value of [undefined, 'false', 'OFF', '0', 'yes']) {
      const {enabled,westOptions} = await buildMode({...options,...overrides,westDefault:()=>value});
      assert.equal(enabled,false);
      assert.deepEqual(westOptions,value === 'yes' ? ['--no-sysbuild'] : []);
    }
  }
});

test('sysbuild canonicalizes the matching APP_DIR and rejects a different effective value',async () => {
  const args = ['-DOTHER=on','-DAPP_DIR:PATH=old','-DAPP_DIR=firmware'];
  const layout = await layoutFor({...options,preference:true},args);
  assert.equal(layout.appConflict,false);
  assert.deepEqual(layout.required,['-DAPP_DIR:PATH=' + app.split(path.sep).join('/')]);
  assert.deepEqual(layout.definitions,['-DOTHER=on']);
  for (const conflict of ['-DAPP_DIR=different','-DAPP_DIR:PATH=']) {
    assert.ok((await layoutFor({...options,preference:true},[conflict])).appConflict);
  }
  assert.deepEqual((await layoutFor({...options,preference:false},args)).definitions,args);
});

async function root_fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'zephyr-domains-'));
  t.after(()=>fs.rm(root,{force:true,recursive:true}));
  const project = path.join(root,'source'), dir = path.join(root,'build');
  const mainDir = path.join(dir,'images','cpu0'), otherDir = path.join(dir,'images','cpu1');
  await fs.mkdir(project);
  await fs.mkdir(mainDir,{recursive:true});
  await fs.writeFile(path.join(project,'CMakeLists.txt'),'');
  await fs.writeFile(path.join(dir,'CMakeCache.txt'),[
    'CMAKE_PROJECT_NAME:STATIC=sysbuild_toplevel','CMAKE_HOME_DIRECTORY:INTERNAL='+base,
    'APPLICATION_SOURCE_DIR:PATH='+path.join(base,'template'),'APP_DIR:PATH='+project,
    'CMAKE_CACHEFILE_DIR:INTERNAL='+dir,'CACHED_BOARD:STRING=alpha','CMAKE_GENERATOR:INTERNAL=Ninja'
  ].join('\n'));
  await fs.writeFile(path.join(dir,'build.ninja'),'');
  const domains = {default:'main',build_dir:dir,domains:[
    {name:'other',build_dir:otherDir},{name:'main',build_dir:mainDir}]};
  return {folder:{uri:uri(project)},project,dir,mainDir,domains};
}

test('the default domain supplies image metadata from its declared directory',async t => {
  const {folder,project,dir,mainDir,domains} = await root_fixture(t);
  await fs.writeFile(path.join(dir,'domains.yaml'),yaml.dump(domains));
  await fs.writeFile(path.join(mainDir,'CMakeCache.txt'),[
    'APPLICATION_SOURCE_DIR:PATH='+project,'CACHED_BOARD:STRING=alpha/cpu0','CMAKE_GENERATOR:INTERNAL=Ninja'
  ].join('\n'));
  await fs.writeFile(path.join(mainDir,'build.ninja'),'');
  const target = await host.readTarget(folder,uri(dir));
  assert.equal(target.app.fsPath,project);
  assert.equal(target.buildDir.fsPath,mainDir);
  assert.equal(target.system.root,dir);
  assert.equal(target.board,'alpha/cpu0');
  assert.ok(target.generated);
});

test('an incomplete default domain keeps the application and can be reconfigured but cannot build',async t => {
  const {folder,project,dir,domains} = await root_fixture(t);
  const s = {folder,build:uri(dir),tools:{cmake:'cmake'},saved:{},environment:{},
    manifest:{projects:[]}};
  const ctx=workspace_state();
  for (const main of ['unknown','main']) {
    await fs.writeFile(path.join(dir,'domains.yaml'),yaml.dump({...domains,default:main}));
    s.target=await host.readTarget(folder,s.build);
    assert.equal(s.target.system.root,dir);
    assert.equal(s.target.app.fsPath,project);
    assert.equal(s.target.cacheFile.fsPath,path.join(dir,'CMakeCache.txt'));
    assert.equal(s.target.generated,false);
    s.setup=await host.describe(ctx,s,'CMake');
    assert.ok(s.setup.system);
    assert.ok(s.setup.canConfigure);
    assert.equal(s.setup.canBuild,false);
    assert.ok(s.setup.readiness.build.includes('configureFirst'));
  }
  await host.saveArguments(ctx,s,'APP_DIR='+path.join(dir,'other'));
  s.setup=await host.describe(ctx,s,'CMake');
  assert.equal(s.setup.canConfigure,false);
  assert.ok(s.setup.readiness.configure.includes('arguments'));
  assert.match(s.setup.error,/APP_DIR/);
});
