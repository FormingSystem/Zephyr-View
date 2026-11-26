'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const {ProbeCache} = require('../extension/probeCache');

test('an old failed probe cannot evict a newer result after a manual refresh', async () => {
  const cache = new ProbeCache(1, 1000);
  let fail;
  const old = cache.read('board', () => new Promise((_,reject) => { fail=reject; }));
  await Promise.resolve();
  cache.clear();
  assert.equal(await cache.read('board', ()=>'current'), 'current');
  fail(Error('checkout removed'));
  await assert.rejects(old,/checkout removed/);
  assert.equal(await cache.read('board', ()=>assert.fail('new result lost')), 'current');
});

test('probing additional inputs evicts older entries and invalid result shapes can be retried', async () => {
  const cache = new ProbeCache(1, 1000);
  await cache.read('first', ()=>'old');
  await cache.read('next', ()=>'other');
  assert.equal(await cache.read('first', ()=>'new'), 'new');
  await assert.rejects(cache.read('bad', ()=>null, value=>value.valid), TypeError);
  assert.equal(await cache.read('bad', ()=>'valid'), 'valid');
});
