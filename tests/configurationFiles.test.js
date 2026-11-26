'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const load = Module._load;
let files;
try {
  Module._load = function(request,...rest) {return request === 'vscode' ? {l10n:{t:(v,p) => v.replace('{0}',p)}} : load.call(this,request,...rest);};
  files = require('../extension/configurationFiles');
} finally {Module._load = load;}

async function fixture(t) {
  const app = await fs.mkdtemp(path.join(os.tmpdir(),'zephyr-inputs-'));
  t.after(() => fs.rm(app,{recursive:true,force:true}));
  const build = path.join(app,'artifacts'), stored = new Map();
  const context = {workspaceState:{get:(k,f) => stored.get(k) ?? f, update:async(k,v) => stored.set(k,v)}};
  const f = name => path.join(app,name);
  async function add(name,content = '') {
    await fs.mkdir(path.dirname(f(name)),{recursive:true});
    await fs.writeFile(f(name),content);
    return f(name);
  }
  const s = {folder:{uri:{toString:() => app}},build:{fsPath:build},target:{cache:new Map()},
    setup:{app,board:'widget@2.0/chip/cpu',cacheStatus:'absent'},
    devicetree:{boardLayout:{name:'widget',revision:'2.0',qualifier:'chip/cpu',singleSoc:true}}};
  await add('CMakeLists.txt','find_package(Zephyr REQUIRED)');
  async function inspect(args = [],env = {}) {
    const plan = await files.filePlan(context,s,s.setup,args,env);
    Object.assign(s.setup,{fileRows:plan.rows,fileConfigRoot:plan.root,plan:{configure:plan.configure}});
    return {plan,groups:await files.describeFiles(context,s,env)};
  }
  const choose = (kind,values) => files.selectFiles(context,s,kind,values);
  return {app,s,context,add,inspect,choose,f};
}

test('preview follows board/SoC/revision/FILE_SUFFIX order; relative config dir can differ from the app', async t => {
  const {add,inspect,f} = await fixture(t);
  const prefix = 'config area/';
  const conf = ['prj_release.conf','socs/chip_cpu.conf','boards/widget_cpu.conf','boards/widget_chip_cpu_2_0.conf'];
  const overlays = ['socs/chip_cpu.overlay','boards/widget_cpu_2_0.overlay'];
  for (const name of [...conf,...overlays,'prj.conf','app.overlay','boards/other.overlay']) await add(prefix + name);
  const externalToConfig=await add('hardware/manual.overlay');
  const {plan,groups} = await inspect(['-DAPPLICATION_CONFIG_DIR=config area','-DFILE_SUFFIX=release']);
  assert.ok(groups.overlay.candidates.includes(externalToConfig));
  assert.deepEqual(groups.kconfig.files,conf.map(n => f(prefix+n)));
  assert.deepEqual(groups.overlay.files,overlays.map(n => f(prefix+n)));
  assert.equal(groups.overlay.status,'resolved');
  assert.equal(plan.configure.some(a => a.startsWith('-DCONF_FILE')),false);
});

test('a sole nonstandard conf is an actionable suggestion; obsolete automatic cache ownership is released',async t => {
  const {add,inspect,context,s,f} = await fixture(t);
  const custom = await add('profile.conf');
  const initial = await inspect();
  assert.deepEqual(initial.groups.kconfig.files,[]);
  assert.equal(initial.groups.kconfig.status,'suggested');
  assert.equal(initial.groups.kconfig.suggestedFile,custom);
  assert.deepEqual(initial.plan.configure,[]);
  const normal = file => process.platform === 'win32' ? path.normalize(file).toLowerCase() : path.normalize(file);
  const oldScope = [s.folder.uri.toString(),normal(s.setup.app),s.setup.board,normal(s.build.fsPath)];
  await context.workspaceState.update('configurationFiles:' + JSON.stringify(oldScope) + ':applied',{kconfig:'profile.conf'});
  s.setup.cacheStatus = 'current';
  s.target.cache.set('CONF_FILE','profile.conf');
  await add('prj.conf');
  assert.deepEqual((await inspect()).plan.configure,['-UCONF_FILE']);
  s.target.cache.set('CONF_FILE','externally-picked.conf');
  assert.deepEqual((await inspect()).plan.configure,[]);
  assert.deepEqual((await inspect()).groups.kconfig.missing,[f('externally-picked.conf')]);
});

test('the picker sees nested profiles but never other applications, build outputs or virtual environments', async t => {
  const {add,inspect,f} = await fixture(t);
  for (const name of ['one.conf','two.conf','profiles/test/custom.conf','profiles/test/bsp/file.dts','profiles/test/app.overlay',
    'artifacts/custom.conf','old output/CMakeCache.txt','old output/foo.conf','.venv/dummy.conf',
    'child/CMakeLists.txt','child/ignored.conf']) await add(name,name.endsWith('CMakeLists.txt') ? 'find_package(Zephyr)' : '');
  const {groups,plan} = await inspect();
  assert.deepEqual(new Set(groups.kconfig.candidates),new Set(['one.conf','two.conf','profiles/test/custom.conf'].map(f)));
  assert.equal(groups.kconfig.status,'choose');
  assert.deepEqual(groups.dts.candidates,[f('profiles/test/bsp/file.dts')]);
  assert.deepEqual(groups.overlay.files,[]);
  assert.deepEqual(plan.configure,[]);
});

