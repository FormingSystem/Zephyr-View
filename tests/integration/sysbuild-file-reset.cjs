'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {host,refresh,run,shell,uri,workspace_state} = require('./adaptive-build-host.cjs');

async function main() {
  const {base,cwd,tools} = shell(), state = workspace_state();
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'zephyr-domain-inputs-'));
  const app = path.join(root,'controller'), dir = path.join(root,'out'), write = (name,data) => fs.writeFile(path.join(app,name),data);
  const dual = process.argv.includes('--dual');
  console.log('Evidence:',root);
  if (dual) await fs.cp(path.join(base,'samples/sysbuild/hello_world'),app,{recursive:true,filter:file=>path.basename(file)!=='build'});
  else {
    await fs.mkdir(app);
    await write('CMakeLists.txt','cmake_minimum_required(VERSION 3.20)\nfind_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})\nproject(controller)\ntarget_sources(app PRIVATE main.c)\n');
    await write('main.c','int main(void) { return 0; }\n');
  }
  await write('prj.conf','CONFIG_MAIN_STACK_SIZE=2048\n');
  await write('custom.conf','CONFIG_MAIN_STACK_SIZE=1536\n');
  await write('custom.overlay','/ { model = "selected"; };\n');
  const s = {folder:{uri:uri(app)},build:uri(dir),application:app,environment:{...process.env},tools,saved:{},
    manifest:{root:uri(cwd),uri:uri(path.join(base,'west.yml')),projects:[]}};
  s.target=await host.readTarget(s.folder,s.build); s.setup={app};
  await host.applyChoice(state,s,'board',dual?'nrf5340dk/nrf5340/cpuapp':'mps2/an386');
  await host.saveSystem(state,s,true);
  let remoteHashes;
  async function configure() {
    await refresh(state,s,'CMake');
    assert.ok(s.setup.canConfigure, JSON.stringify(s.setup.readiness));
    await host.prepareFileConfigure(s);
    await run(s.setup.plan.executable,s.setup.plan.configure,cwd,host.taskEnvironment(state,s),path.join(root,'configure.log'));
    await host.acknowledgeFileReset(state,s.setup.fileReset);
    await refresh(state,s,'CMake');
    if (dual) {
      const remote=s.target.system.domains.find(domain=>domain.name==='remote');
      assert.ok(remote);
      const hashes=await Promise.all(['.config','zephyr.dts'].map(async name=>
        createHash('sha256').update(await fs.readFile(path.join(remote.dir,'zephyr',name))).digest('hex')));
      if (remoteHashes) assert.deepEqual(hashes,remoteHashes);
      else { remoteHashes=hashes; console.log('remote baseline SHA-256 (.config, zephyr.dts)',hashes); }
    }
    return Promise.all(['.config','zephyr.dts'].map(name=>fs.readFile(path.join(s.target.system.main.dir,'zephyr',name),'utf8')));
  }
  await refresh(state,s,'CMake');
  if (dual) await configure();
  await host.selectFiles(state,s,'kconfig',[path.join(app,'custom.conf')]);
  await host.selectFiles(state,s,'overlay',[path.join(app,'custom.overlay')]);
  const selected=await configure();
  assert.match(selected[0],/^CONFIG_MAIN_STACK_SIZE=1536$/m);
  assert.match(selected[1],/model = "selected"/);
  assert.equal(s.target.system.cache.get('controller_CONF_FILE'),'custom.conf');
  if (!dual) assert.equal(s.target.cache.get('CONF_FILE'),'custom.conf');
  await write('app.overlay','/ { model = "project"; };\n');
  await host.selectFiles(state,s,'kconfig',null);
  await host.selectFiles(state,s,'overlay',null);
  const restored=await configure();
  assert.match(restored[0],/^CONFIG_MAIN_STACK_SIZE=2048$/m);
  assert.match(restored[1],/model = "project"/);
  assert.ok(!s.target.system.cache.has('controller_CONF_FILE'));
  assert.ok(!s.target.system.cache.has('controller_DTC_OVERLAY_FILE'));
  await write('prj.conf','CONFIG_MAIN_STACK_SIZE=2816\n');
  await write('app.overlay','/ { model = "changed"; };\n');
  const changed=await configure();
  assert.match(changed[0],/^CONFIG_MAIN_STACK_SIZE=2816$/m);
  assert.match(changed[1],/model = "changed"/);
  console.log('PASS main image file selection, release and changed project defaults');
}

main().catch(error=>{console.error(error);process.exitCode=1;});
