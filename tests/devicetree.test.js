'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const yaml = Module.createRequire(require.resolve('../extension/package.json'))('js-yaml');

const uri = file => ({scheme: 'file', fsPath: path.normalize(file), toString() { return this.fsPath; }});
const vscode = {
  l10n: {t: (message, ...args) => message.replace(/\{(\d+)\}/g, (_, index) => String(args[index]))},
  window: {showSaveDialog: async () => undefined},
  FileType: {File: 1}, Uri: {file: uri, joinPath: (root, ...parts) => uri(path.join(root.fsPath, ...parts))},
  workspace: {isTrusted:true, fs: {
    stat: async file => { const stat = await fs.stat(file.fsPath); return {type: stat.isFile() ? 1 : 2, size: stat.size}; },
    readFile: async file => {
      try { return await fs.readFile(file.fsPath); }
      catch (error) { if (error.code === 'ENOENT') error.code = 'FileNotFound'; throw error; }
    }
  }}
};
const loader = Module._load;
let readTarget, buildFiles, studio, discover_new_overlay;
try {
  Module._load = function(request, ...rest) { return request === 'vscode' ? vscode : loader.call(this, request, ...rest); };
  ({readTarget} = require('../extension/target'));
  ({buildFiles} = require('../extension/workspace'));
  studio = require('../extension/studio');
  ({discover_new_overlay} = require('../extension/buildSetup'));
} finally {
  Module._load = loader;
}

async function fixture(t, {inTreeBuild = false} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zephyr-dts-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const app = path.join(root, 'hello world'), build = uri(path.join(inTreeBuild ? app : root, 'build'));
  const boardFile = path.join(root, 'boards', 'base.dts');
  const boardOverlay = path.join(root, 'shields', 'shield.overlay');
  const applicationOverlay = path.join(app, 'boards', 'target.overlay');
  const unused = path.join(app, 'app.overlay'), merged = path.join(build.fsPath, 'zephyr', 'zephyr.dts');
  const board = 'sample@1//cpu';
  const cache = ['APPLICATION_SOURCE_DIR:PATH=' + app, 'CACHED_BOARD:STRING=' + board, 'CMAKE_GENERATOR:INTERNAL=Ninja'].join('\n');
  const files = [[path.join(build.fsPath, 'CMakeCache.txt'), cache], [path.join(build.fsPath, 'build.ninja'), ''],
    [boardFile, '/dts-v1/;'], [boardOverlay, ''], [applicationOverlay, ''], [unused, ''], [merged, ''],
    [path.join(app, 'prj.conf'), 'CONFIG_PRINTK=y'], [path.join(app, 'CMakeLists.txt'), '']];
  for (const [file, contents] of files) {
    await fs.mkdir(path.dirname(file), {recursive: true});
    await fs.writeFile(file, contents);
  }
  const info = {cmake: {application: {'source-dir': app}, board: {name: 'sample', revision: '1', qualifiers: 'soc/cpu'},
    devicetree: {files: [boardFile, boardOverlay, 'boards/target.overlay']}}};
  const writeInfo = contents => fs.writeFile(path.join(build.fsPath, 'build_info.yml'), contents);
  const snapshot = async () => ({build, target: await readTarget({uri: uri(app)}, build), setup: {
    app, cacheStatus: 'current', readiness: {build: []}, plan: {configure: []}
  }});
  return {app, build, merged, boardFile, boardOverlay, applicationOverlay, unused, info, writeInfo, snapshot};
}

