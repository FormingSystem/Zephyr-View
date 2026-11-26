'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const {test} = require('node:test');
const {uri,vscode,workspace_state} = require('./integration/adaptive-build-host.cjs');
const {discoverApplications} = require('../extension/applicationCatalog');

const original = Module._load;
let inspectWorkspace, createDiscovery, resolve;
try {
  Module._load = function(name,...args) { return name === 'vscode' ? vscode : original.call(this,name,...args); };
  ({inspectWorkspace} = require('../extension/workspace'));
  ({createDiscovery} = require('../extension/workspaceLocations'));
  ({resolve} = require('../extension/environment'));
} finally { Module._load = original; }

async function write(dir, name, contents = '') {
  const file = path.join(dir,name);
  await fs.mkdir(path.dirname(file),{recursive:true});
  await fs.writeFile(file,contents,{mode:0o755});
  return file;
}

async function tree(root,name) {
  const source = path.join(root,name);
  const app = path.join(source,'samples',name);
  const python = path.join('.venv',process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python3');
  const manifest = 'manifest:\n  projects:\n    - name: hal_' + name + '\n';
  await Promise.all([write(source,'VERSION'),write(source,'share/zephyr-package/cmake/ZephyrConfig.cmake'),
    write(source,'west.yml',manifest),write(source,python),write(app,'CMakeLists.txt','find_package(Zephyr REQUIRED)')]);
  return {source,app,python:path.join(source,python)};
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'Zephyr 并排 '));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const [a,b] = await Promise.all([tree(root,'alpha'),tree(root,'beta')]);
  const prefs = new Map(), discovery = createDiscovery(), context = workspace_state();
  vscode.workspace.getConfiguration = (_,folder)=>({get:(key,fallback)=>prefs.get(folder.fsPath)?.[key] ?? fallback});
  const inherited = process.env.ZEPHYR_BASE;
  delete process.env.ZEPHYR_BASE;
  t.after(()=>{if(inherited !== undefined)process.env.ZEPHYR_BASE=inherited;});
  async function open(directory) {
    const folder = {uri:uri(directory)};
    const state = await inspectWorkspace({folder:()=>folder,buildDir:()=>uri(path.join(directory,'build'))},context,discovery);
    Object.assign(state,resolve(context,state));
    await discovery.apply(context,state);
    return state;
  }
  return {root,a,b,open,context,prefs,discovery};
}

test('opening either checkout or a nested sample selects its own source, manifest and interpreter',async t=>{
  const {root,a,b,open,discovery} = await fixture(t);
  for(const checkout of [a,b,a]) {
    for(const directory of [checkout.source,checkout.app]) {
      const s = await open(directory);
      assert.equal(s.environment.ZEPHYR_BASE,checkout.source);
      assert.equal(s.tools.python,checkout.python);
      assert.equal(s.manifest.uri.fsPath,path.join(checkout.source,'west.yml'));
      assert.deepEqual(await discoverApplications([root,checkout.source],checkout.source),[checkout.app]);
    }
  }
  const parent = await open(root);
  assert.equal(parent.environment.ZEPHYR_BASE,undefined);
  assert.deepEqual(parent.locations.groups.find(g=>g.key==='ZEPHYR_BASE').options.map(o=>o.path),['alpha','beta']);
  assert.deepEqual(await discoverApplications([root]),[]);
  for(const selected of [b,a]){
    discovery.choose({uri:uri(root)},'ZEPHYR_BASE',selected.source);
    const chosen=await open(root);
    assert.equal(chosen.environment.ZEPHYR_BASE,selected.source);
    assert.equal(chosen.tools.python,selected.python);
    assert.equal(chosen.manifest.uri.fsPath,path.join(selected.source,'west.yml'));
    assert.equal(chosen.locations.groups.find(g=>g.key==='ZEPHYR_BASE').options.length,2);
  }
});

