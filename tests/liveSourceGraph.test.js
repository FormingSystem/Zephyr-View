'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {inspect_buffer,max_bytes}=require('../extension/liveSourceGraph');
const {readSource}=require('../extension/threadSource');

test('live diagrams follow edited signal directions and identify declaration and call-site lines',()=>{
  const code=['K_MSGQ_DEFINE(bus, sizeof(int), 8, 4);','K_SEM_DEFINE(ready, 0, 1);',
    'static void reader(void) {','  k_msgq_get(&bus,&value,K_FOREVER);','  k_sem_give(&ready);','}',
    'K_THREAD_DEFINE(worker, 1024, reader, NULL,NULL,NULL, 5,0,0);','int main(void) { reader(); }'].join('\n');
  const {graph}=inspect_buffer('main.c',code);
  assert.deepEqual(graph.signals.map(r=>[r.source.name,r.destination.name,r.operation,r.line]),
    [['bus','reader','k_msgq_get',4],['reader','ready','k_sem_give',5]]);
  assert.equal(graph.signals[0].source.line,1);
  assert.equal(graph.signals[0].destination.line,3);
  assert.equal(graph.calls[0].destination.line,3);
  assert.equal(graph.entries[0].destination.name,'reader');
  assert.equal(inspect_buffer('main.c',code.replaceAll('k_msgq_get','k_msgq_put')).graph.signals[0].source.name,'reader');
});

test('unfinished editing is distinct from clearing a file, with comments and literals masked',()=>{
  for(const body of ['void f(){','void f(){ x(]; }','/* dangling','char *s="unfinished','char c=\'x',
     '#ifdef FEATURE\nstatic int a;','const char *s=R"sql(unclosed']) {
    assert.equal(inspect_buffer('live.h',body).issue,'incomplete',body);
  }
  for(const text of ['','#if 0\n{\n#endif','/* { */ const char *s="(";','const char *s=R"tag({)tag";']) {
    assert.equal(inspect_buffer('live.h',text).issue,undefined,text);
  }
  assert.equal(inspect_buffer('big.c',' '.repeat(max_bytes+1)).issue,'size');
  assert.equal(inspect_buffer('live.h','int v;').graph.symbols.length,0);
});

test('partial configurations, unresolved and non-transfer accesses keep their source evidence',()=>{
  const code='#if CONFIG_ALT\nvoid main(void) { k_mutex_lock(&guard,K_FOREVER); helper(); }\n#endif';
  const {graph}=inspect_buffer('demo.h',code);
  assert.ok(graph.signals[0].conditional);
  assert.equal(graph.signals[0].direction,'access');
  assert.equal(graph.signals[0].destination.kind,'reference');
  assert.equal(graph.calls[0].destination.name,'helper');
  assert.deepEqual(readSource('demo.h',code).calls.map(r=>r.name),['k_mutex_lock','helper']);
});

test('dense local input has a bounded relation count and an explicit omission count',()=>{
  const {graph}=inspect_buffer('dense.c','void task(void){'+'run();'.repeat(1100)+'}');
  assert.equal(graph.calls.length,1000);assert.equal(graph.omitted,100);
});

test('header type definitions expose declared members and their exact source lines',()=>{
  const code=['typedef unsigned long tick_t;','typedef struct {','  unsigned flags[2];',
    '  void (*done)(int, int);','} packet_t;','enum mode { OFF, ON = (1 << 1), };',
    'union payload { unsigned raw; char bytes[4]; };'].join('\n');
  const {graph}=inspect_buffer('signals.h',code);
  const packet=graph.symbols.find(type=>type.name==='packet_t');
  assert.deepEqual(packet.members,[{name:'unsigned flags[2]',line:3},{name:'void (*done)(int, int)',line:4}]);
  assert.deepEqual(graph.symbols.map(type=>type.kind),['typedef','struct','enum','union']);
  assert.equal(graph.symbols[2].count,2);
  assert.equal(graph.symbols[3].members[1].name,'char bytes[4]');
});
