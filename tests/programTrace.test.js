'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const model = require('../extension/media/threadStudio/programModel');
const {parse,TraceStream,MAX_BYTES,MAX_ROWS,LIVE_ROWS} = require('../extension/media/threadStudio/programTrace');
const sampleDir = path.join(__dirname,'../extension/examples/visual-program');
const sample = JSON.parse(fs.readFileSync(path.join(sampleDir,'graph.json'),'utf8'));
const capture = fs.readFileSync(path.join(sampleDir,'console.txt'),'utf8');
const workbench = path.join(__dirname,'../extension/media/threadStudio');
const record = (fields,key=model.fingerprint(sample)) => 'ZVTRACE 1 '+key+' '+fields;

test('the offline example replays 18 v2 QEMU records from the matching saved program', () => {
  const scope={};
  vm.runInNewContext(fs.readFileSync(path.join(sampleDir,'sample.js'),'utf8'),scope);
  assert.deepEqual(JSON.parse(JSON.stringify(scope.ZephyrProgramRecording.graph)),sample);
  assert.equal(scope.ZephyrProgramRecording.log,capture.replaceAll('\r\n','\n'));
  assert.equal(model.fingerprint(sample),'d6617b87ac27451a');
  const {counts,rows}=parse(capture,sample);
  assert.deepEqual(counts,{event:18,foreign:0,malformed:0,loss:0,unmapped:0,inconsistent:0,gap:0});
  assert.deepEqual(rows.slice(2,8).map(({contextId,objectId,op,value,phase})=>[contextId,objectId,phase || op,value]),[
    ['sensor','samples','send',42],['relay','samples','receive',42],['relay',null,'enter',42],
    ['relay',null,'if-then',42],['relay',null,'multiply',84],['relay',null,'return',84]
  ]);
  assert.deepEqual(rows.slice(-3).map(row=>row.stepId),['each','twice','boot_result']);
});

test('original QEMU recording retains the v1 call return, source and line map', () => {
  const text=fs.readFileSync(path.join(__dirname,'fixtures','visual-program','v1-console.txt'),'utf8');
  const {rows,counts}=parse(text,sample);
  assert.equal(counts.event,17);
  assert.deepEqual(rows.filter(row=>row.op==='call').map(row=>[row.protocol,row.phase,row.callee,row.value]),[[1,'return','scale',84]]);
  const hash=require('node:crypto').createHash('sha256').update(model.generate(sample,1)['src/main.c']).digest('hex');
  assert.equal(hash,'fd291203859253f17d99df718477ce130b7b512c1c223155e07f4f05c0103fc2');
  assert.equal(model.describe(sample,1).lines.process,68);
  assert.equal(model.describe(sample,2).lines.process,69);
});

test('call evidence is local to each context, protocol and recorded phase', () => {
  const graph=structuredClone(sample), key=()=>model.fingerprint(graph);
  graph.threads[0].steps.push({id:'sense_call',op:'call',function:'scale'});
  const records = [
    '2 sensor sense_call - call-enter 2', '2 relay process - call-enter 9',
    '2 relay process - call-return 10','2 sensor sense_call - call-return 3',
    '2 relay process - call 10','1 relay process - call-enter 2',
    '2 logger sense_call - call-enter 42','2 relay threshold - if-then 2'
  ].map(r=>'ZVTRACE '+r[0]+' '+key()+r.slice(1)).join('\n');
  const {rows}=parse(records,graph);
  assert.deepEqual(rows.slice(0,4).map(r=>[r.contextId,r.phase,r.value]),[
    ['sensor','enter',2],['relay','enter',9],['relay','return',10],['sensor','return',3]]);
  assert.deepEqual(rows.slice(4).map(r=>r.kind),['unmapped','unmapped','unmapped','inconsistent']);
});

test('ordinary log lines disappear, while loss, incompatible builds and damaged records retain their positions', () => {
  const lines=['starting','[UART] \x1b[32m'+record('sensor publish samples send 42')+'\x1b[0m',
    '--- 23 messages dropped ---',record('$main startup - set 1','0000000000000000'),
    record('relay count counter increment 4294967296'),record('$main startup - set -4'),
    record('relay threshold - if 42'),record('$main double - multiply 84'),record('sensor publish ready send 42'),
    record('relay threshold - if-else 4294967295')];
  const {rows}=parse(lines.join('\r\n'),sample);
  assert.deepEqual(rows.map(row=>row.kind),['event','loss','foreign','malformed','malformed','unmapped','unmapped','unmapped','inconsistent']);
  assert.deepEqual(rows.map(row=>row.line),[2,3,4,5,6,7,8,9,10]);
  assert.equal(rows[1].count,23);
  assert.equal(rows.at(-1).value,0xffffffff);
});

test('walks calls and branches reachable in a context, and ignores unused extra graph properties', () => {
  const graph=structuredClone(sample);
  graph.threads[0].steps.push({id:'second_call',op:'call',function:'scale'});
  graph.mainSteps[0].object='unused';
  graph.mainSteps[0].steps={unused:true};
  const key=model.fingerprint(graph);
  assert.ok(key);
  const lines=['sensor double - multiply 8','relay double - multiply 8','logger double - multiply 8','$main startup - set 1'];
  assert.deepEqual(parse(lines.map(row=>record(row,key)).join('\n'),graph).rows.map(row=>row.kind),
    ['event','event','unmapped','event']);
});

