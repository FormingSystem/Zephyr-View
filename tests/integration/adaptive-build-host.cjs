'use strict';

const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const Module = require('node:module');
const extension = Module.createRequire(require.resolve('../../extension/package.json'));

function uri(location) {
  const fsPath = path.resolve(location);
  return {fsPath, scheme: 'file', toString: () => fsPath};
}

const vscode = {
  Uri: {file: uri, joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts))},
  FileType: {File: 1, Directory: 2},
  l10n: {t: (text, ...args) => text.replace(/\{(\d+)\}/g, (_, n) => args[n])},
  workspace: {isTrusted: true, fs: {
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

function load_host() {
  const original = Module._load;
  try {
    Module._load = function(name, ...args) {
      return name === 'vscode' ? vscode : original.call(this, name, ...args);
    };
    return {...extension('./buildSetup'), ...extension('./target'), ...extension('./boardCatalog'), ...extension('./flashMetadata'),
      ...extension('./configurationFiles'), ...extension('./configurationFilePicker')};
  } finally { Module._load = original; }
}

function workspace_state() {
  const values = new Map();
  return {workspaceState: {
    get: (key, fallback) => values.has(key) ? values.get(key) : fallback,
    update(key, value) {
      if (value === undefined) values.delete(key);
      else values.set(key, value);
    }
  }};
}

const host = load_host();

async function refresh(context, snapshot, method) {
  const s = snapshot;
  s.target = await host.readTarget(s.folder, s.build);
  s.setup = await host.describe(context, s, method);
  const env = host.taskEnvironment(context, s);
  const tree = host.hasCurrentBuild(s) && s.target.devicetree;
  s.devicetree = tree?.sourcesKnown ? {boardSource: 'configured', boardFile: tree.base.fsPath} :
    await host.detectBoardDts(s, env, undefined, true);
  s.configurationFiles = await host.describeFiles(context, s, env);
  host.apply_file_readiness(s.setup, s.configurationFiles);
  return s.setup;
}

async function run(executable, args, cwd, env, log) {
  const stream = await fs.open(log, 'a');
  try {
    await stream.writeFile(JSON.stringify([executable, ...args]) + '\n');
    const status = await new Promise((resolve, reject) => {
      const child = cp.spawn(executable, args, {cwd, env, windowsHide:true, stdio:['ignore',stream.fd,stream.fd]});
      child.once('error', reject);
      child.once('close', resolve);
    });
    assert.equal(status, 0, 'Command failed; inspect ' + log);
  } finally { await stream.close(); }
}

function shell() {
  const base = process.env.ZEPHYR_BASE;
  assert.ok(base, 'Set ZEPHYR_BASE in a working Zephyr development shell');
  const cwd = cp.execFileSync('west',['topdir'],{cwd:base,encoding:'utf8'}).trim();
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const west = cp.execFileSync(python,['-c','import shutil; print(shutil.which("west"))'],{encoding:'utf8'}).trim();
  return {base, cwd, tools:{cmake:'cmake', ninja:'ninja', west, python}};
}

module.exports = {run, shell, host, refresh, workspace_state, uri, vscode, yaml: extension('js-yaml')};
