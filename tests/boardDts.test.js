'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const {boardDts, detectBoardDts, readBoards, rootOptions} = require('../extension/boardCatalog');

async function fixture(t) {
  const app = await fs.mkdtemp(path.join(os.tmpdir(), 'zephyr-board-dts-'));
  t.after(() => fs.rm(app, {recursive: true, force: true}));
  await fs.writeFile(path.join(app, 'CMakeLists.txt'), 'find_package(Zephyr REQUIRED)');
  const board = {name: 'kit', directories: [app], socs: ['chip'], qualifiers: ['chip', 'chip/cpu'], revisions: ['2']};
  const s = {setup: {app, board: 'kit', plan: {configure: []}}, target: {cache: new Map()}};
  return {app, board, s};
}

test('short and qualified DTS variants follow the SoC and CPU target, including omitted SoC', async t => {
  const {app, board} = await fixture(t);
  const normal = path.join(app, 'kit.dts'), cpu = path.join(app, 'kit_chip_cpu.dts');
  await Promise.all([fs.writeFile(normal, ''), fs.writeFile(cpu, '')]);
  assert.deepEqual(await boardDts(board, 'kit'), {boardFile: normal, boardSource: 'detected'});
  assert.equal((await boardDts(board, 'kit@2//cpu')).boardFile, cpu);
  assert.equal((await boardDts(board, 'kit/chip/cpu')).boardFile, cpu);
  assert.equal((await boardDts(board, 'kit/other')).detectionStatus, 'notFound');
});

test('ambiguous filenames and invalid multi-SoC shortcuts never expose a board source', async t => {
  const {app, board} = await fixture(t);
  const full = path.join(app, 'kit_chip.dts');
  await Promise.all([fs.writeFile(full, ''), fs.writeFile(path.join(app, 'kit.dts'), '')]);
  assert.deepEqual(await boardDts(board, 'kit'), {detectionStatus: 'ambiguous'});
  board.socs.push('other');
  assert.equal((await boardDts(board, 'kit/chip')).detectionStatus, 'ambiguous');
  assert.equal((await boardDts(board, 'kit')).detectionStatus, 'notFound');
  await fs.unlink(path.join(app, 'kit.dts'));
  assert.equal((await boardDts(board, 'kit/chip')).boardFile, full);
});

test('a board extension directory can supply the final DTS for the selected variant', async t => {
  const {app, board} = await fixture(t), second = path.join(app, 'module');
  await fs.mkdir(second);
  const overridden = path.join(second, 'kit_cpu.dts');
  board.directories.push(second);
  await Promise.all([fs.writeFile(path.join(app, 'kit_chip_cpu.dts'), ''), fs.writeFile(overridden, '')]);
  assert.equal((await boardDts(board, 'kit//cpu')).boardFile, overridden);
});

test('target switching discards previous filenames; explicit or dynamic CMake choices remain distinguishable', async t => {
  const {app, s, board} = await fixture(t), source = path.join(app, 'kit.dts');
  await fs.writeFile(source, '');
  const lookup = async (_, env, name) => name === 'kit' ? [board] : [];
  assert.equal((await detectBoardDts(s, {}, lookup)).boardFile, source);
  s.setup.board = 'another';
  assert.deepEqual(await detectBoardDts(s, {}, lookup), {detectionStatus: 'notFound'});
  s.setup.plan.configure = ['-DDTS_SOURCE:FILEPATH='+source];
  assert.deepEqual(await detectBoardDts(s, {}, lookup), {boardFile: source, boardSource: 'detected'});
  s.setup.plan.configure = [];
  await fs.writeFile(path.join(app, 'CMakeLists.txt'), 'set(DTS_SOURCE "${CHOSEN}")\nfind_package(Zephyr)');
  assert.deepEqual(await detectBoardDts(s, {}, lookup), {detectionStatus: 'configure'});
});

test('local roots resolve relative to the active application; stale CMake roots are excluded', async t => {
  const {app, s} = await fixture(t);
  s.target.cache.set('BOARD_ROOT', 'old');
  s.setup.cacheStatus = 'conflict';
  s.setup.plan.configure = ['-DBOARD_ROOT:STRING=hardware;vendor', '-DSOC_ROOT=silicon'];
  assert.deepEqual(rootOptions(s, {BOARD_ROOT: 'environment', ARCH_ROOT: 'arch'}), {
    board_root: [path.join(app, 'hardware'), path.join(app, 'vendor'), path.join(app, 'environment')],
    soc_root: [path.join(app, 'silicon')], arch_root: [path.join(app, 'arch')]
  });
});

test('a configured board directory restricts only a named lookup of that same board', async t => {
  const {app,s} = await fixture(t);
  const scripts = path.join(app,'scripts'), cached = path.join(app,'previous-board'), other = path.join(app,'extra-root');
  await fs.mkdir(scripts);
  // Exercise the same mutually exclusive board_dir / board_roots inputs as Zephyr's list_boards.
  await fs.writeFile(path.join(scripts,'list_boards.py'), [
    'from types import SimpleNamespace',
    'def find_v2_boards(args):',
    '    dirs = args.board_dir or args.board_roots',
    '    return {d.name: SimpleNamespace(name=d.name, directories=[d], socs=[], revisions=[])',
    '            for d in dirs if args.board is None or d.name == args.board}',
    'def board_v2_qualifiers(board): return []'
  ].join('\n'));
  Object.assign(s,{folder:{uri:{fsPath:app}},manifest:{},tools:{}});
  s.setup.cacheStatus = 'current';
  s.target.cache = new Map([['ZEPHYR_BASE',app],['BOARD_ROOT',other],
    ['CACHED_BOARD','previous-board@2/chip/cpu'],['BOARD_DIRECTORIES',cached]]);
  const names = async name => (await readBoards(s,process.env,name)).map(record=>record.name);
  assert.ok((await names()).includes('extra-root'));
  assert.deepEqual(await names('extra-root'),['extra-root']);
  assert.deepEqual(await names('previous-board'),['previous-board']);
});

test('literal CMake root declarations allow offline application boards; conditional roots await configuration', async t => {
  const {app, s, board} = await fixture(t), source = path.join(app, 'kit.dts');
  await fs.writeFile(source, '');
  const cmake = path.join(app, 'CMakeLists.txt');
  await fs.writeFile(cmake, ['# set(DTS_SOURCE old.dts)', 'list(APPEND', '\tBOARD_ROOT',
    '  "${CMAKE_CURRENT_SOURCE_DIR}/hardware kits")', 'find_package(Zephyr REQUIRED)'].join('\n'));
  const expected = path.join(app, 'hardware kits');
  const lookup = async (_, env, name, roots) => roots.board_root.includes(expected) ? [board] : [];
  assert.equal((await detectBoardDts(s, {}, lookup)).boardFile, source);
  await fs.writeFile(cmake, 'if(LOCAL)\nlist(APPEND BOARD_ROOT hardware)\nendif()\nfind_package(Zephyr)');
  assert.deepEqual(await detectBoardDts(s, {}, lookup), {detectionStatus: 'configure'});
});
