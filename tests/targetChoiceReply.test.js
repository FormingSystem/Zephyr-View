'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const {targetChoiceReply} = require('../extension/targetChoiceReply');

test('a late board result cannot replace the current board or its open-file permission',async()=>{
  const snapshot={},current=()=>true;
  for (const fail of [false,true]) {
    const stale=Promise.withResolvers();
    const first=targetChoiceReply(snapshot,{kind:'board',request:1},()=>stale.promise,current);
    const expected={items:['kit/active'],diagnostics:[{kind:'boardFile',path:'active/board.yml'}]};
    const latest=await targetChoiceReply(snapshot,{kind:'board',request:2},()=>expected,current);
    if (fail) stale.reject(Error('Old request failed'));
    else stale.resolve({items:['kit/obsolete'],diagnostics:[{kind:'boardFile',path:'obsolete/board.yml'}]});
    assert.equal(await first,undefined);
    assert.deepEqual(latest,{picker:2,...expected});
    assert.deepEqual(snapshot.choices.board,expected.items);
    assert.deepEqual(snapshot.boardIssues,expected.diagnostics);
  }
});

test('changing workspace during discovery suppresses authorization and the response',async()=>{
  const snapshot={},task=Promise.withResolvers();
  let current=true;
  const response=targetChoiceReply(snapshot,{kind:'app',request:1},()=>task.promise,()=>current);
  current=false;
  task.resolve({items:['old application']});
  assert.equal(await response,undefined);
  assert.equal(snapshot.choices,undefined);
});
