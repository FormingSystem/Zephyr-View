'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {realpathSync} = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {execFileSync} = require('node:child_process');
const {westTopdir, localManifest, localInitPlan, remoteInitPlan, repairConfig} = require('../extension/westWorkspace');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'west workspace '));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  return root;
}

test('the nearest .west directory owns the checkout even when its config is missing',async t=>{
  const root = await fixture(t);
  const child = path.join(root,'child');
  const apps = path.join(child,'apps');
  await fs.mkdir(path.join(root,'.west'));
  await fs.mkdir(path.join(child,'.west'),{recursive:true});
  await fs.mkdir(apps);
  assert.equal(await westTopdir(apps),child);
  await fs.rmdir(path.join(child,'.west'));
  await fs.writeFile(path.join(child,'.west'),'not a directory');
  assert.equal(await westTopdir(apps),root);
});

test('repair edits only the two manifest options, retaining CRLF, comments and unrelated sections',()=>{
  const old = '; comment\r\n[manifest]\r\n  path : old\r\n; keep note\r\n[group]\r\npath=unrelated\r\n';
  const next = repairConfig(old,'product','manifests/west.yml');
  assert.equal(next,old.replace('[manifest]\r\n','[manifest]\r\n  file = manifests/west.yml\r\n').replace('path : old','path : product'));
  assert.equal(repairConfig(next,'product','manifests/west.yml'),next);
  assert.equal(repairConfig('[manifest]\npath=a\npath=b','c','west.yml'),undefined);
  assert.equal(repairConfig('[build]\nnot an entry\n[manifest]\npath=old','product','west.yml'),undefined);
  assert.equal(repairConfig('[manifest]\n[manifest]\n','c','west.yml'),undefined);
  assert.equal(repairConfig('[build]\ngenerator=Ninja','product','west.yml'),'[build]\ngenerator=Ninja\n[manifest]\npath = product\nfile = west.yml\n');
});

test('a chosen local manifest must belong to its selected repository and contain a manifest mapping',async t=>{
  const root = await fixture(t);
  const folder = path.join(root,'product'), file = path.join(folder,'release','demo.yml');
  await fs.mkdir(path.dirname(file),{recursive:true});
  await fs.writeFile(file,'manifest:\n  projects: []\n');
  assert.equal(await localManifest(folder,file),'release/demo.yml');
  assert.equal(await localManifest(path.dirname(file),path.join(root,'elsewhere')),undefined);
  await fs.writeFile(file,'build: unrelated');
  assert.equal(await localManifest(folder,file),undefined);
});

test('real west can reopen, repair and resolve a custom local manifest and clone it offline via Git',async t=>{
  const west = process.env.ZEPHYR_TEST_WEST || 'west';
  try { execFileSync(west,['--version'],{stdio:'ignore'}); }
  catch(error) { if(error.code === 'ENOENT' && !process.env.ZEPHYR_TEST_WEST) return t.skip('west is not on PATH'); throw error; }
  const base = await fixture(t), root = path.join(base,'local'), repo = path.join(root,'product root');
  const file = 'manifests/selected.yml';
  await fs.mkdir(path.join(repo,'manifests'),{recursive:true});
  await fs.writeFile(path.join(repo,file),'manifest:\n  self:\n    path: product\n  projects: []\n');
  function command(program,args,cwd,env={}) {
    return execFileSync(program,args,{cwd,encoding:'utf8',windowsHide:true,env:{...process.env,ZEPHYR_BASE:'',
      GIT_TERMINAL_PROMPT:'0',...env},stdio:['ignore','pipe','pipe']}).trim();
  }
  command('git',['init','-q'],repo);
  command('git',['add','.'],repo);
  command('git',['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','fixture'],repo);
  command('git',['tag','release-fixture'],repo);
  const revision = command('git',['rev-parse','HEAD'],repo);
  const check = cwd => {
    assert.equal(realpathSync(command(west,['topdir'],cwd)),realpathSync(cwd));
    assert.equal(command(west,['config','--local','manifest.file'],cwd),file);
    command(west,['manifest','--validate'],cwd);
    assert.match(command(west,['list','-f','{name}'],cwd),/manifest/);
  };
  async function init(plan) {
    await fs.mkdir(plan.root,{recursive:true});
    command(west,plan.args,plan.root,{WEST_CONFIG_LOCAL:path.join(plan.root,'.west','config')});
    check(plan.root);
  }
  await init(localInitPlan(repo,file));
  const config = path.join(root,'.west','config');
  command(west,['config','--local','build.generator','Ninja'],root);
  command(west,['config','--local','manifest.path','missing'],root);
  assert.throws(()=>command(west,['manifest','--validate'],root));
  await fs.writeFile(config,repairConfig(await fs.readFile(config,'utf8'),path.basename(repo),file));
  check(root);
  assert.equal(command(west,['config','--local','build.generator'],root),'Ninja');
  const remotePath=path.join(base,'cloned');
  await init(remoteInitPlan(remotePath,repo,'release-fixture',file));
  assert.equal(command('git',['rev-parse','HEAD'],path.join(remotePath,'product')),revision);
});
