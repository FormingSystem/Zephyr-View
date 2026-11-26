'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const {test} = require('node:test');
const {buildVariables, previewPlan} = require('../extension/buildVariables');

const app = path.resolve('fixture', 'hello world');
const build = path.join(app, 'build');
const uri = file => ({fsPath: path.normalize(file), scheme: 'file', toString: () => file});
const files = new Map();
const vscode = {
  Uri: {file: uri, joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts))},
  FileType: {File: 1},
  l10n: {t: text => text},
  workspace: {fs: {
    readFile: async file => Buffer.from(files.get(file.fsPath) ?? ''),
    stat: async file => ({type: files.has(file.fsPath) ? 1 : 0})
  }}
};

// Only substitute VS Code's file service; use the actual target parser and configure planner.
const load = Module._load;
let setup, readTarget;
try {
  Module._load = function(request, ...rest) {
    return request === 'vscode' ? vscode : load.call(this, request, ...rest);
  };
  setup = require('../extension/buildSetup');
  ({readTarget} = require('../extension/target'));
} finally {
  Module._load = load;
}

async function inspect(options = {}) {
  const {cache, directory = build, application = app, board = 'mps2/an386', args = '',
    method = 'CMake', environment = {}, westGenerator, tools = {cmake: 'cmake', west: 'west'},
    manifest = {root: uri(app), uri: uri(path.join(app,'west.yml')), projects: []}, generated = false,
    sourceCheckout = false, applicationExists = true} = options;
  files.clear();
  if(applicationExists)files.set(path.join(application, 'CMakeLists.txt'), '');
  if(sourceCheckout){
    files.set(path.join(application,'share/zephyr-package/cmake/ZephyrConfig.cmake'),'');
    files.set(path.join(application,'VERSION'),'');
  }
  if(generated)files.set(path.join(directory,'build.ninja'),'');
  if (cache) files.set(path.join(directory, 'CMakeCache.txt'), cache);
  const folder = {uri: uri(app)}, buildDir = uri(directory);
  const s = {folder, build: buildDir, target: await readTarget(folder, buildDir),
    tools, manifest, environment};
  const settings = new Map([['buildSetup.app:' + app, application]]);
  if (board !== null) settings.set('buildSetup.board:' + app, board);
  const context = {workspaceState: {get(key, fallback) {
    return key.startsWith('buildSetup.arguments:') ? args : settings.get(key) ?? fallback;
  }}};
  s.setup = await setup.describe(context, s, method);
  const variables = buildVariables(s, method, environment, westGenerator);
  return {...s.setup, status: variables.status, rows: Object.fromEntries(variables.rows.map(r => [r.name, r]))};
}

const cache = [
  'APPLICATION_SOURCE_DIR:PATH=' + app, 'CMAKE_CACHEFILE_DIR:INTERNAL=' + build,
  'CACHED_BOARD:STRING=mps2/an386', 'CMAKE_GENERATOR:INTERNAL=Ninja',
  'CONF_FILE:STRING=old.conf', 'EMPTY:STRING=', 'ZERO:STRING=0', 'OPTION:BOOL=OFF',
  '//No help, variable specified on the command line.', 'BOARD-LIB:STRING=codec',
  'ZEPHYR_BASE:PATH=' + app, 'UNRELATED:INTERNAL=private'
].join('\r\n');

test('planned definitions and typed cached values preserve empty, 0, OFF and embedded equals', async () => {
  const args = 'CONF_FILE=new.conf\r\nEMPTY:STRING=\r\nZERO=0\nOPTION:BOOL=OFF\nSPACED \t=  part =value';
  const {rows, status} = await inspect({cache, args});
  assert.equal(status, 'current');
  assert.equal(rows.CONF_FILE.planned.value, 'new.conf');
  assert.equal(rows.CONF_FILE.configured.value, 'old.conf');
  for (const [name, value] of [['EMPTY', ''], ['ZERO', '0'], ['OPTION', 'OFF']]) {
    assert.equal(rows[name].planned.value, value);
    assert.equal(rows[name].configured.value, value);
  }
  assert.equal(rows.OPTION.configured.type, 'BOOL');
  assert.equal(rows.SPACED.planned.value, '  part =value');
  assert.equal(rows['BOARD-LIB'].configured.value, 'codec');
  assert.equal(rows.UNRELATED, undefined);
});

test('target and directory changes suppress all stale cache entries', async () => {
  for (const change of [{application: path.join(app, 'other')}, {board: 'other/cpu'}, {directory: build + '-copied'}]) {
    const {status, rows} = await inspect({cache, ...change});
    assert.equal(status, 'conflict');
    assert.ok(Object.values(rows).every(row => !row.configured));
  }
  assert.equal((await inspect({directory: build + '-new'})).status, 'absent');
  assert.equal((await inspect({cache: 'CMAKE_GENERATOR:INTERNAL=Ninja'})).status, 'unknown');
});

