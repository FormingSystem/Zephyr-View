'use strict';

const assert=require('node:assert/strict');
const {test}=require('node:test');
const {inspect_buffer}=require('../extension/liveSourceGraph');

function read(lines) {
  const source=lines.join('\r\n');
  const {graph,issue}=inspect_buffer('example.h',source);
  assert.ok(graph,issue);
  const model=graph.class_diagram;
  const names=new Map(model.nodes.map(node=>[node.id,node.name]));
  assert.equal(names.size,model.nodes.length);
  const edges=model.edges.map(edge=>[names.get(edge.from),names.get(edge.to),edge.kind,edge.label,edge.line]);
  return {model,edges};
}

test('C composition and association preserve array, pointer alias and nested definition use sites',()=>{
  const {model,edges}=read([
    'typedef struct sample { int value; } sample_t, *sample_ptr;',
    'typedef struct sample *alias, by_value;',
    'typedef int (*handler)(struct sample *sample);',
    'struct channel {',
    '  sample_t rows[4];', '  const sample_ptr last;','  alias indirect; by_value owned;',
    '  struct channel *next;',
    '  struct detail { sample_t part; } info;',
    '  handler callback; void (*uses)(sample_t); struct external *device;',
    '};'
  ]);
  assert.deepEqual(edges,[
    ['channel','sample','composition','rows',5],['channel','sample','association','last',6],
    ['channel','sample','association','indirect',7],['channel','sample','composition','owned',7],
    ['channel','channel','association','next',8],['channel::detail','sample','composition','part',9],
    ['channel','channel::detail','composition','info',9]
  ]);
  assert.ok(model.nodes.some(n=>n.kind==='typedef' && n.name==='handler'));
  assert.ok(model.nodes.find(n=>n.name==='channel').members.some(m=>m.name.includes('struct external')));
});

test('C tag lookup distinguishes a by-value struct from a pointer typedef of the same spelling',()=>{
  const {edges}=read([
    'typedef struct sensor { int value; } *sensor;',
    'struct device { struct sensor embedded; sensor referenced; };',
    'struct handle { int value; }; typedef struct handle *handle;',
    'struct other { struct handle by_value; handle by_pointer; };'
  ]);
  assert.deepEqual(edges,[
    ['device','sensor','composition','embedded',2],['device','sensor','association','referenced',2],
    ['other','handle','composition','by_value',4],['other','handle','association','by_pointer',4]
  ]);
});

test('C++ namespace lookup, base access, non-owning reference and access labels',()=>{
  const {edges,model}=read([
    'namespace one { class Sensor {}; struct Interface {}; }',
    'namespace two { class Sensor {};',
    'class Controller final : public one::Sensor, protected virtual one::Interface {',
    'public: Sensor &local; ::one::Sensor *remote;',
    'private: static Sensor singleton; Sensor factory() const; void on_event(Sensor arg) {}',
    '  Sensor owned;',
    '}; }',
    'template<class T> class Unsupported { T value; };',
    'void function() { struct Hidden {}; }'
  ]);
  assert.deepEqual(edges,[
    ['two::Controller','one::Sensor','inheritance','one::Sensor',3],
    ['two::Controller','one::Interface','inheritance','one::Interface',3],
    ['two::Controller','two::Sensor','association','local',4],
    ['two::Controller','one::Sensor','association','remote',4],
    ['two::Controller','two::Sensor','composition','owned',6]
  ]);
  assert.ok(!model.nodes.some(n=>['Unsupported','Hidden'].includes(n.name)));
});

test('C macro and mutually exclusive branches have explicit limits on evidence',()=>{
  const {model,edges}=read([
    '#define TYPE(...) __VA_ARGS__',
    '#define FOREACH(M) struct Fake { struct Real f; };',
    '#if 0','struct Inactive {};','#endif',
    'struct Real {};',
    '#if CONFIG_CHOICE','struct Variant {}; struct LeftOnly {};',
    '#else','struct Variant {}; struct Right { struct LeftOnly ghost; };','#endif',
    'struct Holder { struct Variant ambiguous; TYPE(Real) opaque;',
    '#if CONFIG_OPTION','struct Real option;','#endif','};'
  ]);
  assert.deepEqual(edges,[['Holder','Real','composition','option',14]]);
  assert.ok(model.edges[0].conditional);
  assert.equal(model.ambiguous,1);
  assert.equal(model.nodes.filter(n=>n.name==='Variant').length,2);
  assert.ok(!model.nodes.some(n=>['Inactive','Fake'].includes(n.name)));
});

test('scoped enum and discriminated union stay distinct and keep their member locations',()=>{
  const {edges,model}=read([
    'enum class Kind : unsigned char { small=1, large=2 };',
    'struct Small { int bits:3; };',
    'union Payload { Small sample; Small *borrowed; };',
    'struct Event { Kind kind; Payload value; };'
  ]);
  assert.deepEqual(model.nodes.map(n=>[n.kind,n.name]),[
    ['enum','Kind'],['struct','Small'],['union','Payload'],['struct','Event']
  ]);
  assert.deepEqual(model.nodes[0].members.map(m=>[m.name,m.line]),[['small=1',1],['large=2',1]]);
  assert.deepEqual(edges,[
    ['Payload','Small','composition','sample',3],['Payload','Small','association','borrowed',3],
    ['Event','Kind','composition','kind',4],['Event','Payload','composition','value',4]
  ]);
});

test('forward declarations, nested typedef shadows and external C++ imports block wrong parent lookup',()=>{
  const {edges}=read([
    'struct Reading {}; struct Payload {};',
    'namespace app { struct Reading; class Holder { using Payload = unsigned; Reading a; Payload b; }; }',
    'namespace other { using unknown::Payload; class Holder { Payload c; }; }'
  ]);
  assert.deepEqual(edges,[]);
});

test('limits on nodes, members and edges are reported; unavailable definitions never dangle',()=>{
  const fields=Array.from({length:51},(_,i)=>'struct First *item'+i+';').join(' ');
  const nodes=Array.from({length:161},(_,i)=>'struct Type'+i+' { struct First *p; };');
  const {model}=read(['struct First { struct Type160 *unavailable; };',
    ...Array.from({length:9},(_,i)=>'struct Group'+i+' { '+fields+' };'),...nodes]);
  assert.equal(model.nodes.length,160);
  assert.equal(model.omitted.nodes,11);
  assert.equal(model.omitted.members,27);
  assert.equal(model.edges.length,400);
  assert.ok(model.omitted.edges>0);
  assert.ok(model.edges.every(edge=>model.nodes.some(n=>n.id===edge.to)));
  assert.deepEqual(read(['void main(void) {}']).model.nodes,[]);
  assert.equal(inspect_buffer('test.h','struct incomplete {').issue,'incomplete');
});
