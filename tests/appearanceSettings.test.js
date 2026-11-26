'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {appearance_settings} = require('../extension/appearance_settings');

test('window preferences survive a rejected write and are limited to user appearance settings', async () => {
  const values = {density: 'auto'};
  const writes = [];
  const config = {
    get: key => values[key],
    inspect: key => ({globalValue:values[key]}),
    async update(key, value, scope) {
      assert.equal(scope, 'user');
      writes.push([key, value]);
      if (writes.length === 1) throw Error('settings locked');
      values[key] = value;
    }
  };
  const workspace = {getConfiguration(name) { assert.equal(name, 'zephyrWorkbench.appearance'); return config; }};
  const settings = new appearance_settings(workspace, 'user');
  assert.deepEqual(settings.read(), {theme:undefined, density:'auto'});
  const first = settings.update({theme:'dark'});
  const second = settings.update({density:'compact', locations:{}, theme:'unknown'});
  const third = settings.update({theme:'light'});
  await assert.rejects(first, /settings locked/);
  await Promise.all([second, third]);
  assert.deepEqual(writes, [['theme','dark'], ['density','compact'], ['theme','light']]);
  assert.deepEqual(settings.read(), {theme:'light', density:'compact'});
});
