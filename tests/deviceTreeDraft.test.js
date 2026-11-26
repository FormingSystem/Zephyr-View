'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const draft = require('../extension/media/deviceTreeDraft');
const port = {
  path: '/soc/serial@1000',
  properties: [
    {name:'current-speed', type:'num', scalar:0},
    {name:'label', type:'string', scalar:''},
    {name:'reg', type:'num', scalar:4},
    {name:'compatible', type:'string', scalar:'test,port'},
    {name:'clocks', type:'phandles_and_nums'}
  ]
};

test('independent nodes retain the original overlay and line endings across edits', () => {
  const other = {path:'/other/serial@1000'};
  const original = '// existing settings\r\n&serial_a { status = "disabled"; };\r\n';
  let text = draft.status(original, port, 'okay');
  text = draft.status(text, other, 'disabled');
  text = draft.property(text, port, 'current-speed', '0x1c200');
  text = draft.property(text, port, 'label', 'Console "A"');
  text = draft.status(text, port, 'reserved');
  assert.ok(text.startsWith(original));
  assert.doesNotMatch(text.replaceAll('\r\n',''), /\n/);
  assert.equal(text.match(/&\{\/soc\/serial@1000\}/g).length, 1);
  assert.equal(draft.stagedStatus(text, other), 'disabled');
  assert.equal(draft.stagedStatus(text, port), 'reserved');
  assert.equal(draft.stagedProperty(text, port, 'current-speed'), 115200);
  assert.equal(draft.stagedProperty(text, port, 'label'), 'Console "A"');
  assert.equal(draft.property(text, port, 'label', 'Console "A"'), text);
});

test('a modified override section stays verbatim when a later explicit change is staged', () => {
  const generated = draft.status('', port, 'okay');
  const original = generated.replace('status =', '/* keep note */ status =');
  const text = draft.status(original, port, 'disabled');
  assert.ok(text.startsWith(original));
  assert.equal(draft.stagedStatus(text, port), 'disabled');
  assert.equal(draft.stagedProperty(text, port, 'nothing'), undefined);
});

test('scalar editing respects DTS types, cell bounds, quoted strings and structural fields', () => {
  for (const input of [0, 0xffffffff, '0x50']) {
    const text = draft.property('', port, 'current-speed', input);
    assert.equal(draft.stagedProperty(text, port, 'current-speed'), Number(input));
  }
  assert.equal(draft.stagedProperty(draft.property('',port,'label',''), port, 'label'), '');
  for (const bad of [-1, 4294967296, '', '12 MHz', '2.2']) assert.throws(() => draft.property('', port, 'current-speed', bad));
  for (const key of ['reg','clocks','compatible','invented']) assert.throws(() => draft.property('', port, key, '5'));
  assert.throws(() => draft.property('',port,'label','bad\0label'));
  assert.throws(() => draft.status('', {path:'/dev} {}'}, 'okay'));
  assert.throws(() => draft.status('', port, 'running'));
});
