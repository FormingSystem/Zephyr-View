'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const program = require('../extension/media/threadStudio/programModel');

test('a new independent design begins at main and exports its own application name', () => {
  const graph = program.starter();
  graph.name = 'temperature_monitor';
  assert.deepEqual(graph.threads, []);
  assert.deepEqual(program.validate(graph), []);
  const files = program.generate(graph);
  assert.match(files['CMakeLists.txt'], /project\(temperature_monitor\)/);
  assert.match(files['src/main.c'], /int main\(void\)/);
});

function assertIssue(change,field,code) {
  const graph = program.example();
  change(graph);
  assert.ok(program.validate(graph).some(issue => issue.field === field && issue.code === code),field);
  assert.throws(() => program.generate(graph),RangeError);
  assert.deepEqual(program.describe(graph).edges,[]);
  assert.equal(program.fingerprint(graph),'');
}

test('example contains a selectable main entry, a conditional processing function and three independent threads', () => {
  const graph = program.example();
  graph.threads[0].name='temperature';
  assert.equal(program.example().threads[0].name,'sensor');
  assert.deepEqual(program.validate(graph),[]);
  const files = program.generate(graph);
  const code = files['src/main.c'].split('\n');
  const {lines,edges} = program.describe(graph);
  assert.match(code[lines.$main-1],/^int main\(/);
  assert.match(code[lines.sensor-1],/zv_task_temperature_entry\(/);
  assert.match(code[lines.scale-1],/static bool zv_fn_scale\(/);
  assert.match(code[lines.threshold-1],/if \(value >= 40U\)/);
  assert.match(code[lines.process-1],/zv_fn_scale\(&value, context\)/);
  assert.deepEqual(edges.map(e => [e.from,e.to,e.op]),[
    ['sensor','samples','send'], ['samples','relay','receive'], ['relay','ready','give'], ['ready','logger','take']
  ]);
  for (const e of edges) assert.ok(code[e.line-1].includes(e.api+'('));
  assert.match(files['CMakeLists.txt'],/option\(ZV_TRACE .* OFF\)/);
});

test('ordered steps carry the local value across queue, function and protected counter', () => {
  const graph = program.example();
  graph.objects.push({id:'lock',name:'lock',kind:'mutex'});
  graph.threads[1].steps.push({id:'count',op:'increment',object:'lock'});
  graph.functions[0].steps.push({id:'ten_times',op:'repeat',count:10,steps:[
    {id:'tick',op:'add',value:2},{id:'wait',op:'delay',value:0}
  ]});
  const source = program.generate(graph)['src/main.c'].split('\n');
  const {lines} = program.describe(graph);
  assert.ok(lines.read < lines.process && lines.process < lines.notify && lines.notify < lines.count);
  assert.match(source[lines.ten_times-1],/for \(uint32_t i1/);
  assert.match(source[lines.wait-1],/k_sleep\(K_MSEC\(0\)\)/);
  const locked = source.slice(lines.count-1,lines.count+10).join('\n');
  assert.ok(locked.indexOf('k_mutex_lock(') < locked.indexOf('++zv_count_lock'));
  assert.ok(locked.indexOf('++zv_count_lock') < locked.indexOf('k_mutex_unlock('));
  assert.ok(locked.indexOf('k_mutex_unlock(') < locked.indexOf('ZV_EVENT('));
});

test('runtime creation starts registered threads before main work; pure main programs also build', () => {
  const graph = {...program.example(),creation:'dynamic'};
  const source = program.generate(graph)['src/main.c'];
  assert.equal(source.match(/k_thread_create\(/g).length,3);
  assert.ok(source.lastIndexOf('k_thread_create(') < source.indexOf('ZV_EVENT("startup"'));
  graph.threads=[]; graph.functions=[]; graph.objects=[];
  assert.deepEqual(program.validate(graph),[]);
  assert.equal(program.describe(graph).edges.length,0);
  assert.ok(program.generate(graph)['src/main.c'].includes('printk('));
  graph.mainSteps=[];
  assert.ok(program.validate(graph).some(issue => issue.code === 'count'));
});

test('unknown schema, duplicate names, IDs, missing peers and invalid parameters have actionable field paths', () => {
  for (const input of [undefined,null,[],0,'graph',{version:2}]) {
    assert.ok(program.validate(input).length);
    assert.throws(() => program.generate(input),RangeError);
  }
  assertIssue(g => {g.name='while';},'name','name');
  assertIssue(g => {g.objects[0].name='unsafe\ncode';},'objects[0].name','name');
  assertIssue(g => {g.threads[0].id='constructor';},'threads[0].id','id');
  assertIssue(g => {g.threads[0].name='scale';},'threads[0].name','duplicate');
  assertIssue(g => {g.mainSteps[0].id='publish';},'mainSteps[0].id','id');
  assertIssue(g => {g.threads[1].stack=513;},'threads[1].stack','range');
  assertIssue(g => {g.threads[1].initialValue=-1;},'threads[1].initialValue','range');
  assertIssue(g => {g.objects[0].capacity='4';},'objects[0].capacity','range');
  assertIssue(g => {g.objects.shift();},'threads[0].steps[0].object','reference');
  assertIssue(g => {g.threads[0].steps[0].op='give';},'threads[0].steps[0].op','operation');
  assertIssue(g => {g.functions[0].steps[0].test='value=9';},'functions[0].steps[0].test','operation');
  assertIssue(g => {g.mainSteps=[{id:'loop',op:'repeat',count:0,steps:[]}];},'mainSteps[0].count','range');
  assertIssue(g => {g.mainSteps=[{id:'long',op:'delay',value:60001}];},'mainSteps[0].value','range');
});

test('forward calls and nested functions compose, recursive cycles and missing functions cannot generate code', () => {
  const graph = program.example();
  graph.functions[0].steps.push({id:'subcall',op:'call',function:'subroutine'});
  graph.functions.push({id:'subroutine',name:'subroutine',steps:[]});
  assert.deepEqual(program.validate(graph),[]);
  const code = program.generate(graph)['src/main.c'];
  assert.ok(code.indexOf('zv_fn_subroutine(uint32_t *state, const char *context);') < code.indexOf('!zv_fn_subroutine(&value, context)'));
  graph.functions[1].steps.push({id:'cycle',op:'call',function:'scale'});
  assert.ok(program.validate(graph).some(issue => issue.code==='cycle'));
  assertIssue(g => {g.functions=[];},'threads[1].steps[1].function','reference');
});

test('fingerprint matches in browser and host, ignores canvas coordinates, and changes with program semantics', () => {
  const graph = program.example(), key = program.fingerprint(graph);
  assert.match(key,/^[a-f0-9]{16}$/);
  const browser=vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../extension/media/threadStudio/programModel'),'utf8'),browser);
  assert.equal(browser.ZephyrProgramModel.fingerprint(graph),key);
  assert.equal(browser.ZephyrProgramModel.generate(graph)['src/main.c'],program.generate(graph)['src/main.c']);
  graph.threads[0].x=725; graph.viewport={zoom:0.65};
  assert.equal(program.fingerprint(graph),key);
  graph.threads[1].steps.reverse();
  assert.notEqual(program.fingerprint(graph),key);
  graph.threads[1].steps.reverse(); graph.functions[0].steps[0].value++;
  assert.notEqual(program.fingerprint(graph),key);
});

test('external hooks accept symbols, declare shared weak fallbacks once, and preserve the fixed build contract', () => {
  const graph = program.example();
  const original = program.generate(graph);
  graph.mainSteps.push({id:'measure',op:'external',symbol:'read_sensor'});
  graph.functions[0].steps.push({id:'measure_again',op:'external',symbol:'read_sensor'});
  const files=program.generate(graph);
  assert.equal(files['CMakeLists.txt'],original['CMakeLists.txt']);
  assert.equal(files['prj.conf'],original['prj.conf']);
  assert.equal(files['src/user_hooks.c'],original['src/user_hooks.c']);
  const code=files['src/main.c'];
  assert.equal(code.match(/__weak uint32_t zv_hook_read_sensor\(/g).length,1);
  assert.equal(code.match(/value = zv_hook_read_sensor\(value\);/g).length,2);
  assert.match(code,/return value;/);
  assertIssue(g => {g.mainSteps=[{id:'inject',op:'external',symbol:'read(void);'}];},'mainSteps[0].symbol','name');
});

test('size and nesting guards reject malformed shapes without parsing executable text', () => {
  const graph=program.example();
  let body=graph.mainSteps;
  for (let i=0;i<24;i++) {
    const nested={id:'loop'+i,op:'repeat',count:1,steps:[]};
    body.push(nested);body=nested.steps;
  }
  assert.ok(program.validate(graph).some(issue => issue.code==='count'));
  assertIssue(g=>{g.functions[0].steps=null;},'functions[0].steps','count');
  assertIssue(g=>{g.threads=[null];},'threads[0]','schema');
});