test('Kconfig uses ordered merge inputs and keeps generated files and unrelated defaults out of the selected fragments', async t => {
  const f = await fixture(t, {inTreeBuild: true});
  const configDir = path.join(f.app, 'configuration');
  await fs.mkdir(configDir);
  const fragments = ['main.conf', 'board.conf', 'extra flags.conf'].map(file => path.join(configDir, file));
  const generated = path.join(f.build.fsPath, 'zephyr', 'extra.conf');
  const declaredOnly = path.join(configDir, 'unused.conf');
  await Promise.all([...fragments, generated, declaredOnly].map(file => fs.writeFile(file, '')));
  f.info.cmake.application['configuration-dir'] = configDir;
  f.info.cmake.kconfig = {files: [fragments[0], 'board.conf', fragments[2], generated],
    'user-files': ['main.conf'], 'extra-user-files': ['extra flags.conf', 'unused.conf']};
  await f.writeInfo(yaml.dump(f.info));
  const s = await f.snapshot();
  assert.equal(s.target.kconfigSourcesKnown, true);
  assert.deepEqual(s.target.confirmedInputs.kconfig,[fragments[0]]);
  assert.deepEqual(s.target.files.map(file => file.fsPath), fragments);
  const editable = (await studio.inputs(s)).filter(item => item.kind === 'kconfig');
  assert.deepEqual(editable.map(item => [item.file, item.applied]), [
    ...fragments.map(file => [file, true]), [path.join(f.app, 'prj.conf'), false]
  ]);
  const files = (await buildFiles(s)).map(file => file.fsPath);
  assert.ok(fragments.every(file => files.includes(file)));
  assert.ok(!files.includes(generated) && !files.includes(declaredOnly));
});

test('legacy Kconfig inputs respect APPLICATION_CONFIG_DIR and remain unconfirmed without merge evidence', async t => {
  const f = await fixture(t), configDir = path.join(f.app, 'config');
  await fs.mkdir(configDir);
  const names = ['main.conf', 'also.conf', 'extra.conf', 'last.conf'];
  const fragments = names.map(name => path.join(configDir, name));
  await Promise.all(fragments.map(file => fs.writeFile(file, '')));
  await fs.appendFile(path.join(f.build.fsPath, 'CMakeCache.txt'), '\n' + ['APPLICATION_CONFIG_DIR:PATH=config',
    'CONF_FILE:STRING=main.conf;also.conf', 'EXTRA_CONF_FILE:STRING=extra.conf last.conf'].join('\n'));
  const s = await f.snapshot();
  assert.deepEqual(s.target.files.map(file => file.fsPath), fragments);
  assert.equal(s.target.kconfigSourcesKnown, false);
  assert.ok((await studio.inputs(s)).every(item => item.applied === undefined));
  f.info.cmake.board.name = 'previous-board';
  await f.writeInfo(yaml.dump(f.info));
  assert.deepEqual((await f.snapshot()).target.files, []);
});

test('configuration metadata supplies the base and ordered overlays; the studio edits only application files', async t => {
  const f = await fixture(t);
  f.info.cmake.devicetree['user-files'] = ['boards/target.overlay'];
  f.info.cmake.application['configuration-dir'] = path.join(f.app,'configuration');
  await f.writeInfo(yaml.dump(f.info));
  const s = await f.snapshot(), tree = s.target.devicetree;
  assert.equal(tree.sourcesKnown, true);
  assert.equal(tree.base.fsPath, f.boardFile);
  assert.deepEqual(tree.overlays.map(file => file.fsPath), [f.boardOverlay, f.applicationOverlay]);
  assert.deepEqual(s.target.confirmedInputs.overlay,[f.applicationOverlay]);
  assert.equal(tree.merged.fsPath, f.merged);
  const listed = (await buildFiles(s)).map(file => file.fsPath);
  assert.ok([f.boardFile, f.boardOverlay, f.applicationOverlay, f.merged].every(file => listed.includes(file)));
  assert.ok(!listed.includes(f.unused));
  const editable = (await studio.inputs(s)).filter(item => item.kind === 'device');
  assert.deepEqual(editable.map(item => [item.file, item.applied]), [[f.applicationOverlay, true], [f.unused, false]]);
});