test('bounds imported captures by UTF-8 bytes and parsed records; invalid graphs fail early', () => {
  assert.throws(()=>parse('中文'.repeat(MAX_BYTES/4),sample),/file-size/);
  assert.throws(()=>parse('',''),/invalid-model/);
  const row=record('sensor publish samples send 42')+'\n';
  const result=parse(row.repeat(MAX_ROWS+1),sample);
  assert.equal(result.truncated,true);
  assert.equal(result.counts.event,MAX_ROWS);
});

test('incremental capture keeps split records in order, separates read gaps and never joins across a gap', () => {
  const stream=new TraceStream(sample);
  for (const char of capture) stream.append(char);
  assert.deepEqual(stream.rows,parse(capture,sample).rows);
  assert.equal(stream.finish(),0);
  const fresh=new TraceStream(sample);
  assert.equal(fresh.append('prefix\n'+record('sensor publish samples send ')),0);
  assert.equal(fresh.append('42\n'+record('relay read samples receive 51')+'\n',true),2);
  assert.deepEqual(fresh.rows.map(row=>[row.kind,row.line]),[['gap',2],['event',3]]);
  assert.equal(fresh.rows[1].value,51);
  fresh.append(record('relay read samples'));
  assert.equal(fresh.finish(),1);
  assert.equal(fresh.finish(),0);
  assert.equal(fresh.rows.at(-1).kind,'gap');
});

test('tracks evictions and resumes with the next complete line after excessive input', () => {
  const stream=new TraceStream(sample);
  const row=record('sensor publish samples send 42')+'\n';
  stream.append(row.repeat(LIVE_ROWS+100));
  assert.equal(stream.rows.length,LIVE_ROWS);
  assert.equal(stream.first,100);
  assert.equal(stream.rows[0].line,101);
  stream.append('x'.repeat(4097)+'\n'+row);
  assert.deepEqual(stream.rows.slice(-2).map(r=>r.kind),['gap','event']);
  assert.equal(stream.counts.event,LIVE_ROWS+101);
  assert.equal(stream.first,102);
});

function mountPlayback() {
  let graph=structuredClone(sample);
  class Element {
    append() {}
    addEventListener() {}
    setAttribute() {}
    remove() {}
  }
  const events=[];
  const calls=[];
  const timers=new Map();
  let id=0;
  const scope={document:{documentElement:{lang:'en'},createElement:()=>new Element()},
    ZephyrProgramModel:model,ZephyrProgramTrace:require('../extension/media/threadStudio/programTrace'),
    setTimeout(fn,ms){timers.set(++id,{fn,ms});return id;},clearTimeout(key){timers.delete(key);}};
  for (const script of ['ui.js','programPlayback.js']) {
    vm.runInNewContext(fs.readFileSync(path.join(workbench,script),'utf8'),scope);
  }
  const ui=scope.ZephyrProgramPlayback.mount(new Element(),{model:()=>graph,
    onEvent:e=>events.push(e),requestStop:()=>calls.push('stop')});
  return {ui,events,calls,timers,replace(next){graph=next;}};
}

test('playback highlights matching operations, clears on evidence gaps and stops on a semantic edit', () => {
  const {ui,events,timers,replace}=mountPlayback();
  ui.load([record('sensor publish samples send 42'),'--- 2 messages dropped ---',record('relay read samples receive 42')].join('\n'));
  ui.toggle();
  assert.equal(events.at(-1).stepId,'publish');
  assert.equal([...timers.values()].at(-1).ms,750);
  ui.step(1);
  assert.equal(timers.size,0);
  assert.equal(events.at(-1),null);
  ui.step(1);
  assert.equal(events.at(-1).stepId,'read');
  assert.match(ui.output.textContent,/samples → relay/);
  replace({...sample,name:'changed'});
  assert.equal(ui.sync(),false);
  assert.equal(events.at(-1),null);
  assert.equal(ui.data,undefined);
});

test('live following pauses display without losing new records and distinguishes restart from ordinary appends', () => {
  const {ui,events,calls,replace}=mountPlayback();
  ui.follow(record('sensor publish samples send 6')+'\n',{reset:true});
  assert.equal(events.at(-1).value,6);
  ui.toggle();
  ui.follow(record('relay read samples receive 6')+'\n');
  assert.equal(events.at(-1).stepId,'publish');
  ui.toggle();
  assert.equal(events.at(-1).stepId,'read');
  ui.follow(record('sensor publish samples send 7')+'\n',{reset:true});
  assert.equal(ui.data.rows.length,1);
  assert.match(ui.info.textContent,/restarted/);
  replace({...sample,creation:'dynamic'});
  ui.sync();
  assert.deepEqual(calls,['stop']);
  assert.equal(events.at(-1),null);
});
