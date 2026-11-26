'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {environmentRows, hostEnvironment} = require('../extension/environmentValues');

function rows(cacheStatus, cache, environment, origins = {}) {
  const state = {setup: {cacheStatus}, target: {cache: new Map(cache)}, locations: {origins}};
  return new Map(environmentRows(state, environment, 'win32').map(row => [row.name, row]));
}

test('Windows compares paths using native separators and preserves literal option values', () => {
  const env = hostEnvironment({zephyr_base: 'C:/sdk/zephyr', CMake_Build_Type: 'Debug', CMAKE_BUILD_PARALLEL_LEVEL: '08'}, 'win32');
  const fields = rows('current', [
    ['ZEPHYR_BASE', 'c:\\SDK\\zephyr'], ['CMAKE_BUILD_TYPE', 'debug'], ['CMAKE_BUILD_PARALLEL_LEVEL', '8']
  ], env, {ZEPHYR_BASE: 'workspace'});
  assert.equal(fields.get('ZEPHYR_BASE').matches, true);
  assert.equal(fields.get('ZEPHYR_BASE').source, 'workspace');
  assert.equal(fields.get('CMAKE_BUILD_TYPE').matches, false);
  assert.equal(fields.get('CMAKE_BUILD_PARALLEL_LEVEL').matches, false);
  assert.equal(hostEnvironment({zephyr_base: '/tmp/zephyr'}, 'linux').ZEPHYR_BASE, undefined);
});

test('unset, empty and cache-only values remain distinct and belong to the selected target', () => {
  const cache = [['CACHED_BOARD', 'qemu_cortex_m3'], ['DTC_OVERLAY_FILE', '']];
  const env = {CONF_FILE: '', PRIVATE_FIXTURE_SETTING: 'unrelated host value'};
  const current = rows('current', cache, env);
  assert.equal(current.get('BOARD').value, undefined);
  assert.equal(current.get('BOARD').cached, 'qemu_cortex_m3');
  assert.equal(current.get('DTC_OVERLAY_FILE').cached, '');
  assert.equal(current.get('CONF_FILE').value, '');
  assert.equal(current.has('PRIVATE_FIXTURE_SETTING'), false);
  for (const status of ['absent', 'unknown', 'conflict']) {
    assert.equal(rows(status, cache, env).get('BOARD').cached, undefined);
  }
});
