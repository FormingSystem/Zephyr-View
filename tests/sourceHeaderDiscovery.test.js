'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const {discover_source_headers,direct_includes}=require('../extension/sourceHeaderDiscovery');

class Uri {
  constructor(path,scheme='vscode-remote',authority='ssh+lab'){Object.assign(this,{path,scheme,authority});}
  with(parts){return Object.assign(new Uri(this.path,this.scheme,this.authority),parts);}
  toString(){return this.scheme+'://'+this.authority+this.path;}
}
function fixture(src='#include "api.h"', file='/work/app/src/main.c') {
  const document={uri:new Uri(file),getText:()=>src,version:1},files=new Map(),reads=[],stats=[];
  const fs={
    stat:async uri=>{
      stats.push(uri.path);
      if (!files.has(uri.path)) throw Object.assign(Error('not found'),{code:'FileNotFound'});
      return {size:files.get(uri.path).length,mtime:1,type:1};
    },
    readFile:async uri=>{reads.push(uri.path);return Buffer.from(files.get(uri.path));}
  };
  const vscode={workspace:{fs,textDocuments:[document]},FileType:{File:1}};
  const options={vscode,document,application:new Uri('/work/app'),folder:{uri:new Uri('/work')}};
  const put=(name,text='struct part {};')=>files.set(name,text);
  const build=(entries,dir='/work/build')=>{
    options.build=new Uri(dir);
    put(dir+'/compile_commands.json',JSON.stringify(entries));
  };
  return {put,build,options,reads,stats,run:()=>discover_source_headers(options)};
}

test('direct header scan preserves physical include lines and known/unknown branch state',()=>{
  const rows=['/* leading */','#ifndef TEST_GLOBAL_H','#define TEST_GLOBAL_H',
    '# include /* comment */ \\','  "bus.h"  // trailing','#if 0','#include "absent.h"','#endif',
    '#if FEATURE','#include <zephyr/driver.h>','#endif','const char *s=R"tag(',
    '#include "fake.h"',')tag";','#define IMPORT "other.h"','#include IMPORT',
    'namespace api {','#include "scoped.h"','}','#endif'];
  assert.deepEqual(direct_includes(rows.join('\r\n')),[
    {name:'bus.h',quoted:true,line:4,conditional:false},
    {name:'zephyr/driver.h',quoted:false,line:10,conditional:true}
  ]);
});

test('exact translation-unit argument order resolves quoted paths before -I, then system paths',async()=>{
  const h=fixture('#include "part.h"\n#include <part.h>\n#include "only.h"\n#include <driver.h>');
  h.build([
    {file:'../other/src/main.c',directory:'/work/build',arguments:['cc','-I','/other/sdk']},
    {file:'../app/src/main.c',directory:'/work/build',arguments:['cc','-isystem','sys','-I','normal','-iquote','quote']}
  ]);
  for(const loc of ['app/src/part.h','build/quote/only.h','build/normal/part.h','build/sys/driver.h','build/sys/part.h']) h.put('/work/'+loc);
  const out=await h.run();
  assert.deepEqual(out.headers.map(row=>row.uri.path),['/work/app/src/part.h','/work/build/normal/part.h','/work/build/quote/only.h','/work/build/sys/driver.h']);
  assert.ok(out.watchUris.some(uri=>uri.path==='/work/app/src/only.h'));
  assert.ok(!h.stats.includes('/other/sdk/part.h'));
  assert.ok(out.headers.every(header=>header.uri.authority==='ssh+lab'));
});

test('ambiguous compile commands do not select a same-named header from another configuration',async()=>{
  const h=fixture('#include <part.h>\n#include "local.h"');
  h.build(['debug','release'].map(variant=>({directory:'/work/build',file:'../app/src/main.c',arguments:['cc','-I',variant]})));
  h.put('/work/build/debug/part.h');h.put('/work/build/release/part.h');h.put('/work/app/src/local.h');
  const out=await h.run();
  assert.deepEqual(out.headers.map(row=>row.uri.path),['/work/app/src/local.h']);assert.equal(out.unresolved,1);
});

