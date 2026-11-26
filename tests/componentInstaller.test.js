'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs/promises');
const hostPrograms = require('../extension/hostExecutables');
const {installerHost} = require('../extension/componentCatalog');

// Drive the actual Install row and stop at its picker, before touching host tools.
test('the host picker keeps local installers and official sources without its package manager',async()=>{
  let available,choices,opened;
  const vscode={
    Uri:{parse:url=>new URL(url)},
    env:{language:'en',openExternal:async url=>{opened=url;}},
    window:{showQuickPick:async items=>{choices=items.map(item=>item.id);return items.find(item=>item.id==='official');}}
  };
  const original=Module._load;
  let install;
  try {
    Module._load=function(name,...args){
      if(name==='vscode')return vscode;
      if(name==='./hostExecutables')return {...hostPrograms,findProgram:async name=>available && name};
      return original.call(this,name,...args);
    };
    ({install}=require('../extension/componentInstall'));
  } finally {Module._load=original;}

  const release=process.platform==='linux'?await fs.readFile('/etc/os-release','utf8').catch(()=>''):'';
  const host=installerHost(process.platform,release);
  for(available of [false,true]){
    await install({}, {folder:{uri:new URL('file:///example/')}},'cmake',()=>true);
    assert.equal(choices.includes('package'),available && !!host.manager);
    assert.equal(choices.includes('local'),!!host.formats.length);
    assert.equal(choices.includes('manager'),!available && !!host.help);
    assert.equal(opened.href,'https://cmake.org/download/');
  }
});
