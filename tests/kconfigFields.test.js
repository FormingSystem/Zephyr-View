'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const fields=require('../extension/media/kconfigFields');
global.tr=(_zh,en)=>en;

const menu={items:[
  {name:'CONFIG_THREAD_NAME',type:'bool',allowed:['n','y']},
  {name:'CONFIG_LABEL',type:'string'},
  {name:'CONFIG_STACK',type:'int',range:['64','128']},
  {name:'CONFIG_ADDR',type:'hex',range:['0x00','0xff']},
  {name:'CONFIG_FIRST',type:'bool',choice:['CONFIG_FIRST','CONFIG_NEXT']}
]};

test('stages an initially disabled symbol without a leading blank line',()=>{
  assert.equal(fields.apply('','CONFIG_THREAD_NAME','y',false,menu),'CONFIG_THREAD_NAME=y\n');
});
test('preserves comments, quoting, unrelated assignments and original CRLF line endings',()=>{
  const text='# Timings\r\n  CONFIG_LABEL = "before # value"  # owner\r\nCONFIG_OTHER=y\r\n';
  const changed=fields.apply(text,'CONFIG_LABEL','new "name" \\ value',false,menu);
  assert.equal(changed,'# Timings\r\n  CONFIG_LABEL = "new \\"name\\" \\\\ value"  # owner\r\nCONFIG_OTHER=y\r\n');
  assert.equal(fields.apply(changed,'CONFIG_LABEL','',true,menu),'# Timings\r\n  # owner\r\nCONFIG_OTHER=y\r\n');
  assert.equal(fields.apply('# CONFIG_THREAD_NAME is not set\r\n','CONFIG_THREAD_NAME','y',false,menu),'CONFIG_THREAD_NAME=y\r\n');
});
test('enforces active ranges and Kconfig representation',()=>{
  assert.equal(fields.apply('','CONFIG_ADDR','af',false,menu),'CONFIG_ADDR=0xaf\n');
  assert.throws(()=>fields.apply('','CONFIG_ADDR','100',false,menu),/range/);
  assert.throws(()=>fields.apply('','CONFIG_STACK','63',false,menu),/range/);
  assert.throws(()=>fields.apply('','CONFIG_THREAD_NAME','m',false,menu),/unavailable/);
});
test('changes an explicit choice without leaving its previous member selected',()=>{
  const text='CONFIG_FIRST=y # first\n# CONFIG_NEXT is not set\n';
  assert.equal(fields.apply(text,'CONFIG_FIRST','CONFIG_NEXT',false,menu),'CONFIG_FIRST=n # first\nCONFIG_NEXT=y\n');
});
test('does not silently replace duplicate assignments',()=>{
  assert.throws(()=>fields.apply('CONFIG_STACK=67\nCONFIG_STACK=75\n','CONFIG_STACK','80',false,menu),/Multiple/);
});
