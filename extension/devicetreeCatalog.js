'use strict';

const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const {execFile} = require('node:child_process');
const execute = require('node:util').promisify(execFile);
const {hasCurrentBuild} = require('./target');

const unavailable = source => ({source, nodes: []});
let last;

async function fileStamp(file) {
  const stat = await fs.stat(file, {bigint: true});
  if (!stat.isFile()) throw Error('Expected file: '+file);
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join('/');
}

async function findLibrary(base) {
  for (const [directory, module] of [
    ['scripts/dts/python-devicetree/src', 'devicetree/dtlib.py'],
    ['scripts/dts/python-devicetree', 'devicetree/dtlib.py'],
    ['scripts/dts', 'dtlib.py']
  ]) {
    const root = path.join(base, directory);
    try { return {root, stamp: await fileStamp(path.join(root, module))}; }
    catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
  }
  throw Error('dtlib is missing from the configured Zephyr checkout');
}

async function readNodes(python, env, library, generated, stamp) {
  const script = path.join(__dirname, 'devicetree_catalog.py');
  const result = await execute(python, ['-I', '-B', script, library.root, generated],
    {env, windowsHide: true, timeout: 25000, maxBuffer: 32*1024*1024});
  if (stamp !== await fileStamp(generated)) throw Error('The generated DTS changed during inspection');
  return {source: 'generated', nodes: JSON.parse(result.stdout)};
}

async function readDevicetreeCatalog(s, environment) {
  if (!vscode.workspace.isTrusted) return unavailable('restricted');
  if (!s.build || !hasCurrentBuild(s)) return unavailable('unconfigured');
  const generated = s.target.devicetree?.merged?.fsPath;
  const base = s.target.zephyrBase;
  const python = s.target.cache.get('Python3_EXECUTABLE') || s.target.cache.get('WEST_PYTHON') || s.tools.python;
  if (!base || !python || !generated) return unavailable('unavailable');
  try {
    const [library, stamp] = await Promise.all([findLibrary(base), fileStamp(generated)]);
    const key = JSON.stringify([s.setup.app, s.setup.board, generated, stamp, python, library]);
    if (last?.key === key) return last.pending;
    const pending = readNodes(python, environment, library, generated, stamp).catch(error => {
      if (last?.key === key) last = undefined;
      console.warn('Zephyr devicetree:', error.stderr || error.message);
      return unavailable('unavailable');
    });
    last = {key, pending};
    return pending;
  } catch {
    return unavailable('unavailable');
  }
}

module.exports = {readDevicetreeCatalog};
