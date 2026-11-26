'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const Module = require('node:module');
const {uri} = require('./integration/adaptive-build-host.cjs');

function support(options = {}) {
  const updates = [], calls = [];
  const folder = {uri: uri('workspace')};
  const vscode = {workspace:{isTrusted:options.trusted !== false}, Uri:{file:uri, parse:value=>value},
    env:{language:'en', openExternal:async url=>calls.push(['external',url])}};
  const tools = {
    listProbeTools: async () => { calls.push('tools'); return [{id:'pyocd',path:'found-pyocd',source:'auto'}]; },
    probeDevices: async () => { calls.push('devices'); return {pyocd:{devices:[]}}; },
    selectProbeLocation: async (...args) => calls.push(['selected',...args.slice(2)]),
    ...options.tools
  };
  const deployment = {deploymentActions:()=>({canDeploy:true,canDeployDriver:true}), deployProbe:options.deploy};
  const pick = async () => { calls.push('picker'); return options.picked; };
  const modules = {vscode, './probeInventory':tools, './probeDeployment':deployment,
    './fileDialogs':{pickDirectory:pick,pickFile:pick,inputDirectory:options.inputDirectory}, './installationDialogs':{t:(_zh,en)=>en}};
  const original = Module._load;
  let api;
  try {
    Module._load = function(name,...rest) { return Object.hasOwn(modules,name) ? modules[name] : original.call(this,name,...rest); };
    delete require.cache[require.resolve('../extension/probeSupport')];
    api = require('../extension/probeSupport');
  } finally { Module._load = original; }
  return {panel:new api.ProbeSupport({}, data=>updates.push(structuredClone(data))), s:{folder}, updates, calls};
}

test('probe paths arrive before USB enumeration; overlapping requests share one scan', async () => {
  let finish, enumerations = 0;
  const run = support({tools:{probeDevices:()=>{enumerations++;return new Promise(resolve=>{finish=resolve;});}}});
  const first = run.panel.list(run.s);
  const second = run.panel.list(run.s);
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(run.updates.some(update=>update.scanning && update.rows.find(row=>row.id==='pyocd')?.path==='found-pyocd'));
  assert.equal(enumerations,1);
  finish({pyocd:{problem:'USB unavailable'}});
  await Promise.all([first, second, run.panel.list(run.s)]);
  const row = run.updates.at(-1).rows.find(item=>item.id==='pyocd');
  assert.equal(row.path,'found-pyocd');
  assert.equal(row.deviceError,'USB unavailable');
  assert.equal(run.updates.at(-1).scanning,false);
  assert.equal(enumerations,1);
});

test('restricted workspaces list supported profiles and only open links belonging to them', async () => {
  const run = support({trusted:false});
  await run.panel.list(run.s);
  assert.equal(run.updates.at(-1).rows.length,5);
  for (const op of ['directory','deploy','refresh']) await run.panel.act(run.s,{id:'pyocd',op},()=>true);
  await run.panel.act(run.s,{id:'https://invalid.example',op:'guide'},()=>true);
  await run.panel.act(run.s,{id:'pyocd',op:'guide'},()=>true);
  assert.deepEqual(run.calls,[['external','https://pyocd.io/docs/debug_probes.html']]);
});

test('a directory dialog that outlives the current workspace cannot replace its tool', async () => {
  const run = support({picked:uri('old-project')});
  let current = true;
  const selecting = run.panel.act(run.s,{id:'pyocd',op:'directory'},()=>current);
  await Promise.resolve();
  current = false;
  await selecting;
  assert.deepEqual(run.calls,['picker']);
});

test('a double click runs one deployment and rechecks tool and device independently', async () => {
  let finish, installations = 0;
  const run = support({deploy:async()=>{installations++;return new Promise(resolve=>{finish=resolve;});}});
  const action = {id:'pyocd',op:'deploy'};
  const first = run.panel.act(run.s,action,()=>true);
  await run.panel.act(run.s,action,()=>true);
  assert.equal(installations,1);
  assert.ok(run.updates.at(-1).rows.find(row=>row.id==='pyocd').busy);
  finish({status:'installed',file:'installed-pyocd'});
  await first;
  assert.deepEqual(run.calls,[['selected','pyocd','installed-pyocd','executable'],'tools','devices']);
  assert.equal(run.updates.at(-1).rows.find(row=>row.id==='pyocd').busy,false);
});

test('typed directories use the active folder as their base and the same validator as browsing', async () => {
  let base;
  const chosen = uri('tools');
  const run = support({inputDirectory:async options=>{base=options.baseUri;return chosen;}});
  await run.panel.act(run.s,{id:'jlink',op:'typedDirectory'},()=>true);
  assert.equal(base,run.s.folder.uri);
  assert.deepEqual(run.calls[0],['selected','jlink',chosen.fsPath,'directory']);
});

test('finishing driver setup offers reconnection while keeping the executable selection intact', async () => {
  const run = support({deploy:async (_context,_s,id,op)=>{
    assert.equal(id,'stm32cubeprogrammer');
    assert.equal(op,'driver');
    return {status:'reconnect'};
  }});
  await run.panel.act(run.s,{id:'stm32cubeprogrammer',op:'driver'},()=>true);
  assert.deepEqual(run.calls,['tools','devices']);
  const row = run.updates.at(-1).rows.find(item=>item.id==='stm32cubeprogrammer');
  assert.match(row.statusMessage,/Reconnect the probe/);
});
