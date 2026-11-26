'use strict';

const assert=require('node:assert/strict');
const {test}=require('node:test');
const Module=require('node:module');
const {uri,workspace_state}=require('./integration/adaptive-build-host.cjs');
const vscode={env:{language:'en'},Uri:{file:uri},window:{},tasks:{},workspace:{isTrusted:true}};
const original=Module._load;
let FlashTasks,executeAndWait;
try {
  Module._load=function(name,...args){return name==='vscode'?vscode:original.call(this,name,...args);};
  ({FlashTasks}=require('../extension/flashTasks'));
  ({executeAndWait}=require('../extension/taskCompletion'));
} finally {Module._load=original;}

test('double clicks share the build lock and stale firmware cancels before executing a task',async()=>{
  let unlock, confirmations=0,executions=0,refreshes=0;
  const tasks=new FlashTasks(workspace_state(),new Set());
  const s={build:uri('build'),flash:{id:'a'}};
  tasks.confirm=()=>{confirmations++;return new Promise(resolve=>{unlock=resolve;});};
  tasks.describe=()=>({id:'firmware-replaced'});
  vscode.window.showWarningMessage=()=>{};
  vscode.tasks.executeTask=()=>{executions++;};
  const run=()=>tasks.run(s,{id:'a'},false,()=>true,()=>{refreshes++;});
  const first=run();await run();
  assert.equal(confirmations,1);
  unlock({name:'fake'});await first;
  assert.equal(executions,0);
  assert.equal(refreshes,1);
  assert.equal(tasks.running.size,0);
});

test('a changed board or a cancelled picker never executes the earlier plan',async()=>{
  let active=true,executions=0;
  const tasks=new FlashTasks(workspace_state(),new Set());
  const s={build:uri('build'),flash:{id:'A'}};
  const refresh=()=>{};
  tasks.confirm=()=>{active=false;return {name:'fake'};};
  vscode.tasks.executeTask=()=>{executions++;};
  await tasks.run(s,{id:'A'},false,()=>active,refresh);
  active=true;tasks.confirm=()=>undefined;
  await tasks.run(s,{id:'A'},true,()=>active,refresh);
  assert.equal(executions,0);
});

test('user workspace task keeps its identity and the lock survives unrelated task completion',async()=>{
  let listen,removed=false;
  const task={name:'vendor flash'},execution={task};
  vscode.tasks.onDidEndTaskProcess=()=>({dispose(){}});
  vscode.tasks.onDidEndTask=callback=>{listen=callback;return {dispose(){removed=true;}};};
  vscode.tasks.executeTask=async value=>{assert.equal(value,task);return execution;};
  let finished=false;
  const done=executeAndWait(task,()=>{}).then(()=>{finished=true;});
  await new Promise(resolve=>setImmediate(resolve));
  listen({execution:{task:{name:task.name}}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(finished,false);
  listen({execution});await done;
  assert.equal(removed,true);
});

test('success, failure and an unreported exit code follow only the chosen execution',async()=>{
  for (const code of [0,7,undefined]) {
    let onEnd,onProcess;
    vscode.tasks.onDidEndTask=handler=>{onEnd=handler;return {dispose(){}};};
    vscode.tasks.onDidEndTaskProcess=handler=>{onProcess=handler;return {dispose(){}};};
    const task={name:'probe task'},execution={task};
    vscode.tasks.executeTask=async()=>{
      onProcess({execution:{task},exitCode:99});
      if (code!==undefined) onProcess({execution,exitCode:code});
      onEnd({execution});return execution;
    };
    assert.equal(await executeAndWait(task),code);
  }
});
