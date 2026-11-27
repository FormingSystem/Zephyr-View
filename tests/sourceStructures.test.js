'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {test}=require('node:test');
const {inspect_buffer}=require('../extension/liveSourceGraph');

function inspect(lines) {
  const result=inspect_buffer('demo.h',Array.isArray(lines) ? lines.join('\r\n') : lines);
  assert.ok(result.graph,JSON.stringify(result));
  return result.graph;
}

test('nested anonymous members, attributed aggregates and callback and array aliases preserve identifiers and lines',()=>{
  const graph=inspect(fs.readFileSync(path.join(__dirname,'fixtures/source-telemetry.h'),'utf8'));
  const symbols=Object.fromEntries(graph.symbols.map(s=>[s.name,s]));
  assert.equal(symbols.sample_bytes.line,4);
  assert.ok(!symbols.sample_bytes.conditional,'the outer protection guard is open on first inclusion');
  assert.match(symbols.sample_decoder_t.signature,/\(\*sample_decoder_t\)/);
  assert.equal(symbols.telemetry_ptr.line,16);
  const record=symbols['telemetry / telemetry_t'];
  assert.equal(record.line,6);assert.equal(record.members[0].kind,'union');
  const flags=record.members[0].members[0];
  assert.equal(flags.name,'struct flags');
  assert.equal(flags.members[1].line,10);
  assert.equal(flags.members[1].name,'unsigned ready : 1');
  assert.match(record.members[2].name,/\(\*notify\)/);
});

test('primitive boolean preprocessing honors local define and undef, and leaves unknown configuration as a candidate',()=>{
  const lines=['#define LOCAL 0','#if !defined(LOCAL) || (LOCAL && UNKNOWN)',
    'void gone(void) { bad(); }','#elif defined(LOCAL) && !LOCAL','void chosen(void) { good(); }','#endif',
    '#undef LOCAL','#ifdef LOCAL','void gone_again(void) {}','#endif',
    '#if CONFIG_TARGET','void candidate(void) { maybe(); }','#endif'];
  const graph=inspect(lines);
  assert.deepEqual(graph.calls.map(c=>[c.operation,c.conditional]),[['good',false],['maybe',true]]);
  assert.equal(graph.symbols.find(s=>s.name==='candidate').conditional,true);
});

test('macro bodies, unevaluated arguments and shadows cannot inject thread relationships or suppress later functions',()=>{
  const lines=['void run(void) {','  sample();','#define sample(...) \\',' k_sem_take(&ghost, K_FOREVER)',
    '  sample(k_sem_give(&ghost));','#undef sample','  sample();','  UNKNOWN_WRAPPER(k_mutex_lock(&ghost, K_FOREVER));',
    '  (void)sizeof(missing());','  actual(nested());','}'];
  const graph=inspect(lines);
  assert.deepEqual(graph.calls.map(r=>r.operation),['sample','sample','actual','nested']);
  assert.deepEqual(graph.signals,[]);assert.equal(graph.coverage.opaqueMacros,2);
});

test('mutually exclusive functions with a shared closing brace preserve location and flag the selected alternative',()=>{
  const source=['#if CONFIG_A','void first(void) {','#else','void other(void) {','#endif','  emit();','}',
    'static void after(void) __attribute__((noinline)) { done(); }'];
  const graph=inspect(source);
  assert.equal(graph.coverage.branchProjection,true);
  assert.deepEqual(graph.calls.map(r=>[r.source.name,r.operation,r.line,r.conditional]),
    [['first','emit',6,true],['after','done',8,false]]);
  assert.equal(inspect_buffer('demo.c',source.join('\n')+'\nvoid broken(\n').issue,'incomplete');
});

test('an uppercase function implemented in this file remains navigable beside opaque macro calls',()=>{
  const graph=inspect(['void main(void) { STEP(); OTHER(helper()); }','static void STEP(void) {}']);
  assert.deepEqual(graph.calls.map(c=>[c.operation,c.destination.line]),[['STEP',2]]);
});

test('member and array accesses remain directional signal endpoints at the source use site',()=>{
  const graph=inspect(['void poll(struct device *ctx,int i) {',
    ' k_sem_take(&ctx->channels[i].ready, K_NO_WAIT);',' k_msgq_put(&ctx->out, &value, K_NO_WAIT);','}']);
  assert.deepEqual(graph.signals.map(r=>[r.source.name,r.destination.name]),[
    ['ctx->channels[i].ready','poll'],['poll','ctx->out']]);
  assert.deepEqual(graph.signals.map(r=>[r.direction,r.line]),[['in',2],['out',3]]);
  assert.equal(graph.signals[0].source.kind,'reference');
});

test('a native semaphore declaration in an extern C header resolves the same object for both endpoints',()=>{
  const graph=inspect(['#ifdef __cplusplus','extern "C" {','#endif','static struct k_sem ready;',
    'void wake(void) { k_sem_give(&ready); }','#ifdef __cplusplus','}','#endif']);
  assert.equal(graph.signals[0].destination.line,4);assert.equal(graph.signals[0].destination.kind,'object');
  assert.equal(graph.signals[0].source.name,'wake');
  assert.equal(inspect_buffer('demo.c','#else\nint a;').issue,'incomplete');
});