test('literal relative include reads unsaved text and records each include site',async()=>{
  const h=fixture('#if OPTIONAL\n#include "../include/part.h"\n#endif\n#include "../include/part.h"\n#include "../include/part.h"');
  const dirty={uri:new Uri('/work/app/include/part.h'),getText:()=>'struct edit {};',isDirty:true,version:7};
  h.options.vscode.workspace.textDocuments.push(dirty);
  h.put(dirty.uri.path,'struct disk {};');
  const [hit]=(await h.run()).headers;
  assert.equal(hit.text,'struct edit {};');assert.equal(hit.document,dirty);assert.equal(hit.version,7);
  assert.equal(hit.line,4);assert.deepEqual(hit.lines,[2,4,5]);assert.equal(hit.conditional,false);
  assert.deepEqual(h.reads,[]);
});

test('Zephyr fallback uses only the selected checkout and never searches sibling trees',async()=>{
  const h=fixture('#include <zephyr/device.h>\n#include "zephyr/missing.h"\n#include "../internal.h"\n#include "../../../peer/hidden.h"','/work/app/src/model.h');
  h.options.zephyrBase=new Uri('/work/zephyr-A');
  h.put('/work/zephyr-A/include/zephyr/device.h');h.put('/work/zephyr-B/include/zephyr/missing.h');
  h.put('/work/peer/hidden.h');h.put('/work/app/internal.h');
  const out=await h.run();
  assert.deepEqual(out.headers.map(row=>row.uri.path),['/work/zephyr-A/include/zephyr/device.h','/work/app/internal.h']);
  assert.equal(out.unresolved,2);
  assert.ok(!h.stats.some(path=>path.includes('zephyr-B') || path.includes('peer')));
});

test('Windows compile commands use case-insensitive file matching and keep quoted drive paths',async()=>{
  const h=fixture('#include <bus.h>','/G:/demo/app/main.c');
  h.build([{directory:'g:\\demo\\build',file:'..\\app\\MAIN.C',command:'"D:\\GNU Tools\\gcc.exe" -I"G:\\SDK headers" -c ..\\app\\MAIN.C'}],'/G:/demo/build');
  h.put('/G:/SDK headers/bus.h');
  const out=await h.run();
  assert.deepEqual(out.headers.map(row=>row.uri.path),['/G:/SDK headers/bus.h']);
});

test('an oversized earlier header is omitted rather than replaced by a lower-priority duplicate',async()=>{
  const h=fixture('#include "api.h"');
  h.build([{directory:'/work/build',file:'../app/src/main.c',arguments:['cc','-I','/vendor']}]);
  h.put('/work/app/src/api.h','x'.repeat(256*1024+1));h.put('/vendor/api.h');
  const out=await h.run();
  assert.equal(out.headers.length,0);assert.equal(out.omitted,1);
  assert.ok(!h.reads.includes('/vendor/api.h'));
});

test('disk data strips one UTF-8 BOM before comparison with the editor buffer',async()=>{
  const h=fixture();
  h.put('/work/app/src/api.h','\uFEFFstruct device {};');
  const out=await h.run();
  assert.equal(out.headers[0].text,'struct device {};');
});

test('unsupported include modes and inaccessible candidates do not choose a weaker match',async()=>{
  const h=fixture();
  h.build([{directory:'/work/build',file:'../app/src/main.c',arguments:['cc','-I-']}]);
  h.put('/work/app/src/api.h');
  assert.equal((await h.run()).headers.length,0);
  const g=fixture();
  g.build([{directory:'/work/build',file:'../app/src/main.c',arguments:['cc','-I','/vendor']}]);
  g.put('/vendor/api.h');
  const fs=g.options.vscode.workspace.fs,stat=fs.stat;
  fs.stat=uri=>{if (uri.path==='/work/app/src/api.h') throw Object.assign(Error(),{code:'NoPermissions'}); return stat(uri);};
  const out=await g.run();
  assert.equal(out.omitted,1);assert.ok(!g.reads.includes('/vendor/api.h'));
});

test('a superseded scan stops pending reads and accepts already-parsed source includes',async()=>{
  const h=fixture(),fs=h.options.vscode.workspace.fs;
  h.options.document.getText=()=>assert.fail('the supplied include sites are reused');
  h.options.includes=direct_includes('#include "one.h"\n#include "two.h"');
  let release,started,stale=false;
  const pending=new Promise(resolve=>{started=resolve;});
  fs.stat=async()=>{started();await new Promise(resolve=>{release=resolve;});return {size:1,type:1};};
  h.options.cancelled=()=>stale;
  const request=h.run();
  await pending;stale=true;release();
  const out=await request;
  assert.equal(out.cancelled,true);
  assert.deepEqual(out.headers,[]);assert.deepEqual(out.watchUris,[]);assert.deepEqual(h.reads,[]);
});
