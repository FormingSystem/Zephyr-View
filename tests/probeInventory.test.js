'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const {uri,workspace_state} = require('./integration/adaptive-build-host.cjs');
const {profiles, inspectDeviceGroups} = require('../extension/probeDiagnostics');
const {plan} = require('../extension/media/flashPlan');

const vscode = {workspace:{isTrusted:true},Uri:{file:uri}};
let inventory;
const load = Module._load;
try {
  Module._load = function(name,...args) { return name==='vscode' ? vscode : load.call(this,name,...args); };
  inventory = require('../extension/probeInventory');
} finally { Module._load = load; }

async function programIn(directory,name) {
  await fs.mkdir(directory,{recursive:true});
  const file = path.join(directory,name+(process.platform==='win32'?'.exe':''));
  await fs.writeFile(file,'',{mode:0o755});
  return file;
}

test('a selected tool root is validated, isolated per folder and consumed by the matching runner',async t=>{
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'zephyr-probe-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const context = workspace_state();
  const folder = {uri:uri(root)};
  const snapshot = {toolDirectories:[path.join(root,'shared')],tools:{}};
  const fallback = await programIn(snapshot.toolDirectories[0],'pyocd');
  const local = await programIn(path.join(root,'offline package','bin'),'pyocd');
  const wrong = await programIn(path.join(root,'other'),'another');
  const rows = async (target=folder)=>(await inventory.listProbeTools(context,target,snapshot));
  const item = async target=>(await rows(target)).find(row=>row.id==='pyocd');
  assert.deepEqual(await item(),{id:'pyocd',path:fallback,source:'auto'});
  assert.equal(await inventory.selectProbeLocation(context,folder,'pyocd','offline package','directory'),local);
  assert.equal(await inventory.selectProbeLocation(context,folder,'pyocd',wrong,'executable'),undefined);
  assert.equal(await inventory.selectProbeLocation(context,folder,'pyocd',path.dirname(wrong),'directory'),undefined);
  assert.equal(await inventory.selectProbeLocation(context,folder,'pyocd',undefined,'directory'),undefined);
  assert.equal(await inventory.selectProbeLocation(context,folder,'serial',local,'executable'),undefined);
  const selected = await item();
  assert.deepEqual(selected,{id:'pyocd',path:local,selectedPath:local,source:'selected'});
  assert.equal((await item({uri:uri(path.join(root,'project 2'))})).path,fallback);

  const model={west:'west',root:'output',caps:{pyocd:{flash:true,toolOption:'--pyocd'}},order:['one'],
    images:[{name:'one',defaultRunner:'pyocd',runners:['pyocd'],deviceIds:{},files:[{file:'output.hex'}]}],tools:{pyocd:selected.path}};
  assert.deepEqual(plan(model,{}).args.slice(-2),['--pyocd',local]);
  await fs.unlink(local);
  assert.deepEqual(await item(),{id:'pyocd',path:undefined,source:'selected',selectedPath:local});
  assert.equal(plan({...model,tools:{pyocd:null}},{}).issue,'probeTool');
  await inventory.resetProbeLocation(context,folder,'pyocd');
  assert.equal((await item()).path,fallback);
  assert.deepEqual((await rows()).map(row=>row.id),Object.keys(profiles));
});

test('a SEGGER directory selects the newest installed version when the unversioned link is absent',async t=>{
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'zephyr-jlink-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const program = profiles.jlink.program;
  await programIn(path.join(root,'JLink_V799'),program);
  const latest = await programIn(path.join(root,'JLink_V1002'),program);
  const context = workspace_state(),folder={uri:uri(root)};
  assert.equal(await inventory.selectProbeLocation(context,folder,'jlink',root,'directory'),latest);
  const stable = await programIn(path.join(root,'JLink'),program);
  assert.equal(await inventory.selectProbeLocation(context,folder,'jlink',root,'directory'),stable);
});

test('all USB profiles share one enumeration and preserve individual device matches',async()=>{
  let queries=0;
  const stdout=' +-o J-Link@10  <class IOUSBHostDevice>\n +-o CMSIS-DAP@20  <class IOUSBHostDevice>';
  const groups = {jlink:profiles.jlink,pyocd:profiles.pyocd,'dfu-util':profiles['dfu-util']};
  const result = await inspectDeviceGroups(groups,'darwin',async()=>{queries++;return {stdout};});
  assert.equal(queries,1);
  assert.equal(result.jlink.devices[0].name,'J-Link@10');
  assert.equal(result.pyocd.devices[0].name,'CMSIS-DAP@20');
  assert.deepEqual(result['dfu-util'].devices,[]);
  const failure = await inspectDeviceGroups(groups,'darwin',async()=>{throw Error('unavailable');});
  assert.equal(failure.jlink.problem,'unavailable');
  assert.equal(failure.jlink.devices,undefined);
});

test('restricted workspaces neither run hardware discovery nor accept overrides',async t=>{
  vscode.workspace.isTrusted=false;
  t.after(()=>{vscode.workspace.isTrusted=true;});
  const context=workspace_state(),folder={uri:uri('temp')};
  assert.deepEqual(await inventory.probeDevices(),{});
  assert.ok((await inventory.listProbeTools(context,folder)).every(row=>!row.path));
  assert.equal(await inventory.selectProbeLocation(context,folder,'pyocd',process.execPath,'executable'),undefined);
});

test('mixed runners respect explicit tool choices by asking for a single image',()=>{
  const setup={order:['app','radio'],west:'west',root:'build',system:true,domainFlag:true,
    caps:{pyocd:{toolOption:'--pyocd'},jlink:{toolOption:'--commander'}},tools:{jlink:'selected/JLinkExe'},selectedTools:['jlink'],
    images:[['app','pyocd'],['radio','jlink']].map(([name,id])=>({name,runners:[id],defaultRunner:id,files:[{}],deviceIds:{}}))};
  assert.equal(plan(setup,{}).issue,'perImageTool');
  assert.deepEqual(plan(setup,{domain:'radio'}).args.slice(-2),['--commander','selected/JLinkExe']);
  assert.ok(plan({...setup,selectedTools:[]},{}).args);
});

test('Windows rejects the JDK linker with the same executable name as J-Link Commander', {skip:process.platform!=='win32'},async t=>{
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'zephyr-jdk-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const javaBin=path.join(root,'jdk','bin');
  const file=await programIn(javaBin,'jlink');
  await programIn(javaBin,'java');
  const context=workspace_state(),folder={uri:uri(root)};
  assert.equal(await inventory.selectProbeLocation(context,folder,'jlink',file,'executable'),undefined);
  assert.equal(await inventory.selectProbeLocation(context,folder,'jlink',javaBin,'directory'),undefined);
  const rows=await inventory.listProbeTools(context,folder,{toolDirectories:[javaBin],tools:{}});
  assert.notEqual(rows.find(row=>row.id==='jlink').path?.toLowerCase(),file.toLowerCase());
});

test('board-declared tool arguments take precedence over automatic discoveries',()=>{
  const boardTool = 'specific board/JLinkExe', detected = 'common/JLinkExe';
  const image={name:'app',runners:['jlink'],defaultRunner:'jlink',files:[{}],args:{jlink:['--commander='+boardTool]},deviceIds:{}};
  const setup={order:['app'],west:'west',root:'build',caps:{jlink:{toolOption:'--commander'}},tools:{jlink:detected},images:[image]};
  assert.ok(!plan(setup,{}).args.includes('--commander'));
  assert.deepEqual(plan({...setup,selectedTools:['jlink']},{}).args.slice(-2),['--commander',detected]);
});
