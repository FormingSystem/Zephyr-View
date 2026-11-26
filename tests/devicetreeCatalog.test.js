'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');

const vscode = {workspace: {isTrusted: true}};
let executions = 0, fail = false;
const call = (python, args, _options, done) => {
  ++executions;
  assert.equal(python, 'configured-python');
  assert.deepEqual(args.slice(0, 2), ['-I', '-B']);
  if (fail) return done(Error('test parse failure'));
  const json = JSON.stringify([{path: '/', generation: executions}]);
  done(null, {stdout: json});
};
const load = Module._load;
let readDevicetreeCatalog;
try {
  Module._load = function(request, ...rest) {
    if (request === 'vscode') return vscode;
    if (request === 'node:child_process') return {execFile: call};
    return load.call(this, request, ...rest);
  };
  ({readDevicetreeCatalog} = require('../extension/devicetreeCatalog'));
} finally {
  Module._load = load;
}

test('untrusted and stale snapshots do not execute a parser or leak an earlier graph', async () => {
  const s = {build: {}, setup: {cacheStatus: 'conflict'}, target: {generated: true}};
  const before = executions;
  vscode.workspace.isTrusted = false;
  try {
    assert.deepEqual(await readDevicetreeCatalog(s, {}), {source: 'restricted', nodes: []});
  } finally { vscode.workspace.isTrusted = true; }
  assert.deepEqual(await readDevicetreeCatalog(s, {}), {source: 'unconfigured', nodes: []});
  assert.equal(executions, before);
});

test('concurrent calls share a parse; switching targets, rewriting output or retrying invalidates it', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'zephyr-dt-catalog-'));
  t.after(() => fs.rm(base, {recursive: true, force: true}));
  const lib = path.join(base, 'scripts/dts/python-devicetree/src/devicetree');
  await fs.mkdir(lib, {recursive: true});
  await fs.writeFile(path.join(lib, 'dtlib.py'), '');
  const merged = path.join(base, 'zephyr.dts');
  await fs.writeFile(merged, '/dts-v1/; / {};');
  const s = {setup: {app: base, board: 'a', cacheStatus: 'current'}, build: {fsPath: base},
    tools: {python: 'other-python'}, target: {devicetree: {merged: {fsPath: merged}}, generated: true,
      cache: new Map([['WEST_PYTHON', 'configured-python']]), zephyrBase: base}};
  const before = executions;
  const [a,b] = await Promise.all([readDevicetreeCatalog(s, {}), readDevicetreeCatalog(s, {})]);
  assert.equal(a.source, 'generated');
  assert.deepEqual(a, b);
  assert.equal(executions, before + 1);
  s.setup.board = 'b';
  assert.notDeepEqual((await readDevicetreeCatalog(s, {})).nodes, a.nodes);
  await fs.appendFile(merged, '\n');
  fail = true;
  try {
    assert.equal((await readDevicetreeCatalog(s, {})).source, 'unavailable');
  } finally { fail = false; }
  assert.equal((await readDevicetreeCatalog(s, {})).source, 'generated');
  assert.equal(executions, before + 4);
});
