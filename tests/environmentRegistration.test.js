'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {registration,candidates,registrationScopes}=require('../extension/environmentRegistration');

test('only resolved Zephyr toolchain inputs are offered for registration',()=>{
  const sdk=path.resolve('sdk');
  assert.deepEqual(candidates([
    {name:'ZEPHYR_SDK_INSTALL_DIR',cached:sdk},{name:'PATH',value:sdk},
    {name:'ZEPHYR_BASE',value:'relative/base'},{name:'CROSS_COMPILE',value:'\n'},
    {name:'ZEPHYR_TOOLCHAIN_VARIANT',value:'zephyr',cached:'other'}
  ]),[{name:'ZEPHYR_SDK_INSTALL_DIR',value:sdk,cached:true},{name:'ZEPHYR_TOOLCHAIN_VARIANT',value:'zephyr',cached:false}]);
});

test('rejects unsupported variables and missing values before starting any program',async()=>{
  const run=()=>assert.fail('unexpected process');
  for(const request of [{name:'PATH',scope:'User'},{name:'ZEPHYR_BASE',scope:'User',write:true}]){
    await assert.rejects(registration(request,run));
  }
});

test('the Windows user registry can be inspected without changing it',{skip:process.platform!=='win32'},async()=>{
  const result=await registration({name:'ZEPHYR_SDK_INSTALL_DIR',scope:'User'});
  assert.ok(result===null || typeof result==='string');
});

test('Linux elevates only explicit machine writes and passes values as data',async()=>{
  const calls=[];
  const capture=async(exe,args)=>{calls.push([exe,args]);return {stdout:'null'};};
  const key={name:'ZEPHYR_BASE',scope:'Machine'},value="/tmp/带空格 $HOME 'quoted'";
  assert.equal(await registration(key,capture,'linux'),null);
  await registration({...key,value,previous:null,write:true},capture,'linux');
  assert.deepEqual(calls.map(([exe])=>exe),['/usr/bin/python3','/usr/bin/pkexec']);
  const args=calls[1][1];
  assert.deepEqual(args.slice(0,3),['/usr/bin/python3','-I','-c']);
  assert.equal(JSON.parse(args.at(-2)).value,value);
  assert.equal(args.at(-1),'/etc/environment.d');
});

test('macOS exposes only the current launchd session and passes paths as one argument',async()=>{
  assert.deepEqual(registrationScopes('darwin'),['Session']);
  for (const platform of ['linux','win32']) assert.deepEqual(registrationScopes(platform),['User','Machine']);
  const key={name:'ZEPHYR_BASE',scope:'Session'};
  let value=null;
  const run=async(exe,args)=>{
    assert.equal(exe,'/bin/launchctl');
    assert.equal(args[1],key.name);
    if (args[0]==='getenv') return {stdout:value===null?'':value+'\n'};
    assert.equal(args[0],'setenv');
    assert.equal(args.length,3);
    value=args[2];
    return {stdout:''};
  };
  assert.equal(await registration(key,run,'darwin'),null);
  const next="/Users/Zephyr Files/本地 '$sdk'";
  await registration({...key,write:true,previous:null,value:next},run,'darwin');
  assert.equal(await registration(key,run,'darwin'),next);
  await assert.rejects(registration({...key,write:true,previous:null,value:'new'},run,'darwin'),/changed/);
  await assert.rejects(registration({...key,scope:'Machine'},()=>assert.fail('unexpected elevation'),'darwin'),/scope/);
});

test('macOS distinguishes an unset variable from launchctl errors',async()=>{
  const key={name:'CROSS_COMPILE',scope:'Session'};
  const missing=async()=>{throw Object.assign(Error(),{code:1,stderr:''});};
  const unavailable=async()=>{throw Object.assign(Error('session unavailable'),{code:1,stderr:'permission denied'});};
  assert.equal(await registration(key,missing,'darwin'),null);
  await assert.rejects(registration(key,unavailable,'darwin'),/session unavailable/);
});