test('only a cache for the same application and directory supplies a default board', async () => {
  const current = await inspect({cache, board: null});
  assert.equal(current.rows.BOARD.planned.value, 'mps2/an386');
  for (const changed of [{application: path.join(app, 'other')}, {directory: build + '-copied'}]) {
    const missing = await inspect({cache, board: null, ...changed});
    assert.equal(missing.rows.BOARD.planned, undefined);
    assert.ok(!missing.plan.configure.includes('-DBOARD=mps2/an386'));
    const inherited = await inspect({cache, board: null, environment: {BOARD: 'from-env/cpu'}, ...changed});
    assert.equal(inherited.rows.BOARD.planned.value, 'from-env/cpu');
    assert.equal(inherited.rows.BOARD.configured, undefined);
    const explicit = await inspect({cache, board: 'manual/cpu', environment: {BOARD: 'from-env/cpu'}, ...changed});
    assert.equal(explicit.rows.BOARD.planned.value, 'manual/cpu');
  }
});

test('generator source follows the actual CMake command, environment, west configuration or cache', async () => {
  const fresh = await inspect();
  assert.ok(fresh.plan.configure.includes('-G'));
  assert.equal(fresh.rows.CMAKE_GENERATOR.planned.source, '-G');
  assert.equal(fresh.rows.CMAKE_GENERATOR.planned.value, 'Ninja');
  const environment = {CMAKE_GENERATOR: 'Unix Makefiles'};
  const custom = await inspect({environment});
  assert.ok(!custom.plan.configure.includes('-G'));
  assert.equal(custom.rows.CMAKE_GENERATOR.planned.source, 'env');
  const west = await inspect({method: 'west', environment, westGenerator: 'Ninja Multi-Config', cache});
  assert.equal(west.rows.CMAKE_GENERATOR.planned.source, 'west config');
  assert.equal(west.rows.CMAKE_GENERATOR.planned.value, 'Ninja Multi-Config');
  assert.equal(west.rows.CMAKE_GENERATOR.configured.value, 'Ninja');
  assert.equal((await inspect({method: 'west', environment})).rows.CMAKE_GENERATOR.planned, undefined);
});

test('credential values stay out of summaries and previews while the actual arguments are retained', async () => {
  const {rows, plan} = await inspect({args: 'API_TOKEN=private-value\nCUSTOM_URL=https://example.test/repo?token=private-value'});
  assert.equal(rows.API_TOKEN.planned.hidden, true);
  assert.equal(rows.CUSTOM_URL.planned.hidden, true);
  assert.ok(!JSON.stringify([rows, previewPlan(plan)]).includes('private-value'));
  assert.ok(plan.configure.some(arg => arg.includes('private-value')));
});

test('readiness lists every missing input and isolates west-only requirements', async () => {
  const empty = await setup.describe({}, {}, 'CMake');
  assert.deepEqual(empty.readiness, {configure:['folder'], build:['folder']});
  const missing = {tools:{}, manifest:{projects:[]}, board:null, applicationExists:false};
  const west = await inspect({...missing, method:'west'});
  assert.deepEqual(west.readiness.configure, ['cmake','west','workspace','application']);
  assert.deepEqual(west.readiness.build, [...west.readiness.configure,'configureFirst']);
  const direct = await inspect(missing);
  assert.deepEqual(direct.readiness.configure, ['cmake','application']);
  assert.equal(direct.canConfigure,false);
  assert.equal((await inspect({sourceCheckout:true})).readiness.configure.includes('application'),true);
  for(const manifest of [{root:uri(app), projects:[]}, {root:uri(app), uri:uri('west.yml'), invalid:true, projects:[]}]){
    assert.deepEqual((await inspect({method:'west', manifest})).readiness.configure,['manifest']);
  }
});

test('project-owned targets leave BOARD resolution to Zephyr in both configure routes', async () => {
  for (const method of ['CMake','west']) {
    const project=await inspect({method,board:null});
    assert.equal(project.canConfigure,true);
    assert.ok(!project.plan.configure.some(arg=>arg==='-b' || arg.startsWith('-DBOARD=')));
    const input=await inspect({method,board:null,args:'BOARD:STRING=lab_alias//cpu'});
    assert.equal(input.board,'lab_alias//cpu');
    assert.equal(input.rows.BOARD.planned.source,'-D');
    assert.ok(input.plan.configure.includes('-DBOARD:STRING=lab_alias//cpu'));
    assert.ok(!input.plan.configure.includes('-b'));
    const conflict=await inspect({method,board:'another',args:'BOARD=lab_alias'});
    assert.equal(conflict.canConfigure,false);
    assert.ok(conflict.readiness.configure.includes('arguments'));
  }
});