test('a board alias can read resolved inputs when the cache, Kconfig and build info agree', async t => {
  const f=await fixture(t), board=f.info.cmake.board;
  const dir=path.dirname(f.boardFile);
  board.path=[dir];
  const cache=path.join(f.build.fsPath,'CMakeCache.txt');
  await fs.writeFile(cache,(await fs.readFile(cache,'utf8')).replace('sample@1//cpu','lab_alias')+'\nBOARD_DIR:PATH='+dir);
  const config=path.join(f.build.fsPath,'zephyr','.config');
  await fs.writeFile(config,'CONFIG_BOARD_TARGET="'+board.name+'/'+board.qualifiers+'"\nCONFIG_BOARD_REVISION="'+board.revision+'"\n');
  await f.writeInfo(yaml.dump(f.info));
  assert.equal((await f.snapshot()).target.devicetree.sourcesKnown,true);
  await fs.writeFile(config,'CONFIG_BOARD_TARGET="other/soc"\n');
  assert.equal((await f.snapshot()).target.devicetree.sourcesKnown,false);
});

test('an application with no selected overlays configures using only BOARD', async t => {
  const f = await fixture(t);
  f.info.cmake.devicetree.files = [f.boardFile];
  await f.writeInfo(yaml.dump(f.info));
  const s = await f.snapshot();
  assert.equal(s.target.devicetree.sourcesKnown, true);
  assert.deepEqual(s.target.devicetree.overlays, []);
  assert.ok(!(await buildFiles(s)).some(file => file.fsPath === f.unused));
});

test('in-tree board sources and non-fragment overlay inputs are available in provenance only', async t => {
  const f = await fixture(t);
  const board = path.join(f.app, 'boards', 'custom.dts'), extra = path.join(f.app, 'hw-settings.dts');
  await Promise.all([fs.writeFile(board, '/dts-v1/;'), fs.writeFile(extra, '')]);
  f.info.cmake.devicetree.files = [board, extra];
  await f.writeInfo(yaml.dump(f.info));
  const s = await f.snapshot();
  assert.equal(s.target.devicetree.base.fsPath, board);
  assert.equal(s.target.devicetree.overlays[0].fsPath, extra);
  const editable = await studio.inputs(s);
  assert.ok(!editable.some(item => item.file === board || item.file === extra));
});

test('missing, incomplete, malformed and unrelated records never manufacture source files', async t => {
  const f = await fixture(t);
  const legacy = (await f.snapshot()).target.devicetree;
  assert.equal(legacy.sourcesKnown, false);
  assert.deepEqual(legacy.overlays, []);
  assert.equal(legacy.merged.fsPath, f.merged);
  await f.writeInfo('cmake: [');
  assert.equal((await f.snapshot()).target.devicetree.merged, undefined);
  f.info.cmake.board.qualifiers = 'soc/other';
  await f.writeInfo(yaml.dump(f.info));
  assert.equal((await f.snapshot()).target.devicetree.merged, undefined);
  f.info.cmake.board.qualifiers = 'soc/cpu';
  f.info.cmake.application['source-dir'] = path.dirname(f.app);
  await f.writeInfo(yaml.dump(f.info));
  assert.equal((await f.snapshot()).target.devicetree.merged, undefined);
  f.info.cmake.application['source-dir'] = f.app;
  delete f.info.cmake.devicetree.files;
  await f.writeInfo(yaml.dump(f.info));
  assert.equal((await f.snapshot()).target.devicetree.sourcesKnown, false);
});

test('failed, conflicting, or incomplete configurations never expose past DTS results as current', async t => {
  const f = await fixture(t);
  await f.writeInfo(yaml.dump(f.info));
  const s = await f.snapshot();
  for (const [status, reasons] of [['conflict', []], ['unknown', []], ['current', ['configureFailed']]]) {
    s.setup.cacheStatus = status;
    s.setup.readiness.build = reasons;
    assert.deepEqual((await buildFiles(s)).map(file => path.basename(file.fsPath)), ['CMakeLists.txt', 'prj.conf']);
    const inputs = (await studio.inputs(s)).filter(item => item.kind === 'device');
    assert.deepEqual(inputs.map(item => [item.file, item.applied]), [[f.unused, undefined]]);
  }
  await fs.unlink(path.join(f.build.fsPath, 'build.ninja'));
  assert.equal((await f.snapshot()).target.devicetree.sourcesKnown, false);
});