test('west uses its manifest checkout, while a sibling source keeps its own tools and manifest',async t=>{
  const {root,a,b,open} = await fixture(t);
  await write(root,'.west/config','[manifest]\npath = alpha\n');
  const workspace = await open(root);
  assert.equal(workspace.environment.ZEPHYR_BASE,a.source);
  assert.equal(workspace.tools.python,a.python);
  const sibling = await open(b.app);
  assert.equal(sibling.environment.ZEPHYR_BASE,b.source);
  assert.equal(sibling.manifest.root,undefined);
  assert.equal(sibling.manifest.uri.fsPath,path.join(b.source,'west.yml'));
  assert.equal(sibling.tools.python,b.python);
});

test('workspace discovery selects its own firmware; the external checkout still supplies explicitly searchable samples',async t=>{
  const {root,b,open,prefs,discovery}=await fixture(t);
  const workspace=path.join(root,'product'),app=path.join(workspace,'apps','sensor');
  await write(app,'CMakeLists.txt','find_package(Zephyr REQUIRED)');
  await write(b.source,'doc/CMakeLists.txt','project(Zephyr-Kernel-Doc LANGUAGES)\nfind_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE} .. COMPONENTS doc)');
  const external=path.join(b.source,'example');
  await write(external,'CMakeLists.txt','find_package(Zephyr REQUIRED)');
  prefs.set(workspace,{locations:{ZEPHYR_BASE:b.source}});
  let s=await open(workspace);
  assert.equal(s.application,app);
  assert.deepEqual(s.locations.groups.find(g=>g.key==='application').options.map(o=>o.path),['apps/sensor']);
  assert.deepEqual(await discoverApplications([b.source],b.source),[external,b.app].sort());
  await write(workspace,'apps/display/CMakeLists.txt','find_package(Zephyr REQUIRED)');
  discovery.reset({uri:uri(workspace)});
  s=await open(workspace);
  assert.equal(s.application,undefined);
  const group=s.locations.groups.find(g=>g.key==='application');
  assert.deepEqual(group.options.map(o=>o.path),['apps/display','apps/sensor']);
  assert.equal(group.selected,'');
  const empty=path.join(root,'unconfigured');
  await fs.mkdir(empty);prefs.set(empty,{locations:{ZEPHYR_BASE:b.source}});
  assert.equal((await open(empty)).locations.groups.some(g=>g.key==='application'),false);
});

test('a manifest-owned Zephyr project can have an arbitrary path beside another source checkout',async t=>{
  const {root,a,b,open} = await fixture(t);
  await write(root,'.west/config','[manifest]\npath = product\nfile = manifest/local.yml\n');
  await write(root,'product/manifest/local.yml','manifest:\n  projects:\n    - name: zephyr\n      path: beta\n');
  const s=await open(root);
  assert.equal(s.manifest.checkout,b.source);
  assert.equal(s.checkout,b.source);
  assert.equal(s.environment.ZEPHYR_BASE,b.source);
  assert.equal(s.tools.python,b.python);
  assert.equal((await open(a.source)).manifest.checkout,a.source);
});

test('an equivalent source reached through a junction or symlink keeps its original west workspace',async t=>{
  const {root,a,open,context,prefs}=await fixture(t);
  await write(root,'.west/config','[manifest]\npath = alpha\n');
  // Place the link outside the topdir. Following its parent lexically cannot find .west.
  const outside=await fs.mkdtemp(path.join(os.tmpdir(),'source-link-'));
  t.after(()=>fs.rm(outside,{recursive:true,force:true}));
  const alias=path.join(outside,'source');
  await fs.symlink(a.source,alias,process.platform==='win32'?'junction':'dir');
  prefs.set(a.source,{locations:{ZEPHYR_BASE:alias}});
  await context.workspaceState.update('workbench.method:'+uri(a.source).toString(),'west');
  const s=await open(a.source);
  assert.equal(s.manifest.root?.fsPath,root);
  assert.equal(s.manifest.uri.fsPath,path.join(a.source,'west.yml'));
  assert.equal(await fs.realpath(s.environment.ZEPHYR_BASE),await fs.realpath(a.source));
});

