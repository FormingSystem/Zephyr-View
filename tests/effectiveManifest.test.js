'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {effectiveManifest,importsProjects}=require('../extension/effectiveManifest');

const root={fsPath:'workspace'}, uri={}, direct={name:'base'};
const source={root,uri,projects:[direct],hasImports:true};
test('all consumers see imported projects with the path and revision selected by west',async()=>{
  const manifest=await effectiveManifest(source,'west',{VIRTUAL_ENV:'venv'},async(program,args,options)=>{
    assert.equal(program,'west');
    assert.equal(args[0],'list');
    assert.equal(options.cwd,root.fsPath);
    assert.equal(options.env.VIRTUAL_ENV,'venv');
    return {stdout:'manifest\tapp\tHEAD\t\nimported\tmodules/vendor/lib\tpin-a\tgit@example:lib\r\n'};
  });
  assert.equal(manifest.scope,'effective');
  assert.deepEqual(manifest.projects,[{name:'imported',path:'modules/vendor/lib',revision:'pin-a',url:'git@example:lib'}]);
});

test('missing west, a failed import or an unreadable response preserves direct entries and marks their scope',async()=>{
  const fail=async()=>{throw Error('unavailable');};
  for(const [west,run] of [[undefined,fail],['west',fail],['west',async()=>({stdout:'unexpected'})]]){
    const manifest=await effectiveManifest(source,west,{},run);
    assert.equal(manifest.scope,'partial');
    assert.deepEqual(manifest.projects,[direct]);
  }
  assert.equal(importsProjects({self:{import:{'path-prefix':'libs'}}}),true);
  assert.equal(importsProjects({projects:[{import:['sub.yml']}]}),true);
  assert.equal(importsProjects({projects:[{import:'false'},{import:[]}]}),false);
});
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {manifestInputs, createManifestResolver} = require('../extension/effectiveManifest');

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'manifest inputs '));
  t.after(() => fs.rm(dir,{recursive:true,force:true}));
  const root = {fsPath:dir};
  const manifest = {root,uri:{fsPath:path.join(dir,'west.yml')},repository:root,checkout:dir,projects:[]};
  let count = 0, fail = false;
  const resolver = createManifestResolver(async () => {
    count++;
    if (fail) throw Error('Failed west probe');
    return {stdout:'project\tcustom-path\t' + count + '\tremote-url'};
  });
  function inputs(self, projects, config='[manifest]\npath=source', additionalText='') {
    const data = {self, projects};
    manifest.inputs = manifestInputs(data,JSON.stringify(data)+additionalText,config);
  }
  return {dir,manifest,inputs,resolver,calls:()=>count,setFail:value=>{fail=value;},
    list:(env={}) => resolver.resolve(manifest,'west',env)};
}

test('cached west output follows root data, settings, command environment and explicit refresh',async t=>{
  const f = await fixture(t);
  f.inputs({},[]);
  await Promise.all([f.list(),f.list(),f.list()]);
  assert.equal((await f.list()).projects[0].revision,'1');
  f.inputs({},[],undefined,'\n# Edited');
  await f.list();
  f.inputs({},[],'[manifest]\npath=other');
  await f.list();
  await f.list({WEST_CONFIG_GLOBAL:'different'});
  assert.equal(f.calls(),4);
  f.resolver.clear();
  f.setFail(true);
  assert.equal((await f.list()).scope,'direct');
  f.setFail(false);
  assert.equal((await f.list()).scope,'effective');
  await f.list();
  assert.equal(f.calls(),6);
});

test('file and directory self imports invalidate on edit, addition and removal',async t=>{
  const f = await fixture(t);
  const dir = path.join(f.dir,'submanifests');
  const one = path.join(f.dir,'self.yml'), two = path.join(dir,'module.yaml');
  await fs.mkdir(dir);
  await fs.writeFile(one,'manifest: {projects: []}');
  f.inputs({import:['self.yml','submanifests']},[]);
  await f.list();
  assert.equal((await f.list()).projects[0].revision,'1');
  await fs.writeFile(two,'manifest: {projects: [{name: local}]}');
  assert.equal((await f.list()).projects[0].revision,'2');
  await fs.writeFile(two,'manifest: {projects: [{name: other}]}');
  assert.equal((await f.list()).projects[0].revision,'3');
  await fs.unlink(two);
  await fs.writeFile(one,'manifest: {projects: [{name: base}]}');
  assert.equal((await f.list()).projects[0].revision,'4');
});

test('complex or unreadable imports are resolved on each refresh',async t=>{
  const f = await fixture(t);
  const one = path.join(f.dir,'self.yml');
  f.inputs({},[{import:'nested.yml'}]);
  await f.list(); await f.list();
  f.inputs({import:'self.yml'},[]);
  await f.list(); await f.list();
  await fs.writeFile(one,'manifest: {self: {import: other.yml}}');
  await f.list(); await f.list();
  await fs.writeFile(one,'invalid YAML: [');
  await f.list(); await f.list();
  assert.equal(f.calls(),8);
});
