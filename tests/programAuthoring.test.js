'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const model = require('../extension/media/threadStudio/programModel');

const sandbox = {ZephyrProgramModel:model,structuredClone};
for (const script of ['programFlow','programAuthoring']) {
  const filename = path.join(__dirname,'../extension/media/threadStudio',script+'.js');
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),sandbox,{filename});
}
const {connection,insert,move,check,replacement,removed_children} = sandbox.ZephyrProgramAuthoring;
const {node} = sandbox.ZephyrProgramFlow;

test('directed connections encode the Zephyr operation and its executing context',()=>{
  const graph=model.example(), actor=node(graph,'sensor'), fn=node(graph,'scale');
  const queue=node(graph,'samples'), sem=node(graph,'ready'), mutex={id:'lock',kind:'mutex'};
  for (const [source,target,op,owner] of [
    [actor,queue,'send',actor],[queue,actor,'receive',actor],[sem,fn,'take',fn],[fn,sem,'give',fn],
    [fn,mutex,'increment',fn],[actor,fn,'call',actor]
  ]) {
    const proposal=connection(source,target);
    assert.equal(proposal.fields.op,op);
    assert.equal(proposal.owner,owner.id);
  }
  for (const [source,target] of [[queue,sem],[mutex,actor],[actor,actor],[fn,actor],[null,fn]]) {
    assert.equal(connection(source,target),undefined);
  }
});

test('moving a call across contexts checks for indirect recursion without modifying the original',()=>{
  const graph=model.example();
  graph.functions.push({id:'other',name:'other',steps:[{id:'call_scale',op:'call',function:'scale'}]});
  graph.mainSteps.push({id:'call_other',op:'call',function:'other'});
  const before=JSON.stringify(graph);
  assert.equal(check(graph,g=>move(g,'call_other','scale','root','threshold')).code,'cycle');
  assert.equal(check(graph,g=>move(g,'threshold','scale','threshold:elseSteps','')).code,'reference');
  assert.equal(check(graph,g=>move(g,'double','relay','root','absent')).code,'reference');
  assert.equal(JSON.stringify(graph),before);
  const proposal=g=>move(g,'threshold','relay','root','read');
  assert.equal(check(graph,proposal),undefined);
  assert.ok(proposal(graph));
  assert.deepEqual(graph.threads[1].steps[0].steps.map(step=>step.id),['double']);
  assert.deepEqual(graph.threads[1].steps[0].elseSteps.map(step=>step.id),['offset']);
  assert.deepEqual(graph.functions[0].steps,[]);
  assert.equal(graph.threads[1].steps[1].id,'read');
});

test('converting or deleting a control step counts only the descendants that would be lost',()=>{
  const keep={id:'report',op:'print'}, nested={id:'repeat',op:'repeat',count:2,steps:[{id:'retry',op:'print'}]};
  const branch={id:'choice',x:15,y:35,op:'if',comparison:'gt',value:5,steps:[keep],elseSteps:[nested]};
  const loop={op:'repeat',count:3};
  assert.equal(removed_children(branch,null),3);
  assert.equal(removed_children(branch,loop),2);
  const result=replacement(branch,loop);
  assert.equal(result.id,branch.id);
  assert.deepEqual([result.x,result.y],[15,35]);
  assert.strictEqual(result.steps[0],keep);
  assert.equal(result.elseSteps,undefined);
  assert.equal(removed_children(result,{op:'if'}),0);
  assert.equal(replacement(result,{op:'if'}).elseSteps.length,0);
  assert.equal(removed_children(keep,null),0);
  assert.equal(branch.elseSteps[0].steps[0].id,'retry');
});

test('inserting or moving into a full block, an over-deep branch or a full graph is atomic',()=>{
  const print=id=>({id,op:'print'});
  const graph=model.example();
  graph.mainSteps=Array.from({length:64},(_,i)=>print('step_'+i));
  const before=JSON.stringify(graph);
  assert.equal(check(graph,g=>insert(g,'$main',null,'root',print('extra'))).code,'count');
  assert.equal(check(graph,g=>move(g,'publish','$main','root','')).code,'count');
  assert.equal(JSON.stringify(graph),before);
  const deep=model.starter();
  deep.mainSteps=[];
  let body=deep.mainSteps;
  for(let n=0;n<8;n++) {
    const step={id:'loop_'+n,op:'repeat',count:2,steps:[]};
    body.push(step);
    body=step.steps;
  }
  assert.deepEqual(model.validate(deep),[]);
  assert.equal(check(deep,g=>insert(g,'$main','loop_7','steps',{id:'deepest',op:'repeat',count:2,steps:[]})).code,'count');
  assert.equal(check(deep,g=>insert(g,'$main','loop_7','steps',print('within'))),undefined);
  const full=model.starter();
  full.mainSteps=Array.from({length:64},(_,i)=>print('entry_'+i));
  full.threads=Array.from({length:15},(_,i)=>({id:'task_'+i,name:'task_'+i,stack:1024,priority:2,
    steps:Array.from({length:64},(_,j)=>print('op_'+i+'_'+j))}));
  assert.deepEqual(model.validate(full),[]);
  const extra={id:'new_task',name:'new_task',stack:1024,priority:1,steps:[]};
  assert.equal(check(full,g=>{g.threads.push(extra);return insert(g,extra.id,null,'root',print('overflow'));}).code,'count');
});
