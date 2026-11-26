'use strict';

// Opt-in integration test. Run from a working Zephyr development shell with ZEPHYR_BASE set.
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs/promises');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = Module;
const fromExtension = createRequire(require.resolve('../../extension/package.json'));
const yaml = fromExtension('js-yaml');
const {build_arguments, build_parallelism} = fromExtension('./buildParallelism');

function uri(file) {
  const fsPath = path.normalize(file);
  return {fsPath, scheme: 'file', toString: () => fsPath};
}

// Only VS Code's URI/filesystem and workspace state need a host outside the editor.
function load_host() {
  const api = {
    Uri: {file: uri, joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts))},
    FileType: {File: 1, Directory: 2}, l10n: {t: text => text},
    workspace: {fs: {
      async readFile(file) {
        try { return await fs.readFile(file.fsPath); }
        catch (error) { if (error.code === 'ENOENT') error.code = 'FileNotFound'; throw error; }
      },
      async stat(file) {
        const stat = await fs.stat(file.fsPath);
        return {type: stat.isFile() ? 1 : 2, mtime: stat.mtimeMs};
      }
    }}
  };
  const original = Module._load;
  try {
    Module._load = function(name, ...args) { return name === 'vscode' ? api : original.call(this, name, ...args); };
    return {...fromExtension('./configurationFiles'), ...fromExtension('./target')};
  } finally { Module._load = original; }
}

const host = load_host();
const state = new Map();
const context = {workspaceState: {
  get: (key, fallback) => state.has(key) ? state.get(key) : fallback,
  update(key, value) {
    if (value === undefined) state.delete(key);
    else state.set(key, value);
  }
}};

async function fixture(root, name, board, files) {
  const app = path.join(root, name), build = uri(path.join(root, name + '-build'));
  await fs.mkdir(app);
  const sources = {
    'CMakeLists.txt': 'cmake_minimum_required(VERSION 3.20)\nfind_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})\nproject(input_test)\ntarget_sources(app PRIVATE main.c)\n',
    'main.c': 'int main(void) { return 0; }\n',
    ...files
  };
  for (const [file, text] of Object.entries(sources)) await fs.writeFile(path.join(app, file), text);
  return {folder: {uri: uri(app)}, target: {cache: new Map()}, setup: {app, board, cacheStatus: 'missing'}, build, sources};
}

async function verify(s, names, stack) {
  const {app, board} = s.setup, dir = s.build.fsPath;
  const plan = await host.filePlan(context, s, s.setup, [], process.env);
  assert.equal(plan.error, '');
  const options = {stdio: 'inherit', cwd: process.env.ZEPHYR_BASE};
  execFileSync('cmake', ['-G', 'Ninja', '-S', app, '-B', dir, '-DBOARD=' + board, ...plan.configure], options);
  await host.acknowledgeFileReset(context, plan.fileReset);
  execFileSync('cmake', build_arguments('cmake', dir, build_parallelism('')), options);
  const meta = yaml.load(await fs.readFile(path.join(dir, 'build_info.yml'), 'utf8')).cmake;
  assert.deepEqual(meta.kconfig['user-files'].map(file => path.basename(file)), names);
  const contents = await fs.readFile(path.join(dir, 'zephyr/.config'), 'utf8');
  assert.match(contents, new RegExp('^CONFIG_MAIN_STACK_SIZE=' + stack + '$', 'm'));
  assert.equal((await fs.readFile(path.join(dir, 'zephyr/zephyr.elf'))).subarray(1, 4).toString(), 'ELF');
  s.target = await host.readTarget(s.folder, s.build);
  s.setup.cacheStatus = 'current';
  for (const [file, text] of Object.entries(s.sources)) assert.equal(await fs.readFile(path.join(app, file), 'utf8'), text);
  console.log('PASS', board, names.join(' + '), '→', stack);
  return meta.devicetree.files.map(file => path.resolve(app, file));
}

async function verify_device_selection(s, base) {
  const {app} = s.setup;
  const merged = () => fs.readFile(path.join(s.build.fsPath, 'zephyr/zephyr.dts'), 'utf8');
  const model = text => /^\s*model\s*=\s*("[^"]*");/m.exec(text)?.[1];
  const originalModel = model(await merged());
  const files = {
    'selected.dts': '#include "' + base.split(path.sep).join('/') + '"\n/ { model = "selected-base"; };\n',
    'selected.overlay': '/ { model = "selected-overlay"; };\n'
  };
  for (const [name, text] of Object.entries(files)) {
    await fs.writeFile(path.join(app, name), text);
    s.sources[name] = text;
  }
  const chosen = Object.keys(files).map(file => path.join(app, file));
  assert.ok(await host.selectFiles(context, s, 'dts', [chosen[0]]));
  assert.ok(await host.selectFiles(context, s, 'overlay', [chosen[1]]));
  assert.deepEqual(await verify(s, ['prj.conf'], 1536), chosen);
  assert.equal(model(await merged()), '"selected-overlay"');
  assert.ok(await host.selectFiles(context, s, 'dts', null));
  assert.ok(await host.selectFiles(context, s, 'overlay', null));
  assert.deepEqual(await verify(s, ['prj.conf'], 1536), [base]);
  assert.equal(model(await merged()), originalModel);
  console.log('PASS', s.setup.board, 'DTS_SOURCE and DTC_OVERLAY_FILE restored');
}

async function main() {
  assert.ok(process.env.ZEPHYR_BASE, 'Set ZEPHYR_BASE to the Zephyr source checkout');
  const board = process.argv[2] || 'mps2/an386';
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zephyr-inputs-'));
  console.log('Builds and evidence:', root);
  const config = size => 'CONFIG_MAIN_STACK_SIZE=' + size + '\n';
  const s = await fixture(root, 'choice', board, {
    'prj.conf': config(1536), 'first.conf': config(2048), 'last.conf': config(3072)
  });
  const [defaultDts] = await verify(s, ['prj.conf'], 1536);
  for (const [names, size] of [[['first.conf', 'last.conf'], 3072], [['last.conf', 'first.conf'], 2048]]) {
    assert.ok(await host.selectFiles(context, s, 'kconfig', names.map(name => path.join(s.setup.app, name))));
    await verify(s, names, size);
  }
  assert.ok(await host.selectFiles(context, s, 'kconfig', null));
  await verify(s, ['prj.conf'], 1536);
  await verify_device_selection(s, defaultDts);
  const single = await fixture(root, 'single', board, {'application.conf': config(2304)});
  const plan = await host.filePlan(context, single, single.setup, [], process.env);
  assert.deepEqual(plan.configure, []);
  Object.assign(single.setup, {plan, fileRows: plan.rows, fileConfigRoot: plan.root});
  const {kconfig} = await host.describeFiles(context, single, process.env);
  assert.equal(kconfig.suggestedFile, path.join(single.setup.app, 'application.conf'));
  assert.ok(await host.selectFiles(context, single, 'kconfig', [kconfig.suggestedFile]));
  await verify(single, ['application.conf'], 2304);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
