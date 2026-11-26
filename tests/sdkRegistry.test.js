'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {unique_registered_sdk} = require('../extension/sdkRegistry');

test('Zephyr SDK listing keeps full paths and leaves ambiguous SDK selection to CMake', () => {
  const line = '-- Zephyr-sdk, version=1.0.1, dir=D:/Zephyr SDKs/sdk';
  assert.equal(unique_registered_sdk(line+'\r\n'+line), 'D:/Zephyr SDKs/sdk');
  assert.equal(unique_registered_sdk(line+'\n-- Zephyr-sdk, version=0.17.4, dir=D:/old'), undefined);
  assert.equal(unique_registered_sdk('-- Configuring done'), undefined);
});
