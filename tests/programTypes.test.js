'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const model=require('../extension/media/threadStudio/programModel');
const {parse,TraceStream}=require('../extension/media/threadStudio/programTrace');
const example=require('../extension/examples/visual-program/flags.zephyr-program.json');

test('named operands generate portable unsigned constants, labels and change tracking',()=>{
  const design=structuredClone(example);
  assert.deepEqual(model.validate(design),[]);
  const source=model.generate(design)['src/main.c'];
  assert.match(source,/typedef uint32_t zv_type_Status;/);
  assert.match(source,/^#define ZV_MEMBER_Status_alarm \(\(zv_type_Status\)UINT32_C\(2147483648\)\)$/m);
  assert.match(source,/value \|= ZV_MEMBER_Status_alarm;/);
  assert.match(source,/value &= ZV_MEMBER_Status_alarm;/);
  assert.match(source,/value >>= 31U;/);
  const key=model.fingerprint(design);
  design.types[0].members[1].name='fault';
  assert.equal(model.operand_text(design,design.mainSteps[1].value),'Status.fault');
  assert.match(model.generate(design)['src/main.c'],/value \|= ZV_MEMBER_Status_fault;/);
  assert.notEqual(model.fingerprint(design),key);
  assert.equal(model.fingerprint({...model.example(),types:[]}),model.fingerprint(model.example()));
});

test('every uint32 bit operation checks the operand before C generation',()=>{
  for (const [op,symbol] of [['bit_and','&='],['bit_or','|='],['bit_xor','^='],['shift_left','<<='],['shift_right','>>=']]) {
    const graph=structuredClone(example); graph.mainSteps=[{id:'operation',op,value:{type:'status',member:'ready'}}];
    assert.ok(model.generate(graph)['src/main.c'].includes('value '+symbol+' ZV_MEMBER_Status_ready;'));
    graph.types[0].members[0].value=0xffffffff;
    if (op.startsWith('shift')) {
      assert.equal(model.validate(graph)[0].field,'mainSteps[0].value');
      graph.mainSteps[0].value=32;
      assert.throws(()=>model.generate(graph),/range/);
      graph.mainSteps[0].value=31;
    }
    assert.deepEqual(model.validate(graph),[]);
    const capture='ZVTRACE 2 '+model.fingerprint(graph)+' $main operation - '+op+' 0';
    assert.equal(parse(capture,graph).counts.event,1);
  }
});

test('type validation rejects unresolved and colliding symbols',()=>{
  const invalid=[
    [g=>g.types[0].members.pop(),'reference'],
    [g=>g.types.splice(0),'reference'],
    [g=>g.types[0].members[1].id='ready','duplicate'],
    [g=>g.types[0].members[1].name='int','name'],
    [g=>g.types[0].members[1].value=-1,'range'],
    [g=>g.types[0].members[1].value=0x100000000,'range'],
    [g=>g.types=[null],'schema'],
    [g=>{g.types[0].members[0].name='out_A';g.types.push({id:'other',kind:'enum',name:'Status_out',members:[{id:'x',name:'A',value:1}]});},'duplicate']
  ];
  for (const [mutate,code] of invalid) {
    const g=structuredClone(example);mutate(g);
    assert.ok(model.validate(g).some(issue=>issue.code===code));
    assert.throws(()=>model.generate(g),RangeError);
  }
});

test('shift counts are bounded for literal and named operands and a failed draft has no trace key',()=>{
  for (const op of ['shift_left','shift_right']) {
    for (const count of [-1,32,33,0xffffffff,1.5,'31',null]) {
      const graph=structuredClone(example);
      graph.mainSteps=[{id:'shift',op,value:count}];
      assert.equal(model.fingerprint(graph),'');
      graph.mainSteps[0].value={type:'status',member:'alarm'};
      graph.types[0].members[1].value=count;
      assert.equal(model.fingerprint(graph),'');
    }
    for (const count of [0,31]) {
      const graph=structuredClone(example);
      graph.mainSteps=[{id:'shift',op,value:{type:'status',member:'alarm'}}];
      graph.types[0].members[1].value=count;
      assert.deepEqual(model.validate(graph),[]);
    }
  }
});

test('bundled flags firmware retains high unsigned bit values across its entire observed route',()=>{
  const path=require('node:path'), fs=require('node:fs');
  const capture=fs.readFileSync(path.join(__dirname,'../extension/examples/visual-program/flags.console.txt'),'utf8');
  const {counts,rows}=parse(capture,example);
  assert.deepEqual(counts,{event:6,foreign:0,malformed:0,loss:0,unmapped:0,inconsistent:0,gap:0});
  assert.deepEqual(rows.map(row=>[row.stepId,row.op,row.value]),[
    ['start','set',1],['mark_alarm','bit_or',0x80000001],['read_mask','bit_and',0x80000000],
    ['check_alarm','if-then',0x80000000],['alarm_bit','shift_right',1],['report_alarm','print',1]
  ]);
  const edited=structuredClone(example);
  edited.types[0].members[1].value=0xffffffff;
  assert.equal(parse(capture,edited).counts.foreign,6);
});

test('symbolic condition replay verifies snapshots and streamed firmware against the numeric member',()=>{
  const graph=structuredClone(example), prefix='ZVTRACE 2 '+model.fingerprint(graph)+' $main check_alarm - ';
  const text=prefix+'if-then 2147483648\n'+prefix+'if-else 2147483648\n';
  const capture=parse(text,graph);
  assert.deepEqual(capture.rows.map(row=>row.kind),['event','inconsistent']);
  const live=new TraceStream(graph);
  live.append(text);
  assert.deepEqual(live.rows,capture.rows);
  assert.deepEqual(graph.mainSteps.at(-1).value,{type:'status',member:'alarm'});
});
