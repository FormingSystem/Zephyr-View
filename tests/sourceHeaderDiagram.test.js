'use strict';

const assert=require('node:assert/strict');
const {test}=require('node:test');
const {inspect_buffer}=require('../extension/liveSourceGraph');
const {link_header_diagram}=require('../extension/sourceClassDiagram');

function diagram(lines,name='source.cpp') {
  const {graph,issue}=inspect_buffer(name,lines.join('\r\n'));
  assert.ok(graph,issue);
  return graph.class_diagram;
}

function header(name,lines,options={}) {
  return {uri:'file:///app/'+name,diagram:diagram(lines,name),line:1,...options};
}

test('links referenced header types and pointer aliases to their original member and declaration lines',()=>{
  const api=header('api.h',['#pragma once','struct Storage {','  int slot;','};',
    'typedef struct Storage *handle_t;','struct NotUsed {};']);
  const root=diagram(['#include "api.h"','struct Local {};','struct Device {',
    ' struct Storage owned;',' handle_t handle;',' Local local;','};']);
  const linked=link_header_diagram(root,[api]);
  const external=linked.nodes.filter(node=>node.file);
  assert.deepEqual(external.map(node=>[node.name,node.file,node.line]),[['Storage',api.uri,2]]);
  assert.equal(external[0].members[0].line,3);
  assert.deepEqual(linked.edges.map(edge=>[edge.label,edge.kind,edge.line]),[
    ['local','composition',6],['owned','composition',4],['handle','association',5]]);
  assert.ok(linked.edges.filter(e=>e.label!=='local').every(e=>e.to===external[0].id && !e.file));
  assert.deepEqual(root.nodes.map(n=>n.name),['Local','Device']);
  assert.equal(root.edges.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(linked)).nodes,linked.nodes);
});

test('qualified header names support C++ bases and lexical shadowing without exporting private types',()=>{
  const api=header('types.hpp',['namespace bus { struct Base {}; struct Payload {}; }',
    'class Outer { class Private {}; };','void helper() { struct Local {}; }','struct Flag {};']);
  const root=diagram(['#include "types.hpp"','struct Front : public bus::Base {',
    ' bus::Payload data;',' Outer::Private hidden; Local local;',' struct Flag; struct Flag *shadow;',
    ' ::Flag global;','};']);
  const linked=link_header_diagram(root,[api]);
  assert.deepEqual(linked.edges.map(e=>[e.label,e.kind,e.line]),[
    ['bus::Base','inheritance',2],['data','composition',3],['global','composition',6]]);
});

test('retains uncertainty across file-local conditional branches and duplicate include names',()=>{
  const first=header('one.h',['#if FEATURE','struct Conditional {};','#endif','struct Conflict {};',
    'struct Unique {};','enum Mode { OFF };','struct Opaque;']);
  const second=header('two.h',['struct Conflict {};','struct Later {};'],{line:6});
  const root=diagram(['#include "one.h"','struct Before { struct Later *a; };',
    'struct Earlier { struct Conflict a; };','#define WRAP(T) T','','#include "two.h"',
    'struct After { struct Conflict b; struct Conditional c; struct Mode *m; struct Opaque *o; WRAP(Unique) macro;',
    '#if FEATURE',' struct Unique enabled;','#endif','};']);
  const result=link_header_diagram(root,[first,first,second]);
  assert.deepEqual(result.edges.map(e=>[e.label,e.line,Boolean(e.conditional)]),[
    ['a',3,false],['enabled',9,true]]);
  assert.equal(result.ambiguous,1);
  assert.equal(result.nodes.filter(n=>n.file).length,2);
  assert.equal(new Set(result.nodes.map(n=>n.id)).size,result.nodes.length);
});

test('a conditional include alone gives no evidence but a later unconditional repeat does',()=>{
  const api=header('api.h',['struct Point {};'],{line:2,conditional:true});
  const root=diagram(['#if FEATURE','#include "api.h"','#endif','struct First { struct Point p; };',
    '#include "api.h"','struct Second { struct Point p; };']);
  const result=link_header_diagram(root,[api,{...api,line:5,conditional:false}]);
  assert.deepEqual(result.edges.map(e=>e.line),[6]);
});

test('ignores spellings and member names shadowed by macros in direct headers',()=>{
  const types=header('types.h',['struct Name {}; struct Other {};']);
  const macros=header('flags.h',['#define Name Renamed','#define property renamed'],{line:3});
  const root=diagram(['#include "types.h"','struct Early { struct Name good; };',
    '#include "flags.h"','struct Later { struct Name misleading; struct Other property; struct Other valid; };']);
  const result=link_header_diagram(root,[types,macros]);
  assert.deepEqual(result.edges.map(e=>[e.label,e.line]),[['good',2],['valid',4]]);
});

test('C lookup keeps typedef and tag namespaces distinct across direct headers',()=>{
  const tag=header('device.h',['struct Object {};']);
  const names=header('types.h',['typedef struct Implementation { int value; } Object;']);
  const root=diagram(['#include "device.h"','#include "types.h"',
    'struct Holder { struct Object tag; Object value; };'],'main.c');
  const result=link_header_diagram(root,[tag,names]);
  const targets=result.edges.map(e=>[e.label,result.nodes.find(n=>n.id===e.to).file]);
  assert.deepEqual(targets,[['tag',tag.uri],['value',names.uri]]);
});

test('different headers with equal document-local ids remain separately navigable',()=>{
  const left=header('left.h',['struct Left {};']);
  const right=header('right.h',['struct Right {};']);
  const root=diagram(['#include "left.h"','#include "right.h"','struct Pair { Left left; Right right; };']);
  const linked=link_header_diagram(root,[left,right]);
  const targets=linked.edges.map(e=>linked.nodes.find(n=>n.id===e.to));
  assert.deepEqual(targets.map(n=>[n.name,n.file]),[['Left',left.uri],['Right',right.uri]]);
  assert.equal(new Set(linked.nodes.map(n=>n.id)).size,linked.nodes.length);
});
