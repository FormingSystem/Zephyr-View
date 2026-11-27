'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {setImmediate: turn} = require('node:timers/promises');
const {ThreadDebug} = require('../extension/threadDebug');
const {ProgramDebugControls} = require('../extension/programDebugControls');

function fixture() {
  const folder = {uri:'fixture:app'}, calls=[],opened=[],states=[],errors=[];
  const listen = () => ({dispose(){}});
  const debug = {registerDebugAdapterTrackerFactory:listen,onDidStartDebugSession:listen,
    onDidTerminateDebugSession:listen,onDidChangeActiveDebugSession:listen,stopDebugging:s => calls.push([s.id,'stop'])};
  const runtime = new ThreadDebug(debug);
  function connect(id,workspaceFolder=folder) {
    const results = {threads:() => ({threads:[{id:4,name:'worker'}]}),
      stackTrace:() => ({stackFrames:[{name:'spin',line:5,source:{path:'src/main.c'}}]})};
    const session={id,name:id,type:'test',configuration:{},workspaceFolder,async customRequest(op,args) {
      calls.push([id,op,args]);return results[op]?.();
    }};
    const tracker = runtime.tracker(session);
    const event=(event,body) => tracker.onDidSendMessage({type:'event',event,body});
    return {results,session,event};
  }
  const controls = new ProgramDebugControls({runtime,folder,send:s => states.push(s),
    launch:target => calls.push(['launch',target]),showFrame:(f,scope)=>opened.push([f,scope]),report:e=>errors.push(e)});
  const state=() => states.at(-1);
  const command=(op,token=state()?.token,id)=>controls.handle({op,token,id});
  return {folder,controls,connect,calls,state,command,opened,states,errors};
}

test('studio controls use the selected workspace session and stopped thread, including return to source',async()=>{
  const h=fixture(), a=h.connect('first'), b=h.connect('second');
  h.connect('foreign',{uri:'fixture:other'}).event('stopped',{threadId:4});h.controls.refresh();
  assert.deepEqual(h.state().sessions.map(s=>s.id),['first','second']);
  await h.command('start');assert.deepEqual(h.calls.at(-1),['launch',h.folder]);
  await h.command('session',h.state().token,'second');
  b.event('stopped',{threadId:4,reason:'breakpoint'});await turn();
  assert.equal(h.state().frame.name,'spin');assert.equal(h.state().thread.name,'worker');
  await h.command('frame');assert.deepEqual(h.opened,[[h.state().frame,h.folder]]);
  for (const op of ['next','stepIn','stepOut','continue']) {
    await h.command(op);assert.deepEqual(h.calls.at(-1),['second',op,{threadId:4}]);
  }
  const expired=h.state().token;
  b.event('continued',{allThreadsContinued:true});a.event('stopped',{threadId:4});
  const before=h.calls.length;await h.command('continue',expired);assert.equal(h.calls.length,before);
  await h.command('pause');assert.deepEqual(h.calls.at(-1),['second','pause',{threadId:4}]);
  await h.command('stop');assert.deepEqual(h.calls.at(-1),['second','stop']);
  await h.command('session',h.state().token,'foreign');assert.equal(h.state().sessionId,'second');
});

test('late frames and adapter errors never resurrect a previous suspension',async()=>{
  const h=fixture(),a=h.connect('A');let release;
  a.results.stackTrace=()=>new Promise(resolve=>{release=resolve;});
  a.event('stopped',{threadId:4});await turn();
  a.event('continued',{allThreadsContinued:true});release({stackFrames:[{name:'stale'}]});await turn();
  assert.equal(h.state().frame,undefined);
  a.results.stackTrace=()=>{throw Error('Stack unavailable');};
  a.event('stopped',{threadId:4});await turn();
  assert.equal(h.state().thread.id,4);assert.deepEqual(h.errors,['Stack unavailable']);
  h.controls.dispose();const before=h.states.length;a.event('terminated',{});
  assert.equal(h.states.length,before);
});
