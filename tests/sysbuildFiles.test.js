'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {host,workspace_state,uri} = require('./integration/adaptive-build-host.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'sysbuild-files-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const app=path.join(root,'app'), out=path.join(root,'out'), image=path.join(out,'primary');
  await Promise.all([fs.mkdir(app),fs.mkdir(image,{recursive:true})]);
  const input=path.join(app,'chosen.conf');
  await fs.writeFile(input,'');
  const main={name:'primary',dir:image}, system={main,domains:[main],cache:new Map()};
  await fs.writeFile(path.join(out,'CMakeCache.txt'),'CMAKE_PROJECT_NAME:STATIC=sysbuild_toplevel\nAPP_DIR:PATH='+app+'\n');
  await fs.writeFile(path.join(out,'domains.yaml'),JSON.stringify({default:'primary',build_dir:out,domains:[{name:'primary',build_dir:image}]}));
  const s={folder:{uri:uri(app)},build:uri(out),setup:{app,board:'test',system:true,cacheStatus:'current'},
    target:{cache:new Map(),system}};
  const context=workspace_state();
  const plan=async args=>host.filePlan(context,s,s.setup,args || [],{});
  return {app,out,image,input,s,system,context,plan};
}

test('image-prefixed CLI and root entries retain precedence; release preserves both user scopes',async t=>{
  const {s,system,context,input,plan}=await fixture(t);
  system.cache.set('CONF_FILE','top.conf');
  system.cache.set('primary_CONF_FILE','domain.conf');
  s.target.cache.set('CONF_FILE','child.conf');
  s.target.commandDefinitions=['CONF_FILE'];
  const untouched=['-Dremote_CONF_FILE=secondary.conf','-DCONF_FILE=global.conf'];
  await host.selectFiles(context,s,'kconfig',[input]);
  const selected=await plan(untouched);
  assert.deepEqual(selected.configure,[...untouched,'-Dprimary_CONF_FILE=chosen.conf']);
  await host.acknowledgeFileReset(context,selected.fileReset);
  system.cache.set('primary_CONF_FILE','chosen.conf');
  s.target.cache.set('CONF_FILE','chosen.conf');
  await host.selectFiles(context,s,'kconfig',null);
  const restored=await plan(untouched);
  assert.deepEqual(restored.configure,[...untouched,'-Dprimary_CONF_FILE=domain.conf']);
  assert.deepEqual(restored.fileReset.imageEdits,[{name:'CONF_FILE',value:'chosen.conf',restore:'child.conf'}]);
  assert.deepEqual((await plan([...untouched,'-Dprimary_CONF_FILE=from-cli.conf'])).configure,
    [...untouched,'-Dprimary_CONF_FILE=from-cli.conf']);
});

test('cache preparation verifies ownership, preserves other data, and rolls back a launch failure',async t=>{
  const {s,app,image}=await fixture(t);
  const file=path.join(image,'CMakeCache.txt');
  const lines=['// App','APPLICATION_SOURCE_DIR:PATH='+app,'// Build','CMAKE_CACHEFILE_DIR:INTERNAL='+image,
    '// First line','// Second line','CONF_FILE:STRING=a.conf;b.conf','','// User override','DTC_OVERLAY_FILE:STRING=third.overlay',
    '// Retain','PRIVATE:STRING=c;d',''];
  const original=lines.join('\r\n');
  await fs.writeFile(file,original);
  s.setup.fileReset={imageEdits:[{name:'CONF_FILE',value:'a.conf;b.conf'},{name:'DTC_OVERLAY_FILE',value:'different.overlay'}]};
  const rollback=await host.prepareFileConfigure(s);
  const prepared=await fs.readFile(file,'utf8');
  assert.equal(prepared,lines.filter(line=>!['// First line','// Second line','CONF_FILE:STRING=a.conf;b.conf'].includes(line)).join('\r\n'));
  await rollback();
  assert.equal(await fs.readFile(file,'utf8'),original);
  s.target.system.main.dir=app;
  await fs.writeFile(path.join(s.build.fsPath,'domains.yaml'),JSON.stringify({default:'primary',build_dir:s.build.fsPath,
    domains:[{name:'primary',build_dir:app}]}));
  await fs.writeFile(path.join(app,'CMakeCache.txt'),original);
  await assert.rejects(host.prepareFileConfigure(s),/outside/);
  assert.equal(await fs.readFile(path.join(app,'CMakeCache.txt'),'utf8'),original);
});

test('changing a manual selection twice releases the first entry that survived in the child cache',async t=>{
  const {s,system,context,app,input,plan}=await fixture(t);
  s.setup.cacheStatus='absent';
  await host.selectFiles(context,s,'kconfig',[input]);
  await host.acknowledgeFileReset(context,(await plan()).fileReset);
  s.setup.cacheStatus='current';
  system.cache.set('primary_CONF_FILE','chosen.conf');
  s.target.cache.set('CONF_FILE','chosen.conf');
  const second=path.join(app,'second.conf');
  await fs.writeFile(second,'');
  await host.selectFiles(context,s,'kconfig',[second]);
  await host.acknowledgeFileReset(context,(await plan()).fileReset);
  system.cache.set('primary_CONF_FILE','second.conf');
  await host.selectFiles(context,s,'kconfig',null);
  assert.deepEqual((await plan()).fileReset.imageEdits,[{name:'CONF_FILE',value:'chosen.conf',restore:undefined}]);
});

test('stale outer ownership and a linked domain pointing outside the build both prevent cache writes',async t=>{
  const {s,app,image,out}=await fixture(t);
  const file=path.join(app,'CMakeCache.txt'), link=path.join(out,'linked');
  const original='CMAKE_CACHEFILE_DIR:INTERNAL='+image+'\nAPPLICATION_SOURCE_DIR:PATH='+app+'\nCONF_FILE:STRING=selected.conf\n';
  await fs.writeFile(file,original);
  s.setup.fileReset={rootExpected:{primary_CONF_FILE:'selected.conf'},imageEdits:[{name:'CONF_FILE',value:'selected.conf'}]};
  await assert.rejects(host.prepareFileConfigure(s),/changed/);
  await fs.symlink(app,link,process.platform==='win32'?'junction':'dir');
  const main={name:'primary',dir:link};
  s.target.system.main=main;
  s.target.system.domains=[main];
  s.setup.fileReset.rootExpected={};
  await fs.writeFile(path.join(out,'domains.yaml'),JSON.stringify({default:'primary',build_dir:out,domains:[{name:'primary',build_dir:link}]}));
  await assert.rejects(host.prepareFileConfigure(s),/outside/);
  assert.equal(await fs.readFile(file,'utf8'),original);
});
