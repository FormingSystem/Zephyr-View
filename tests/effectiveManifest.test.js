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
