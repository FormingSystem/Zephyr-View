'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {host,refresh,run,shell,uri,workspace_state,yaml} = require('./adaptive-build-host.cjs');

async function check_images(s) {
  const system = s.target.system;
  assert.equal(system.main.name,'hello_world');
  assert.equal(system.cache.get('CMAKE_PROJECT_NAME'),'sysbuild_toplevel');
  assert.equal(path.relative(s.setup.app,system.cache.get('APP_DIR')),'');
  assert.equal(path.relative(s.build.fsPath,system.root),'');
  assert.equal(path.relative(s.setup.app,s.target.app.fsPath),'');
  const qualifiers = {hello_world:'nrf5340/cpuapp', remote:'nrf5340/cpunet'};
  assert.deepEqual(system.domains.map(image=>image.name).sort(),Object.keys(qualifiers).sort());
  const results = {};
  for (const image of system.domains) {
    const load = file => fs.readFile(path.join(image.dir,file));
    const board = yaml.load((await load('build_info.yml')).toString()).cmake.board;
    assert.equal(board.name,'nrf5340dk');
    assert.equal(board.qualifiers,qualifiers[image.name]);
    const elf = await load('zephyr/zephyr.elf');
    assert.equal(elf.subarray(0,4).toString(),'\x7fELF');
    assert.equal(elf.readUInt16LE(18),40);
    results[image.name] = {name:board.name,qualifiers:board.qualifiers,elfBytes:elf.length};
  }
  return results;
}

async function build(method, root, dev) {
  const {base,cwd,tools} = dev, app = path.join(base,'samples/sysbuild/hello_world');
  const ctx = workspace_state(), dir = path.join(root,method.toLowerCase());
  const s = {folder:{uri:uri(app)}, build:uri(dir), application:app, environment:{...process.env},tools,saved:{},
    manifest:{root:uri(cwd),uri:uri(path.join(base,'west.yml')),projects:[]}};
  s.target = await host.readTarget(s.folder,s.build);
  s.setup = {app};
  await host.applyChoice(ctx,s,'board','nrf5340dk/nrf5340/cpuapp');
  await host.save_parallelism(ctx,s,'4');
  await host.saveSystem(ctx,s,true);
  for (const pass of ['initial','reconfigure']) {
    await refresh(ctx,s,method);
    assert.ok(s.setup.canConfigure, JSON.stringify(s.setup.readiness));
    const env = host.taskEnvironment(ctx,s), log = dir + '.log';
    await run(s.setup.plan.executable,s.setup.plan.configure,cwd,env,log);
    await host.acknowledgeFileReset(ctx,s.setup.fileReset);
    await refresh(ctx,s,method);
    assert.ok(s.setup.canBuild, JSON.stringify(s.setup.readiness));
    await run(s.setup.plan.executable,s.setup.plan.build,cwd,env,log);
    const result = await check_images(s);
    await fs.writeFile(path.join(root,method + '-' + pass + '.json'),JSON.stringify(result,null,2));
    console.log(method, pass, result);
  }
}

async function main() {
  const dev = shell(), root = await fs.mkdtemp(path.join(os.tmpdir(),'zephyr-sysbuild-'));
  console.log('Evidence:',root);
  const results = await Promise.allSettled(['west','CMake'].map(method=>build(method,root,dev)));
  for (const result of results) if (result.status === 'rejected') throw result.reason;
}

main().catch(error=>{console.error(error);process.exitCode=1;});
