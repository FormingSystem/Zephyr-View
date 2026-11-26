'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const cp=require('node:child_process');
const {host,uri,vscode,workspace_state}=require('./integration/adaptive-build-host.cjs');
const catalog=host.moduleCatalog;

async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'zephyr-module-cache-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:50}));
  const s={folder:{uri:uri(root)},manifest:{root:uri(root),projects:[]},tools:{git:'git'},setup:{app:root}};
  const context=workspace_state();
  const row=async()=> (await catalog.rows(context,s,'CMake'))[0];
  return {s,root,row};
}

test('warm pinned checkouts skip Git processes, external Git changes and explicit refresh stay visible',async t=>{
  const {s,root,row}=await fixture(t);
  const dir=path.join(root,'driver');
  await fs.mkdir(dir);
  const git=(...args)=>cp.execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid','-c','commit.gpgSign=false','-c','core.hooksPath='+(process.platform==='win32'?'NUL':'/dev/null'),...args],
    {cwd:dir,encoding:'utf8',windowsHide:true}).trim();
  git('init','-q','-b','main');
  git('commit','-qm','First','--allow-empty');
  const first=git('rev-parse','HEAD');
  git('commit','-qm','Second','--allow-empty');
  const second=git('rev-parse','HEAD');
  git('checkout','-q','--detach',second);
  const project={name:'driver',path:'driver',revision:second};
  s.manifest.projects.push(project);
  const launches=t.mock.method(cp.ChildProcess.prototype,'spawn').mock;
  assert.equal((await row())[6].status,'已同步');
  assert.equal(launches.callCount(),1);
  assert.equal((await row())[6].head,second);
  assert.equal(launches.callCount(),1);

  catalog.clearStatusCache();
  assert.equal((await row())[6].head,second);
  assert.equal(launches.callCount(),2);
  const before=launches.callCount();
  vscode.workspace.isTrusted=false;
  try {assert.equal((await row())[6].head,undefined);}
  finally {vscode.workspace.isTrusted=true;}
  assert.equal(launches.callCount(),before);

  const gitDir=process.env.GIT_DIR;
  process.env.GIT_DIR=path.join(root,'missing.git');
  try {assert.equal((await row())[6].head,undefined);}
  finally {if(gitDir===undefined)delete process.env.GIT_DIR;else process.env.GIT_DIR=gitDir;}

  git('checkout','-q','--detach',first);
  const changed=(await row())[6];
  assert.equal(changed.head,first);
  assert.equal(changed.status,'版本不同');
  assert.ok(changed.objects.includes(second));
  git('checkout','-q','main');
  git('tag','target',first);
  project.revision='refs/tags/target';
  assert.equal((await row())[6].required,first);
  git('tag','-f','target',second);
  assert.equal((await row())[6].status,'已同步');
});

test('warm offline modules reread edited, removed, or explicitly refreshed metadata',async t=>{
  const {s,root,row}=await fixture(t);
  const dir=path.join(root,'board-pack'),entry=path.join(dir,'zephyr','module.yml');
  await fs.mkdir(path.dirname(entry),{recursive:true});
  await fs.writeFile(entry,'name: board-driver\n');
  s.localModules=[{name:'board-driver',path:dir}];
  const read=t.mock.method(fs,'readFile').mock;
  const reads=()=>read.calls.filter(call=>call.arguments[0]===entry).length;
  assert.equal((await row())[3],'本地已识别');
  assert.equal((await row())[3],'本地已识别');
  assert.equal(reads(),1);
  catalog.clearStatusCache();
  assert.equal((await row())[3],'本地已识别');
  assert.equal(reads(),2);
  await fs.writeFile(entry,'name: a-different-module\n');
  assert.equal((await row())[3],'待本机验证');
  await fs.rm(entry);
  assert.equal((await row())[3],'待本机验证');
  await fs.writeFile(entry,'name: board-driver\n');
  assert.equal((await row())[3],'本地已识别');
});