test('the default overlay exists only in memory until the selected draft is saved', async t => {
  const f = await fixture(t);
  await fs.unlink(f.unused);
  const s = await f.snapshot();
  s.inputs = await studio.inputs(s);
  const empty = s.inputs.find(item => item.file === f.unused);
  assert.equal(empty.automatic, true);
  assert.equal(empty.base, null);
  await assert.rejects(fs.stat(f.unused), {code:'ENOENT'});
  const edit = {file:empty.file, base:empty.base, text:'&{/soc} { status = "okay"; };\n'};
  await studio.save(s, edit);
  assert.equal(await fs.readFile(f.unused, 'utf8'), edit.text);
  await assert.rejects(studio.save(s, {...edit, text:'replacement'}));
  assert.equal(await fs.readFile(f.unused, 'utf8'), edit.text);
});

test('a native Save As exports the draft after an external edit and never replaces either file', async t => {
  const f = await fixture(t);
  const file = path.join(f.app, 'prj.conf');
  await fs.writeFile(file, '\uFEFFCONFIG_PRINTK=y\r\n');
  const s = await f.snapshot();
  s.inputs = await studio.inputs(s);
  const original = s.inputs.find(item => item.file === file);
  const edit = {file, base:original.base, text:'CONFIG_PRINTK=n\r\n'};
  const changed = '# edited elsewhere\r\nCONFIG_PRINTK=y\r\n';
  await fs.writeFile(file, changed);
  await assert.rejects(studio.save({...s, inputs:await studio.inputs(s)}, edit), /changed/);
  const copy = path.join(path.dirname(f.app), 'copy.conf');
  const dialog = t.mock.method(vscode.window, 'showSaveDialog', async () => uri(copy));
  const saved = await studio.save_copy(s, edit, () => true);
  assert.equal(saved, await fs.realpath(copy));
  assert.equal(await fs.readFile(copy, 'utf8'), '\uFEFF' + edit.text);
  await assert.rejects(studio.save_copy(s, {...edit, text:'bad'}, () => true), /existing file/);
  dialog.mock.mockImplementation(async () => uri(file));
  await assert.rejects(studio.save_copy(s, edit, () => true), /different filename/);
  assert.equal(await fs.readFile(file, 'utf8'), changed);
  assert.equal(await fs.readFile(copy, 'utf8'), '\uFEFF' + edit.text);
});

test('cancel, a switched project, and an untrusted workspace make no copy', async t => {
  const f = await fixture(t);
  const s = await f.snapshot();
  s.inputs = await studio.inputs(s);
  const file = s.inputs.find(item => item.kind === 'kconfig');
  const copy = path.join(f.app, 'unused-copy.conf');
  const dialog = t.mock.method(vscode.window, 'showSaveDialog', async () => undefined);
  assert.equal(await studio.save_copy(s, file, () => true), undefined);
  dialog.mock.mockImplementation(async () => uri(copy));
  assert.equal(await studio.save_copy(s, file, () => false), undefined);
  const trusted = vscode.workspace.isTrusted;
  try {
    vscode.workspace.isTrusted = false;
    await assert.rejects(studio.save_copy(s, file, () => true));
  } finally {
    vscode.workspace.isTrusted = trusted;
  }
  await assert.rejects(fs.stat(copy), {code:'ENOENT'});
});

test('only rediscover default overlays after an explicit create in a previously empty build', () => {
  const s = {target:{cache:new Map([['DTC_OVERLAY_FILE','']]), commandDefinitions:[]}};
  assert.equal(discover_new_overlay(s, {}, [], true), true);
  assert.equal(discover_new_overlay(s, {}, [], false), false);
  assert.equal(discover_new_overlay(s, {DTC_OVERLAY_FILE:''}, [], true), false);
  assert.equal(discover_new_overlay(s, {}, ['-DDTC_OVERLAY_FILE:STRING=hardware.overlay'], true), false);
  s.target.commandDefinitions.push('DTC_OVERLAY_FILE');
  assert.equal(discover_new_overlay(s, {}, [], true), false);
  s.target.cache.set('DTC_OVERLAY_FILE','boards/first.overlay');
  assert.equal(discover_new_overlay(s, {}, [], true), false);
});
