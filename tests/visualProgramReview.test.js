'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../extension/media/threadStudio/programModel');
const {analyze} = require('../extension/media/threadStudio/programReview');

function project(steps, kind='msgq') {
  return {...model.starter(), objects:[{id:'pipe', name:'pipe', kind, capacity:1}], mainSteps:steps};
}

const on = (id,op) => ({id,op,object:'pipe'});
const call = (id,fn) => ({id,op:'call',function:fn});
const rules = graph => analyze(graph).findings.map(f => [f.rule,f.access.step.id]);

test('empty mailbox and semaphore waits locate the step and do not block code generation', () => {
  const graph = project([on('read','receive')]);
  assert.deepEqual(rules(graph), [['missing_send','read']]);
  assert.match(model.generate(graph)['src/main.c'], /k_msgq_get\(&zv_obj_pipe, &value, K_FOREVER\)/);
  assert.deepEqual(rules(project([on('acquire','take')],'sem')), [['missing_give','acquire']]);
  assert.deepEqual(rules(project([on('notify','give')],'sem')), []);
  assert.deepEqual(rules(project([on('count','increment')],'mutex')), []);
});

test('buffer-only use specifies capacity, and a provable extra send locates the first full wait', () => {
  assert.deepEqual(rules(project([on('write','send')])), [['buffer_only','write']]);
  assert.equal(analyze(project([on('write','send')])).findings[0].severity, 'info');
  assert.deepEqual(rules(project([on('write','send'), on('again','send')])), [['wait_full','again']]);
  assert.deepEqual(rules(project([on('write','send'), on('read','receive')])), []);
});

test('straight-line order respects call sites, repeated calls, and saturated semaphore counts', () => {
  const graph = project([call('first','drain'),on('late','send')]);
  graph.functions = [{id:'drain',name:'drain',steps:[on('read','receive')]}];
  const finding = analyze(graph).findings[0];
  assert.equal(finding.rule,'wait_empty');
  assert.equal(finding.access.owner,'drain');
  assert.deepEqual(finding.access.contexts,['$main']);
  graph.mainSteps.reverse();
  graph.mainSteps.push(call('again','drain'));
  assert.deepEqual(rules(graph), [['wait_empty','read']]);
  const semaphore = project([on('one','give'), on('two','give'), on('take1','take'), on('take2','take')], 'sem');
  assert.deepEqual(rules(semaphore), [['wait_empty','take2']]);
});

test('shared and nested function operations report each calling execution context only once', () => {
  const graph = project([call('first','drain'),call('second','drain')]);
  graph.functions = [
    {id:'drain',name:'drain',steps:[call('indirect','get')]},
    {id:'get',name:'get',steps:[on('read','receive')]},
    {id:'unused',name:'unused',steps:[on('send_it','send')]}
  ];
  graph.threads = [{id:'worker',name:'worker',stack:512,priority:1,steps:[call('inside','drain')]}];
  const report = analyze(graph);
  assert.deepEqual(report.by_step.get('read').contexts,['$main','worker']);
  assert.deepEqual(report.by_step.get('send_it').contexts,[]);
  assert.deepEqual(rules(graph),[['missing_send','read']]);
  graph.threads[0].steps.push(call('supply','unused'));
  assert.deepEqual(rules(graph),[]);
});

test('conditional, opaque, and multi-context access do not assert a fixed local wait', () => {
  const graph = project([{id:'if_it',op:'if',test:'eq',value:0,steps:[on('read','receive')],elseSteps:[on('send_it','send')]}]);
  assert.deepEqual(rules(graph),[]);
  graph.mainSteps = [{id:'hook',op:'external',symbol:'driver'},on('read','receive'),on('send_it','send')];
  assert.deepEqual(rules(graph),[]);
  graph.mainSteps.shift();
  graph.threads = [{id:'worker',name:'worker',stack:512,priority:0,steps:[on('other','send')]}];
  assert.deepEqual(rules(graph),[]);
  graph.threads[0].steps = [{id:'loop',op:'repeat',count:2,steps:[on('other','send')]}];
  assert.deepEqual(rules(graph),[]);
});

test('safe examples and invalid partial drafts do not emit guidance for unvalidated operations', () => {
  assert.deepEqual(rules(model.example()),[]);
  assert.deepEqual(rules(project([on('read','take')])),[]);
  const graph = project([{id:'console',op:'print',object:'pipe'}]);
  assert.deepEqual(analyze(graph).objects.get('pipe').accesses,[]);
});