test('an explicitly selected source, application and external SDK survive switching workspace folders',async t=>{
  const {root,a,b,open,prefs,context} = await fixture(t);
  const sdk=path.join(root,'shared SDK');
  prefs.set(a.source,{locations:{application:b.app,ZEPHYR_BASE:b.source,ZEPHYR_SDK_INSTALL_DIR:sdk}});
  const s = await open(a.source);
  assert.equal(s.environment.ZEPHYR_BASE,b.source);
  assert.equal(s.environment.ZEPHYR_SDK_INSTALL_DIR,sdk);
  assert.equal(s.application,b.app);
  assert.equal(s.tools.python,b.python);
  assert.equal(s.manifest.checkout,b.source);
  assert.equal(s.manifest.uri.fsPath,path.join(b.source,'west.yml'));
  await context.workspaceState.update('environment.v1:'+uri(a.source).toString(),{ZEPHYR_BASE:a.source});
  assert.equal((await open(a.source)).environment.ZEPHYR_BASE,a.source);
  assert.equal((await open(b.source)).environment.ZEPHYR_SDK_INSTALL_DIR,process.env.ZEPHYR_SDK_INSTALL_DIR);
});

test('a build cache recorded by the adjacent checkout cannot select its source or its application',async t=>{
  const {a,b,open} = await fixture(t);
  const cache=['APPLICATION_SOURCE_DIR:PATH='+b.app,'CACHED_BOARD:STRING=board_b','ZEPHYR_BASE:PATH='+b.source];
  await write(a.source,'build/CMakeCache.txt',cache.join('\n'));
  const s=await open(a.source);
  assert.equal(s.environment.ZEPHYR_BASE,a.source);
  assert.notEqual(s.application,b.app);
});

test('an explicitly exported source takes precedence over the opened checkout and is attributed to the process',async t=>{
  const {a,b,open}=await fixture(t);
  process.env.ZEPHYR_BASE=b.source;
  try {
    const s=await open(a.source);
    assert.equal(s.environment.ZEPHYR_BASE,b.source);
    assert.equal(s.locations.origins.ZEPHYR_BASE,undefined);
    assert.equal(s.environmentOrigins.ZEPHYR_BASE,undefined);
    assert.equal(s.manifest.checkout,b.source);
  } finally { delete process.env.ZEPHYR_BASE; }
});

test('broken manifest and module files name their source alongside valid candidates',async t=>{
  const {root,a,open,discovery,prefs} = await fixture(t);
  const config = await write(root,'.west/config','[manifest]\nfile=west.yml\n');
  assert.deepEqual((await open(root)).manifest.diagnostics.map(d=>[d.kind,d.path]),[['westConfig',config]]);
  await write(root,'.west/config','[manifest]\npath = alpha\n');
  const manifest=await write(a.source,'west.yml','manifest: [\n');
  const broken=await write(root,'modules/broken/zephyr/module.yml','name: [\n');
  await write(root,'modules/ok/zephyr/module.yml','name: ok\n');
  discovery.reset({uri:uri(root)});
  const s=await open(root);
  assert.deepEqual(s.manifest.diagnostics.map(d=>[d.kind,d.path]),[['manifestFile',manifest]]);
  assert.deepEqual(s.locations.diagnostics.map(d=>[d.kind,d.path]),[['moduleFile',broken]]);
  assert.ok(s.locations.diagnostics[0].message);
  assert.ok(s.localModules.some(module=>module.name==='ok'));
  await write(a.source,'west.yml','manifest:\n  projects:\n    - name: good\n    - name: zephyr\n      path: [bad]\n');
  const partial=await open(root);
  assert.equal(partial.manifest.invalid,true);
  assert.deepEqual(partial.manifest.projects.map(project=>project.name),['good']);
  assert.match(partial.manifest.diagnostics[0].message,/manifest\.projects\[1\]/);
  const external=path.join(root,'separate','external');
  const externalMetadata=await write(external,'zephyr/module.yaml','name: [bad,name]\n');
  const missing=path.join(root,'other-module');
  prefs.set(root,{locations:{modules:[external,missing]}});
  const explicit=await open(root);
  assert.ok(explicit.locations.diagnostics.some(d=>d.path===externalMetadata));
  assert.ok(explicit.locations.diagnostics.some(d=>d.path===path.join(missing,'zephyr','module.yml')));
});
