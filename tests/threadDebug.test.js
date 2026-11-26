'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {ThreadDebug} = require('../extension/threadDebug');

function signal() {
  const listeners = new Set();
  return {
    on(fn) { listeners.add(fn); return {dispose:() => listeners.delete(fn)}; },
    fire(arg) { for (const fn of listeners) fn(arg); }
  };
}

function createHarness() {
  const start = signal(), end = signal(), active = signal();
  const folder = {uri:'file:///app'};
  const requests = [];
  let factory;
  const debug = {
    registerDebugAdapterTrackerFactory:(_,value) => { factory=value; return {dispose(){}}; },
    onDidStartDebugSession:start.on, onDidTerminateDebugSession:end.on, onDidChangeActiveDebugSession:active.on
  };
  const runtime = new ThreadDebug(debug);
  function connect(id='sim',workspaceFolder=folder) {
    const responses = {
      threads:{threads:[{id:3,name:'CPU #0'},{id:4,name:'Thread 4'}]},
      stackTrace:{stackFrames:[{id:11,name:'worker',source:{path:'src/main.c'},line:19}]},
      scopes:{scopes:[{name:'Local',variablesReference:12,expensive:false}]},
      variables:{variables:[{name:'lazy',value:'...',type:'Device',variablesReference:108,presentationHint:{lazy:true}}]}
    };
    const session = {id,workspaceFolder,name:'debug',type:'cortex-debug',configuration:{executable:'app.elf'},
      async customRequest(command,args) {
        requests.push([id,command,args]);
        return typeof responses[command] === 'function' ? responses[command]() : responses[command];
      }};
    const tracker = factory.createDebugAdapterTracker(session);
    start.fire(session);
    return {session,responses, stop:body=>tracker.onDidSendMessage({type:'event',event:'stopped',body}),
      event:(event,body)=>tracker.onDidSendMessage({type:'event',event,body}),
      command:(command,args,seq)=>tracker.onWillReceiveMessage({type:'request',seq,command,arguments:args}),
      reply:(seq,success,body)=>tracker.onDidSendMessage({type:'response',command:'continue',request_seq:seq,success,body})};
  }
  const state = () => runtime.snapshot(folder);
  const read = (op,id) => runtime.request(folder,op,id,state().token);
  return {runtime,debug,connect,state,read,requests,end,folder};
}

test('thread IDs are selectable only after an observed stop in the correct workspace',async()=>{
  const h=createHarness(),a=h.connect();
  h.connect('other',{uri:'file:///elsewhere'}).stop({allThreadsStopped:true});
  assert.deepEqual(h.state().sessions.map(s=>s.id),['sim']);
  assert.equal(h.state().phase,'unknown');
  await h.read('threads'); assert.equal(h.requests.length,0);
  a.stop({threadId:4,reason:'breakpoint'});
  await h.read('threads');
  assert.deepEqual(h.state().threads.map(t=>t.stopped),[false,true]);
  await h.read('stack',3); await h.read('stack',999);
  assert.equal(h.requests.length,1);
  await h.read('stack',4); assert.equal(h.state().frames[0].name,'worker');
  assert.equal(h.state().image,'app.elf');
});

test('explicit scopes and variables reads never trigger lazy children or evaluate expressions',async()=>{
  const h=createHarness(),a=h.connect();
  a.stop({allThreadsStopped:true});
  await h.read('threads'); await h.read('stack',3); await h.read('scopes',11); await h.read('variables',12);
  assert.deepEqual(h.requests.map(r=>r[1]),['threads','stackTrace','scopes','variables']);
  assert.equal(h.state().variables[0].lazy,true);
  assert.equal(h.state().frames[0].line,19);
  await h.read('variables',108); await h.read('evaluate','someCall()');
  assert.equal(h.requests.length,4);
  a.command('next',{threadId:3,singleThread:true});
  assert.equal(h.state().frames.length,0); assert.equal(h.state().variables.length,0);
  await h.read('threads');
  assert.deepEqual(h.state().threads.map(t=>t.stopped),[false,true]);
  a.event('continued',{threadId:4});
  assert.equal(h.state().phase,'running');
  await h.read('stack',4); assert.equal(h.requests.length,5);
});

test('new stops and terminated sessions discard late responses and prior row IDs',async()=>{
  const h=createHarness(),a=h.connect();
  let respond;
  a.stop({threadId:3});
  a.responses.threads=()=>new Promise(resolve=>{respond=resolve;});
  const token=h.state().token;
  const pending=h.read('threads');
  a.stop({threadId:4});
  respond({threads:[{name:'stale',id:3}]});
  await pending;
  await h.runtime.request(h.folder,'threads',null,token);
  assert.deepEqual(h.state().threads,[]); assert.equal(h.requests.length,1);
  const last=h.read('threads');
  a.event('terminated');
  respond({threads:[{id:7,name:'late'}]}); await last;
  assert.equal(h.state().phase,'disconnected');
});

test('changing sessions invalidates a pending selection even when names match',async()=>{
  const h=createHarness(),a=h.connect(),b=h.connect('second');
  a.stop({allThreadsStopped:true}); b.stop({threadId:4});
  await h.read('threads'); await h.read('stack',3);
  const old=h.state().token;
  await h.read('session','second');
  assert.equal(h.state().sessionId,'second'); assert.equal(h.state().frames.length,0);
  await h.runtime.request(h.folder,'scopes',11,old);
  assert.equal(h.requests.length,2);
  await h.read('threads'); assert.equal(h.requests.at(-1)[0],'second');
  h.end.fire(b.session); assert.equal(h.state().sessionId,'sim');
  h.runtime.dispose(); assert.equal(h.state().phase,'disconnected');
});

test('missing IDs on a partial stop do not authorize a stack request; stopped contexts survive the display cap',async()=>{
  const h=createHarness(),a=h.connect();
  a.stop({reason:'pause'}); await h.read('threads');
  assert.ok(h.state().threads.every(t=>!t.stopped));
  a.stop({threadId:120});
  a.responses.threads={threads:Array.from({length:130},(_,id)=>({name:'T'+id,id}))};
  await h.read('threads'); assert.equal(h.state().threads.length,64);
  assert.equal(h.state().threads[0].id,120); assert.equal(h.state().truncated,true);
  a.responses.stackTrace=()=>{throw Error('Symbols unavailable');};
  await h.read('stack',120); assert.match(h.state().error,/Symbols unavailable/);
  a.responses.stackTrace={stackFrames:[{id:1,name:'asm'}]};
  await h.read('stack',120); assert.equal(h.state().frames[0].name,'asm');
  a.event('invalidated',{areas:['variables']});
  assert.equal(h.state().frames.length,0); assert.equal(h.state().phase,'stopped');
});

test('continue replies without continued events respect partial execution and cannot replace a new stop',async()=>{
  const h=createHarness(),a=h.connect();
  a.stop({allThreadsStopped:true});
  a.command('continue',{threadId:3},21);
  a.reply(21,true,{allThreadsContinued:false});
  await h.read('threads');
  assert.deepEqual(h.state().threads.map(t=>t.stopped),[false,true]);
  a.command('continue',{threadId:4},22);
  a.reply(22,false);
  await h.read('threads');
  assert.deepEqual(h.state().threads.map(t=>t.stopped),[false,true]);
  a.command('continue',{threadId:4},23);
  a.stop({threadId:3,reason:'breakpoint'});
  a.reply(23,true,{});
  await h.read('threads');
  assert.deepEqual(h.state().threads.map(t=>t.stopped),[true,false]);
});
