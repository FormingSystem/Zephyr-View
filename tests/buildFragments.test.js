'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const uri = file => ({fsPath:file, scheme:'file', toString:() => file});
const vscode = {
  Uri:{file:uri}, FileType:{File:1}, l10n:{t:text => text},
  workspace:{isTrusted:true, fs:{stat: async file => ({type:(await fs.stat(file.fsPath)).isFile() ? 1 : 2})}}
};
const load = Module._load;
let setup;
try {
  Module._load = function(request, ...rest) { return request === 'vscode' ? vscode : load.call(this, request, ...rest); };
  setup = require('../extension/buildSetup');
} finally { Module._load = load; }

async function fixture(t) {
  const app = await fs.mkdtemp(path.join(os.tmpdir(), 'zephyr sample '));
  t.after(() => fs.rm(app, {recursive:true, force:true}));
  const build = path.join(app, 'build'), configDir = path.join(app, 'board settings');
  await Promise.all([fs.mkdir(build), fs.mkdir(configDir), fs.writeFile(path.join(app, 'CMakeLists.txt'), '')]);
  const cache = new Map(Object.entries({APPLICATION_SOURCE_DIR:app, CMAKE_CACHEFILE_DIR:build,
    APPLICATION_CONFIG_DIR:configDir, BOARD:'sample', EXTRA_CONF_FILE:'cached.conf;preserve.conf'}));
  const state = new Map([['buildSetup.board:' + app, 'sample']]);
  const context = {workspaceState:{get:(k,v) => state.get(k) ?? v, update:async(k,v) => {state.set(k,v);}}};
  const snapshot = {folder:{uri:uri(app)}, build:uri(build), inputs:[], manifest:{projects:[]},
    tools:{cmake:'cmake',west:'west'}, environment:{EXTRA_CONF_FILE:'environment.conf'},
    target:{app:uri(app),cacheFile:uri(path.join(build,'CMakeCache.txt')),cache,board:'sample',generated:true}};
  const describe = async (method='CMake') => snapshot.setup = await setup.describe(context,snapshot,method);
  const include = filename => setup.includeFragment(context,snapshot,filename,() => true);
  const add = async (filename, kind) => {
    const file = path.join(app, filename);
    await fs.writeFile(file, '');
    snapshot.inputs.push({file, kind, applied:false});
    return file;
  };
  await describe();
  return {app,build,configDir,state,context,snapshot,describe,include,add};
}

test('additional fragments preserve explicit and cached ordering for both configure commands', async t => {
  const f = await fixture(t);
  const extra = await f.add('board settings/added.conf', 'kconfig');
  const overlay = await f.add('added.overlay', 'device');
  const env = await f.add('board settings/environment.conf', 'kconfig');
  await setup.saveArguments(f.context, f.snapshot, 'EXTRA_DTC_OVERLAY_FILE:STRING=first.overlay;second.overlay\nMY_TEST=ok');
  await f.describe();
  assert.deepEqual(await Promise.all([f.include('board settings/added.conf'),f.include(overlay)]),[true,true]);
  assert.equal(await f.include(extra),false);
  assert.equal(await f.include(env),false);
  for (const method of ['west','CMake']) {
    const result = await f.describe(method), args = result.plan.configure;
    assert.deepEqual(result.includedFragments,[extra,overlay]);
    assert.ok(args.includes('-DEXTRA_CONF_FILE=cached.conf;preserve.conf;added.conf'));
    assert.ok(args.includes('-DEXTRA_DTC_OVERLAY_FILE:STRING=first.overlay;second.overlay;added.overlay'));
    assert.equal(args.filter(arg => arg.startsWith('-DEXTRA_DTC_OVERLAY_FILE')).length,1);
    assert.ok(args.includes('-DMY_TEST=ok'));
    assert.equal(args.includes('--'),method === 'west');
    assert.equal(result.readiness.build.includes('reconfigure'),true);
  }
  f.state.set('buildSetup.board:' + f.app,'other');
  assert.deepEqual((await f.describe()).includedFragments,[]);
  f.state.set('buildSetup.board:' + f.app,'sample');
  f.snapshot.build=uri(path.join(f.app,'build-sibling'));
  assert.deepEqual((await f.describe()).includedFragments,[]);
});

test('registration is explicit, excludes generated and unsaved inputs, and rejects unsupported Zephyr list paths', async t => {
  const f = await fixture(t);
  const spaces = await f.add('board settings/file with spaces.conf','kconfig');
  const generated = await f.add('build/generated.conf','kconfig');
  await assert.rejects(f.include(spaces),/fragment path/);
  await assert.rejects(f.include(generated),/build directory/);
  await assert.rejects(f.include('missing.conf'),/Reopen/);
  const original = await f.add('board settings/selected.conf','kconfig');
  f.snapshot.inputs.at(-1).applied=true;
  assert.equal(await f.include(original),false);
  f.snapshot.inputs.at(-1).applied=false;
  assert.equal(await setup.includeFragment(f.context,f.snapshot,original,() => false),false);
  assert.deepEqual((await f.describe()).includedFragments,[]);
});
