'use strict';

// Use the installed checkout's board and module readers against a disposable west manifest.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {host,shell,uri,workspace_state,yaml} = require('./adaptive-build-host.cjs');
const {operate} = require('../../extension/modules');

async function write(root, filename, value) {
  const file = path.join(root,filename);
  await fs.mkdir(path.dirname(file),{recursive:true});
  await fs.writeFile(file,value);
}

async function module_with_board(root,name) {
  const dir = path.join(root,name);
  await write(dir,'zephyr/module.yml',yaml.dump({name,build:{settings:{board_root:'hardware'}}}));
  await write(dir,'hardware/boards/others/' + name + '/board.yml',yaml.dump({
    board:{name,vendor:'others',full_name:name,socs:[{name:'an386'}]}
  }));
  return dir;
}

async function main() {
  const dev = shell(), root = await fs.mkdtemp(path.join(os.tmpdir(),'zephyr-module-boards-'));
  console.log('Evidence:',root);
  const local = await module_with_board(root,'external_port');
  await module_with_board(root,'manifest_port');
  await write(root,'.west/config','[manifest]\npath = manifest\n');
  await write(root,'manifest/west.yml',yaml.dump({manifest:{projects:[
    {name:'manifest_port',url:'https://example.invalid/manifest_port'}],self:{path:'manifest','west-commands':'west-commands.yml'}}}));
  const base = path.join(root,'hardware-catalog'), app = path.join(root,'app');
  await fs.mkdir(base);
  const link = process.platform === 'win32' ? 'junction' : 'dir';
  await write(root,'manifest/west-commands.yml',yaml.dump({'west-commands':[
    {file:'boards.py',commands:[{name:'boards',class:'Boards'}]}]}));
  await fs.copyFile(path.join(dev.base,'scripts/west_commands/boards.py'),path.join(root,'manifest/boards.py'));
  // Keep the test workspace isolated while using exactly this checkout's Python code and SoC definitions.
  for (const name of ['arch','soc','scripts']) {
    await fs.symlink(path.join(dev.base,name),path.join(base,name),link);
  }
  await write(app,'CMakeLists.txt','find_package(Zephyr REQUIRED)\n');
  const pythonPath = [path.join(dev.base,'scripts/west_commands'),path.join(dev.base,'scripts'),process.env.PYTHONPATH]
    .filter(Boolean).join(path.delimiter);
  const ctx = workspace_state(), s = {folder:{uri:uri(app)},build:uri(path.join(root,'build')),application:app,
    manifest:{root:uri(root),uri:uri(path.join(root,'manifest','west.yml')),projects:[]},tools:dev.tools,saved:{},
    environment:{...process.env,ZEPHYR_BASE:base,PYTHONPATH:pythonPath},localModules:[{name:'external_port',path:local}]};
  s.target = await host.readTarget(s.folder,s.build);
  s.setup = {app};
  const select = async text => {
    await host.saveArguments(ctx,s,text);
    s.setup = await host.describe(ctx,s,'west');
    return host.choices(ctx,s,'west','board');
  };
  const manifestBoard = 'manifest_port/an386', extraBoard = 'external_port/an386';

  // The real west command in the manifest lists its board but cannot see the outside module.
  const workspaceTargets = await select('');
  assert.ok(workspaceTargets.includes(manifestBoard));
  assert.ok(!workspaceTargets.includes(extraBoard));
  for (const name of ['EXTRA_ZEPHYR_MODULES','ZEPHYR_EXTRA_MODULES']) {
    assert.deepEqual(await select(name + '=' + local),[extraBoard,manifestBoard]);
  }
  // The module parser resolves relative command-line module paths from ZEPHYR_BASE.
  assert.deepEqual(await select('ZEPHYR_MODULES=' + path.relative(base,local)),[extraBoard]);
  await operate(ctx,s,'west',{op:'select',value:{name:'external_port',checked:true}});
  assert.deepEqual(await select(''),[extraBoard,manifestBoard]);
  console.log('PASS manifest only, both extra-module spellings, explicit module replacement, local module picker');
}

main().catch(error=>{console.error(error);process.exitCode=1;});