test('ordered GUI inputs override manual arguments temporarily, survive both routes, and release only their own cache',async t => {
  const {add,inspect,context,s,choose} = await fixture(t);
  const a=await add('a.conf'), b=await add('b.conf'), dts=await add('board.dts');
  await Promise.all([choose('kconfig',[b,a]),choose('dts',[dts])]);
  const explicit = ['-DCONF_FILE:STRING=keep.conf','-DEXTRA_CONF_FILE=extra.conf'];
  const active=await inspect(explicit);
  assert.deepEqual(active.groups.kconfig.files,[b,a]);
  assert.ok(active.plan.configure.includes('-DCONF_FILE=b.conf;a.conf'));
  assert.ok(active.plan.configure.includes('-DEXTRA_CONF_FILE=extra.conf'));
  await files.acknowledgeFileReset(context,active.plan.fileReset);
  s.target.cache.set('DTS_SOURCE',dts.replaceAll('\\','/'));
  s.setup.cacheStatus='current';
  await Promise.all([choose('kconfig',null),choose('dts',null)]);
  const reset = await inspect(explicit);
  assert.ok(reset.plan.configure.includes('-UDTS_SOURCE'));
  assert.ok(reset.plan.configure.includes(explicit[0]));
  assert.deepEqual(reset.groups.kconfig.missing,[path.join(s.setup.app,'keep.conf')]);
  const alternate = await add('next.conf');
  await choose('kconfig',[alternate]);
  await files.acknowledgeFileReset(context,reset.plan.fileReset);
  assert.deepEqual((await inspect()).groups.kconfig.files,[alternate]);
  s.setup.board='different';
  assert.equal((await inspect()).groups.kconfig.source,'automatic');
});

test('explicit GUI choices are verified again, and conflicts or dynamically selected files are never guessed',async t => {
  const {add,inspect,choose,s} = await fixture(t);
  const src = await add('prj.conf');
  await add('boards/widget_chip_cpu.overlay');
  await add('boards/widget_cpu.overlay');
  assert.equal((await inspect()).groups.overlay.status,'choose');
  await choose('kconfig',[src]);
  await fs.unlink(src);
  assert.equal((await inspect()).groups.kconfig.source,'manual');
  assert.deepEqual((await inspect()).groups.kconfig.missing,[src]);
  s.setup.board='fresh';
  await add('CMakeLists.txt','if(PROFILE)\nset(CONF_FILE ${PROFILE}.conf)\nendif()\nfind_package(Zephyr)');
  await add('lonely.conf');
  assert.equal((await inspect()).groups.kconfig.status,'configure');
  assert.deepEqual((await inspect()).plan.configure,[]);
});

test('undo before configure leaves the current build usable; a failed configure that changed the cache can be undone',async t => {
  const {add,s,choose,inspect} = await fixture(t);
  const baseline = await add('prj.conf'), alternate = await add('profile.conf');
  s.setup.cacheStatus = 'current';
  s.target.cache.set('CONF_FILE',baseline);
  await inspect();
  await choose('kconfig',[alternate]);
  assert.deepEqual((await inspect()).plan.configure,['-DCONF_FILE=profile.conf']);
  await choose('kconfig',null);
  const immediate = await inspect();
  assert.deepEqual(immediate.plan.configure,[]);
  assert.equal(immediate.groups.kconfig.source,'configured');
  assert.deepEqual(immediate.groups.kconfig.files,[baseline]);
  await choose('kconfig',[alternate]);
  s.target.cache.set('CONF_FILE','profile.conf');
  await choose('kconfig',null);
  assert.ok((await inspect()).plan.configure.includes('-UCONF_FILE'));
});

test('sysbuild, snippets and CMake hooks defer discovery; an actual configure identifies expanded primary inputs',async t => {
  const {add,s,inspect} = await fixture(t);
  const profile = await add('only.conf');
  for (const setting of ['-DCMAKE_PROJECT_INCLUDE=hooks.cmake','-DSNIPPET=usb','-DSYSBUILD=ON']) {
    const {plan,groups} = await inspect([setting]);
    assert.deepEqual(plan.configure,[setting]);
    assert.equal(groups.kconfig.status,'configure');
  }
  const args = ['-DCONF_FILE=${ZEPHYR_VENDOR_MODULE_DIR}/fragment.conf'];
  assert.equal((await inspect(args)).groups.kconfig.status,'configure');
  s.setup.cacheStatus='current';
  s.target.cache.set('CONF_FILE','${ZEPHYR_VENDOR_MODULE_DIR}/fragment.conf');
  s.target.confirmedInputs = {kconfig:[profile]};
  assert.deepEqual((await inspect()).groups.kconfig.files,[profile]);
  assert.equal((await inspect()).groups.kconfig.source,'configured');
});