test('configure, build and reconfigure respond to the active target and toolchain', async () => {
  const ready = await inspect({cache,generated:true});
  assert.deepEqual(ready.readiness,{configure:[],build:[]});
  assert(ready.canConfigure && ready.canBuild);
  assert.deepEqual((await inspect({cache,generated:true,args:'ZERO=1'})).readiness.build,['reconfigure']);
  assert.deepEqual((await inspect({args:'missing_equals', directory:app})).readiness.configure,['directory','arguments']);
  assert.deepEqual((await inspect({cache,board:'another'})).readiness.configure,['directory']);
  assert.deepEqual((await inspect()).readiness.configure,[]); // CMake may discover the SDK and Ninja.
  assert.deepEqual((await inspect({args:'CMAKE_MAKE_PROGRAM='+process.execPath})).readiness.configure,[]);
  const broken = await inspect({args:'CMAKE_MAKE_PROGRAM='+path.join(build,'missing-build-tool')});
  assert.deepEqual(broken.readiness.configure,['ninja']);
});

test('west config supplies a default board only in a usable west workspace', async t => {
  const fs = require('node:fs/promises');
  const tmp = await fs.mkdtemp(path.join(require('node:os').tmpdir(),'zephyr-west-default-'));
  t.after(()=>fs.rm(tmp,{recursive:true,force:true}));
  // Node executes this local west stand-in with the same config command and workspace cwd.
  await fs.writeFile(path.join(tmp,'config'),"console.log(process.argv[2]==='build.board'?'local/cpu':'Ninja');");
  const options = {method:'west', board:null, tools:{west:process.execPath,cmake:'cmake'},
    manifest:{root:uri(tmp),uri:uri(path.join(tmp,'west.yml')),projects:[]}};
  vscode.workspace.isTrusted=true;
  try {
    const west=await inspect(options);
    assert.equal(west.board,'local/cpu');
    assert.deepEqual(west.readiness.configure,[]);
    assert.equal((await inspect({...options,environment:{BOARD:'env/cpu'}})).board,'env/cpu');
    assert.equal((await inspect({...options,cache})).board,'mps2/an386');
    assert.equal((await inspect({...options,method:'CMake'})).board,'');
    vscode.workspace.isTrusted=false;
    const untrusted=await inspect(options);
    assert.equal(untrusted.board,''); assert(untrusted.readiness.configure.includes('trust'));
  } finally {delete vscode.workspace.isTrusted;}
});

test('only effective explicit local module directories can block the plan', async t => {
  const fs = require('node:fs/promises');
  const root = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'zephyr-modules-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const present = path.join(root,'present;module');
  const missing = path.join(root,'missing module');
  const file = path.join(root,'file');
  await fs.mkdir(present);await fs.writeFile(file,'');
  const escapePath=value=>value.replaceAll(';','\\;');
  const args=[
    'ZEPHYR_MODULES='+path.join(root,'overridden-entry'),
    'ZEPHYR_MODULES:STRING='+[escapePath(present),missing,'relative/module'].join(';'),
    'EXTRA_ZEPHYR_MODULES='+[file,missing,path.join(root,'${CONFIG_CHOICE}')].join(';')
  ].join('\n');
  const result=await inspect({args});
  assert.deepEqual(result.missingModules,[missing,file]);
  assert.deepEqual(result.readiness.configure,['modules']);
  assert(result.readiness.build.includes('modules'));
  const known=await inspect({args:'ZEPHYR_MODULES='+escapePath(present)});
  assert.deepEqual(known.missingModules,[]);
  const optional=await inspect({method:'west',manifest:{root:uri(root),uri:uri(path.join(root,'west.yml')),
    projects:[{name:'optional',path:path.join(root,'optional'),revision:'main'}]}});
  assert.deepEqual(optional.missingModules,[]);
  assert.equal(optional.canConfigure,true);
});

test('a failed configure invalidates old build files until another successful configure', () => {
  const ready = {readiness: {configure: [], build: []}, canBuild: true};
  setup.applyLastConfigureResult(ready, {action: 'configure', code: 1});
  assert.deepEqual(ready.readiness.build, ['configureFailed']);
  assert.equal(ready.canBuild, false);
  const missing = {readiness: {configure: ['board'], build: ['board','configureFirst']}, canBuild: false};
  setup.applyLastConfigureResult(missing, {action: 'configure', code: 1});
  assert.deepEqual(missing.readiness.build, ['board','configureFailed']);
  const fresh = {readiness: {configure: [], build: []}, canBuild: true};
  setup.applyLastConfigureResult(fresh, undefined);
  assert.equal(fresh.canBuild, true);
});
