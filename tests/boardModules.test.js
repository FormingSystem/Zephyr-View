'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const {boardModules} = require('../extension/boardCatalog');

function snapshot(configure,cacheStatus = 'current') {
  return {setup:{app:'.',plan:{configure},cacheStatus},target:{cache:new Map([
    ['ZEPHYR_MODULES','cached'],['EXTRA_ZEPHYR_MODULES','cached-extra'],
    ['ZEPHYR_EXTRA_MODULES','cached-legacy']
  ])}};
}

test('an explicit module set replaces the inherited set and extra modules merge across scopes',() => {
  const state = snapshot(['-DZEPHYR_MODULES=one;two','-DEXTRA_ZEPHYR_MODULES=three']);
  const env = {ZEPHYR_MODULES:'inherited',EXTRA_ZEPHYR_MODULES:'four',ZEPHYR_EXTRA_MODULES:'five'};
  assert.deepEqual(boardModules(state,env),{modules:['one','two'],extraModules:['three','cached-legacy','four','five']});
});

test('an unrelated cache cannot add boards; a fresh empty module set leaves manifest discovery active',() => {
  assert.deepEqual(boardModules(snapshot([],'conflict'),{}),{modules:[],extraModules:[]});
  const env = {ZEPHYR_MODULES:'inherited'};
  assert.deepEqual(boardModules(snapshot(['-DZEPHYR_MODULES='],'absent'),env),{modules:[],extraModules:[]});
});
