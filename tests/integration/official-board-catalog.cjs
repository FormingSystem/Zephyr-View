'use strict';

// Compare both picker paths with the west command provided by each real checkout.
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {boardDts, readBoardCatalog} = require('../../extension/boardCatalog');
const {listBoardChoices} = require('../../extension/boardPicker');
const {containingCheckout} = require('../../extension/checkout');

function officialTargets(run, west, python, source, names) {
  const help = run(west, ['boards','--help']);
  if (help.includes('--all-targets')) {
    return new Set(run(west,['boards','--all-targets']).trim().split(/[\r\n]+/).map(name => name.trim().replace(/@(?=\/|$)/,'')));
  }
  if (!help.includes('qualifiers')) return names;
  // Older west versions omit revisions. Read the same machine-readable output that Zephyr supplies to CMake.
  const script = path.join(source,'scripts','list_boards.py');
  const result = run(python,[script,'--arch-root',source,'--board-root',source,'--soc-root',source,
    '--cmakeformat','{NAME}|{REVISIONS}|{QUALIFIERS}']);
  const targets = new Set();
  for (const line of result.trim().split(/\r?\n/)) {
    const fields = /^NAME;([^|]+)\|REVISIONS;([^|]*)\|QUALIFIERS;(.*)$/.exec(line);
    assert.ok(fields,'Unexpected board record: ' + line);
    const [,name,revisions,qualifiers] = fields;
    const versions = revisions.split(';').filter(value => value && value !== 'NOTFOUND');
    for (const revision of ['', ...versions]) {
      for (const qualifier of qualifiers.split(';')) {
        targets.add(name + (revision ? '@' + revision : '') + (qualifier ? '/' + qualifier : ''));
      }
    }
  }
  return targets;
}

async function verify(checkout) {
  const source = await fs.realpath(checkout);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'Zephyr boards '));
  const link = path.join(root, 'source');
  await fs.symlink(source, link, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    await fs.mkdir(path.join(root,'.west'));
    await fs.writeFile(path.join(root,'.west/config'),'[manifest]\npath = source\n');
    const env = {...process.env, ZEPHYR_BASE:source, PYTHONIOENCODING:'utf-8', PYTHONDONTWRITEBYTECODE:'1'};
    const python = env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    const run = (exe,args) => execFileSync(exe,args,{env,cwd:root,encoding:'utf8',windowsHide:true,timeout:120000});
    const west = run(python,['-c','import shutil; print(shutil.which("west") or "")']).trim();
    assert.ok(west,'Install west into the active Python environment and add its executables to PATH.');
    const official = new Set(run(west,['boards','-f','{name}']).trim().split(/\r?\n/));
    const app = path.join(source,'samples','hello_world');
    assert.equal(await containingCheckout(app),source);
    const state = {folder:{uri:{fsPath:app}}, setup:{app}, checkout:source, tools:{python,west},
      target:{cache:new Map()}, manifest:{root:{fsPath:root},uri:{fsPath:path.join(link,'west.yml')}}};
    const cmake = await listBoardChoices(state,env,'CMake');
    const workspace = await listBoardChoices(state,env,'west');
    assert.deepEqual(cmake.diagnostics,[]);
    assert.deepEqual(workspace.diagnostics,[]);
    assert.deepEqual(workspace.items,cmake.items);
    assert.deepEqual(new Set(cmake.items.map(item=>item.split(/[@/]/)[0])),official);
    assert.deepEqual(new Set(cmake.items),officialTargets(run,west,python,source,official));
    assert.ok(official.size > 0);
    const {boards} = await readBoardCatalog(state,env,'qemu_cortex_m3');
    const target = cmake.items.find(item=>item.split(/[@/]/)[0]==='qemu_cortex_m3');
    assert.ok(target,'The reference Cortex-M3 board must be present.');
    const {boardFile} = await boardDts(boards[0],target);
    assert.ok(boardFile && path.relative(source,boardFile).split(path.sep)[0] === 'boards');
    console.log(JSON.stringify({checkout:path.basename(source),boards:official.size,targets:cmake.items.length,
      target,devicetree:path.relative(source,boardFile)}));
  } finally {
    await fs.unlink(link);
    await fs.rm(root,{recursive:true,force:true});
  }
}

async function main() {
  const checkouts = process.argv.slice(2);
  assert.ok(checkouts.length, 'Pass one or more Zephyr source checkouts.');
  for (const checkout of checkouts) await verify(checkout);
}

main().catch(error=>{console.error(error);process.exitCode=1;});
