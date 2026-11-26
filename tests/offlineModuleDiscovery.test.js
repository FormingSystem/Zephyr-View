'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {host,uri,vscode,workspace_state} = require('./integration/adaptive-build-host.cjs');
const {moduleArguments} = require('../extension/moduleBuild');
const {parseDefinition} = require('../extension/buildVariables');

async function write(dir,file,text='') {
  const target=path.join(dir,file);
  await fs.mkdir(path.dirname(target),{recursive:true});
  await fs.writeFile(target,text);
  return target;
}

async function workspace(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'offline module '));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const source=path.join(root,'upstream'), peer=path.join(root,'unrelated'), app=path.join(source,'samples','hello');
  for (const checkout of [source,peer]) {
    await write(checkout,'VERSION');
    await write(checkout,'share/zephyr-package/cmake/ZephyrConfig.cmake');
  }
  await write(app,'CMakeLists.txt','find_package(Zephyr REQUIRED)\n');
  const driver=path.join(root,'modules','hal','driver');
  await write(driver,'zephyr/module.yaml','name: driver\n');
  await write(root,'legacy/zephyr/CMakeLists.txt');await write(root,'legacy/zephyr/Kconfig');
  await write(root,'incomplete/zephyr/Kconfig');
  const broken=await write(root,'modules/bad/zephyr/module.yml','name: [\n');
  await write(peer,'modules/foreign/zephyr/module.yml','name: foreign\n');
  const settings={};
  vscode.workspace.getConfiguration=()=>({get:(name,fallback)=>settings[name]??fallback});
  const state=workspace_state(),discovery=host.createDiscovery();
  const s={folder:{uri:uri(app)},build:uri(path.join(app,'out')),setup:{app},checkout:source,tools:{},saved:{},
    environment:{ZEPHYR_BASE:source},target:{app:uri(app),cache:new Map()},manifest:{projects:[{name:'driver',path:'modules/hal/driver'}]}};
  return {root,source,app,driver,broken,settings,state,discovery,s};
}

test('detached sample finds adjacent YAML and legacy modules, keeps local paths and isolates broken or foreign modules',async t=>{
  const {root,app,driver,broken,state,discovery,s}=await workspace(t);
  await discovery.apply(state,s);
  assert.deepEqual(s.localModules.map(x=>x.name).sort(),['driver','legacy']);
  assert.deepEqual(s.locations.diagnostics.map(x=>x.path),[broken]);
  const catalog=host.moduleCatalog;
  const rows=await catalog.rows(state,s,'CMake');
  const row=rows.find(([name])=>name==='driver');
  const driverDirectory=await fs.realpath(driver);
  assert.equal(row[5].kind,'local');assert.equal(row[5].path,driverDirectory);assert.equal(row[4],false);
  const target={app,cacheStatus:'absent'};
  assert.deepEqual(await moduleArguments(state,s,target,'CMake',[],{}),[]);
  const add=()=>catalog.operate(state,s,'CMake',{op:'add',value:{kind:'local',name:'driver',path:path.relative(app,driver)}});
  await add();await add();
  const selected=await catalog.rows(state,s,'CMake');
  assert.deepEqual(selected.filter(r=>r[4]).map(r=>r[0]),['driver']);
  const flags=await moduleArguments(state,s,target,'CMake',[],{});
  assert.ok(flags.includes('-DZEPHYR_MODULES='+driverDirectory.split(path.sep).join('/')));
  assert.ok(!flags.some(arg=>arg.includes(path.join(app,'modules'))));
  const external=path.join(root,'private','external');
  await write(external,'zephyr/module.yml','name: driver\n');
  await assert.rejects(catalog.operate(state,s,'CMake',{op:'add',value:{kind:'local',name:'driver',path:external}}));
});

test('explicit absolute and relative directories deduplicate junction aliases and report only malformed entries',async t=>{
  const {root,app,settings,s,discovery,state}=await workspace(t);
  const external=path.join(root,'private','external'),link=path.join(root,'alias');
  await write(external,'zephyr/module.yml','name: my-driver\n');
  await fs.symlink(external,link,process.platform==='win32'?'junction':'dir');
  settings.locations={modules:[path.relative(app,external),link,path.join(root,'missing')]};
  await discovery.apply(state,s);
  assert.deepEqual(s.localModules.map(({name,path})=>[name,path]),[['my-driver',await fs.realpath(external)]]);
  assert.ok(s.locations.diagnostics.some(row=>row.path===path.join(root,'missing','zephyr','module.yml')));
  s.manifest.projects.push({name:'custom',path:'modules/custom'});
  const custom=path.join(root,'another','custom');
  await write(custom,'zephyr/module.yml','name: custom\n');
  await host.moduleCatalog.operate(state,s,'CMake',{op:'add',value:{kind:'local',name:'custom',path:custom}});
  const row=(await host.moduleCatalog.rows(state,s,'CMake')).find(entry=>entry[0]==='custom');
  assert.equal(row[5].path,await fs.realpath(custom));assert.equal(row[4],true);
});

