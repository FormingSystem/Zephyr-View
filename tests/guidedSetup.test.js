'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const original=Module._load;
let missingComponents,applySelected;
try{
  Module._load=function(name,...args){return name==='vscode'?{env:{language:'en'}}:original.call(this,name,...args);};
  ({missingComponents,applySelected}=require('../extension/guidedSetup'));
}finally{Module._load=original;}

const snapshot={environment:{},setup:{board:'board'},compilerChoices:{mode:'sdk',options:[]}};
const empty={tools:{},python:{},hasRequirements:false,sdkFound:false,sourceFound:false};

test('fresh west bootstrap orders interpreter, west and source before checkout dependencies',()=>{
  assert.deepEqual(missingComponents(snapshot,'west',empty).map(row=>row.id),
    ['git','cmake','ninja','python','west','ZEPHYR_BASE','dependencies','ZEPHYR_SDK_INSTALL_DIR','dtc','gperf']);
  assert.deepEqual(missingComponents(snapshot,'west',empty).filter(row=>!row.picked).map(row=>row.id),['dtc','gperf']);
});

test('standalone CMake respects external compilers, alternate generators and environments without west',()=>{
  const external={...snapshot,compilerChoices:{mode:'cross'}};
  const ready={...empty,tools:{python:'bin',cmake:'bin',dtc:'bin',gperf:'bin'},python:{venv:true,missing:['west']},
    hasRequirements:true,sourceFound:true,generator:'Unix Makefiles'};
  assert.deepEqual(missingComponents(external,'CMake',ready),[]);
  assert.deepEqual(missingComponents({...snapshot,compilerChoices:{mode:'sdk',requestedDefinitions:['CMAKE_TOOLCHAIN_FILE=local.cmake']}},
    'CMake',ready),[]);
  const rows=missingComponents(external,'CMake',{...ready,python:{venv:false,missing:['PyYAML','west']}});
  assert.equal(rows[0].id,'python');
  assert.equal(rows[1].id,'dependencies');
  assert.equal(rows[1].picked,false);
  assert.ok(rows[1].description.includes('PyYAML'));
});

test('selected SDK architecture can require a toolchain in an existing minimal SDK',()=>{
  const arm={...snapshot,compilerChoices:{mode:'sdk',triplet:'arm-zephyr-eabi',options:[]}};
  assert.ok(missingComponents(arm,'CMake',{...empty,sdkFound:true}).some(row=>row.id==='ZEPHYR_SDK_INSTALL_DIR'));
  const installed={...arm,compilerChoices:{...arm.compilerChoices,options:[{source:'sdk'}]}};
  assert.ok(!missingComponents(installed,'CMake',{...empty,sdkFound:true}).some(row=>row.id==='ZEPHYR_SDK_INSTALL_DIR'));
  const beforeBoard={environment:{ZEPHYR_TOOLCHAIN_VARIANT:'zephyr'},setup:{},compilerChoices:{mode:'other'}};
  assert.equal(missingComponents(beforeBoard,'CMake',empty).find(row=>row.id==='ZEPHYR_SDK_INSTALL_DIR').picked,false);
});

test('redetection skips satisfied steps, retains cancelled steps, and stops on an unverified install',async()=>{
  const items=['a','b','c','d'].map(id=>({id}));
  const calls=[];
  let rows=items;
  const read=async()=>({rows});
  const run=async id=>{calls.push(id);if(id==='a')rows=items.slice(2);return id==='a';};
  assert.deepEqual(await applySelected(items,read,run,()=>true),items.slice(2));
  assert.deepEqual(calls,['a','c']);
  assert.deepEqual(await applySelected(items,read,async()=>true,()=>true),items.slice(2));
  assert.deepEqual(await applySelected(items,read,async()=>{throw Error('changed workspace');},()=>false),items);
});