test('confirmed explicit CMake expressions resolve to actual inputs only while the current plan matches the build',async t => {
  const {add,s,inspect} = await fixture(t);
  const real = await add('outside/fragments/live.conf');
  const expression = '${ZEPHYR_EXAMPLE_MODULE_DIR}/live.conf';
  const args = ['-DCONF_FILE=' + expression];
  s.setup.cacheStatus = 'current';
  s.target.cache.set('CONF_FILE',expression);
  s.target.confirmedInputs = {kconfig:[real]};
  const matched = (await inspect(args)).groups.kconfig;
  assert.equal(matched.status,'resolved');
  assert.equal(matched.source,'argument');
  assert.deepEqual(matched.files,[real]);
  assert.equal(matched.confirmedFiles,undefined);
  const changed = (await inspect(['-DCONF_FILE=${ZEPHYR_NEW_MODULE_DIR}/other.conf'])).groups.kconfig;
  assert.equal(changed.status,'configure');
  assert.deepEqual(changed.files,[]);
  assert.deepEqual(changed.confirmedFiles,[real]);
  s.setup.readiness = {build:['reconfigure']};
  assert.equal((await inspect(args)).groups.kconfig.status,'configure');
  s.setup.readiness.build = ['configureFailed'];
  const failed = (await inspect(args)).groups.kconfig;
  assert.equal(failed.status,'configure');
  assert.equal(failed.confirmedFiles,undefined);
});

test('empty definitions and default-free projects remain under CMake control',async t => {
  const {add,s,inspect} = await fixture(t);
  s.devicetree.detectionStatus = 'notFound';
  const defaults = await inspect();
  assert.equal(defaults.groups.kconfig.status,'configure');
  assert.equal(defaults.groups.dts.status,'configure');
  assert.deepEqual(defaults.plan.configure,[]);
  await add('vendor.conf');
  const explicit = ['-DCONF_FILE:STRING=','-DDTC_OVERLAY_FILE='];
  const empty = await inspect(explicit);
  assert.deepEqual(empty.plan.configure,explicit);
  assert.deepEqual(empty.groups.kconfig.files,[]);
  assert.equal(empty.groups.kconfig.suggestedFile,undefined);
  assert.equal((await inspect([],{CONF_FILE:''})).groups.kconfig.source,'environment');
});

test('project-managed board selections survive resolve and stay isolated from a pinned board in the same build',async t => {
  const {add,s,inspect,choose,context} = await fixture(t);
  const profile = await add('vendor/profile.kconfig'), override = await add('alternate.conf');
  await add('prj.conf');
  const pinned = s.setup.board;
  s.setup.projectBoard = true;
  s.setup.board = '';
  assert.ok(await choose('kconfig',[profile]));
  const first = await inspect();
  s.target.cache.set('CONF_FILE','vendor/profile.kconfig');
  await files.acknowledgeFileReset(context,first.plan.fileReset);
  s.setup.board = pinned;
  s.setup.cacheStatus = 'current';
  assert.deepEqual((await inspect()).groups.kconfig.files,[profile]);
  s.setup.projectBoard = false;
  const switched = await inspect();
  assert.deepEqual(switched.plan.configure,['-UCONF_FILE']);
  assert.equal(switched.groups.kconfig.source,'automatic');
  assert.ok(await choose('kconfig',[override]));
  const other = await inspect();
  assert.deepEqual(other.plan.configure,['-DCONF_FILE=alternate.conf']);
  s.target.cache.set('CONF_FILE','alternate.conf');
  await files.acknowledgeFileReset(context,other.plan.fileReset);
  s.setup.projectBoard = true;
  assert.deepEqual((await inspect()).plan.configure,['-DCONF_FILE=vendor/profile.kconfig']);
});

test('an explicitly chosen fragment keeps its own location when application CMake changes its configuration root',async t => {
  const {add,inspect,choose} = await fixture(t);
  await add('CMakeLists.txt','include(options.cmake)\nfind_package(Zephyr REQUIRED)');
  const profile = await add('profiles/selected');
  await inspect();
  assert.ok(await choose('kconfig',[profile]));
  const {plan,groups} = await inspect();
  assert.deepEqual(plan.configure,['-DCONF_FILE=' + profile.split(path.sep).join('/')]);
  assert.deepEqual(groups.kconfig.files,[profile]);
});

test('generated inputs can be selected while current and sysbuild image merge outputs are protected',async t => {
  const {add,s,inspect,choose} = await fixture(t);
  const input = await add('artifacts/vendor/prepared.settings');
  const merged = await add('artifacts/zephyr/.config');
  const imageTree = await add('artifacts/controller/zephyr/zephyr.dts');
  s.target.system = {domains:[{name:'controller',dir:path.join(s.build.fsPath,'controller')}]};
  assert.ok(await choose('kconfig',[input]));
  assert.deepEqual((await inspect()).groups.kconfig.files,[input]);
  await assert.rejects(choose('kconfig',[merged]),/rewrites/);
  await assert.rejects(choose('dts',[imageTree]),/rewrites/);
  assert.deepEqual((await inspect()).groups.kconfig.files,[input]);
});