test('project CMake and explicit module lists are preserved; deselecting releases only extension-owned cache entries',async t=>{
  const {driver,app,s,state}=await workspace(t);
  s.localModules=[{name:'driver',path:driver}];
  const cat=host.moduleCatalog;
  const saved={selected:['driver'],extras:[]};
  await state.workspaceState.update(cat.scope(s,'CMake'),saved);
  const target={app,cacheStatus:'current'},portable=driver.split(path.sep).join('/');
  const args=(extra=[])=>moduleArguments(state,s,target,'CMake',extra,{});
  const defs=flags=>new Map(flags.map(parseDefinition).filter(Boolean).map(d=>[d.name,d.value]));
  const simple=await args(); s.target.cache=defs(simple);
  assert.deepEqual(await args(),simple);
  await write(app,'CMakeLists.txt','set(ZEPHYR_MODULES "${CMAKE_CURRENT_LIST_DIR}/project-driver")\nfind_package(Zephyr REQUIRED)\n');
  const supplementary=await args();
  assert.ok(supplementary.includes('-UZEPHYR_MODULES'));
  assert.equal(defs(supplementary).get('EXTRA_ZEPHYR_MODULES'),portable);
  const custom=['-DZEPHYR_MODULES=keep','-DEXTRA_ZEPHYR_MODULES:STRING=extra'];
  const combined=await args(custom);
  assert.ok(combined.includes(custom[0]));
  assert.ok(combined.includes(custom[1]+';'+portable));
  s.target.cache=defs(combined);
  await state.workspaceState.update(cat.scope(s,'CMake'),{...saved,selected:[]});
  assert.ok((await args()).includes('-DEXTRA_ZEPHYR_MODULES=extra'));
  s.target.cache.set('EXTRA_ZEPHYR_MODULES','changed-outside');
  assert.deepEqual(await args(),['-UZEPHYR_EXTENSION_MODULE_INPUT']);
});

test('a standalone app preserves modules discovered from the selected Zephyr checkout',async t=>{
  const {root,source,driver,s,state}=await workspace(t);
  const app=path.join(root,'product');
  await write(app,'CMakeLists.txt','find_package(Zephyr REQUIRED)\n');
  s.setup.app=app;
  s.localModules=[{name:'driver',path:driver}];
  await state.workspaceState.update(host.moduleCatalog.scope(s,'CMake'),{selected:['driver'],extras:[]});
  const values=async(status,env)=> (await moduleArguments(state,s,{app,cacheStatus:status},'CMake',[],env))
    .map(parseDefinition).filter(Boolean).map(def=>def.name);
  s.target.cache.set('WEST','python;-m;west');
  assert.ok((await values('current',{})).includes('EXTRA_ZEPHYR_MODULES'));
  s.target.cache.set('WEST','WEST-NOTFOUND');
  assert.ok((await values('current',{})).includes('ZEPHYR_MODULES'));

  // Exercise a fresh build with no cache, both with and without west in its Python environment.
  const site=path.join(root,'site');
  await write(site,'west/__init__.py');
  await write(site,'west/util.py','from pathlib import Path\ndef west_topdir():\n    assert Path(".west/config").is_file()\n');
  await write(source,'.west/config','[manifest]\npath = manifest\n');
  s.tools.python=process.platform==='win32' ? 'python' : 'python3';
  const environment={...process.env,ZEPHYR_BASE:source,PYTHONPATH:site};
  assert.ok((await values('absent',environment)).includes('EXTRA_ZEPHYR_MODULES'));
  const isolated=path.join(root,'standalone-site');
  await write(isolated,'west.py','raise ImportError("west is not installed")\n');
  assert.ok((await values('absent',{...environment,PYTHONPATH:isolated})).includes('ZEPHYR_MODULES'));
});

test('generated image metadata exposes application-owned modules even when nobody selected them',async t=>{
  const {root,s,state}=await workspace(t);
  const external=path.join(root,'private','library');
  await write(external,'zephyr/module.yml','name: private\n');
  const image=path.join(s.build.fsPath,'main-image');
  await write(image,'zephyr_modules.txt','"private":"'+external.split(path.sep).join('/')+'":""\n');
  s.target.buildDir=uri(image);s.target.generated=true;s.setup.cacheStatus='current';
  const catalog=host.moduleCatalog;
  assert.deepEqual(await catalog.resolvedModules(s),[{name:'private',path:external,evidence:'zephyr_modules.txt'}]);
  const row=(await catalog.rows(state,s,'CMake')).find(r=>r[0]==='private');
  assert.equal(row[4],false);assert.equal(row[6].configured,true);
  await write(image,'Kconfig/Kconfig.modules','# No west and no Zephyr modules\n');
  assert.deepEqual(await catalog.resolvedModules(s),[]);
  s.setup.cacheStatus='conflict';
  assert.deepEqual(await catalog.resolvedModules(s),[]);
});

test('project file includes preserve a primary list without disabling unrelated offline selections',async t=>{
  const {driver,app,s,state}=await workspace(t);
  s.localModules=[{name:'driver',path:driver}];
  await state.workspaceState.update(host.moduleCatalog.scope(s,'CMake'),{selected:['driver'],extras:[]});
  await write(app,'CMakeLists.txt','include("${CMAKE_CURRENT_LIST_DIR}/cmake/options.cmake")\nfind_package(Zephyr REQUIRED)\n');
  await write(app,'cmake/options.cmake','include("${CMAKE_CURRENT_LIST_DIR}/project.cmake")\n');
  const args=()=>moduleArguments(state,s,{app,cacheStatus:'absent'},'CMake',[],{});
  await write(app,'cmake/project.cmake','set(APP_FEATURE ON)\n# set(ZEPHYR_MODULES ignored)\n');
  assert.ok((await args()).some(arg=>arg.startsWith('-DZEPHYR_MODULES=')));
  await write(app,'cmake/project.cmake','set(ZEPHYR_MODULES "${CMAKE_CURRENT_LIST_DIR}/../private")\n');
  const plan=await args();
  assert.ok(plan.some(arg=>arg.startsWith('-DEXTRA_ZEPHYR_MODULES=')));
  assert.ok(!plan.some(arg=>arg.startsWith('-DZEPHYR_MODULES=')));
});
