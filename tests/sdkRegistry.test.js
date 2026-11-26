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

test('offline SDK registry is queried once per environment and refresh; a failed CMake query is retried', async t => {
  const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
  const {registered_sdk}=require('../extension/sdkRegistry');
  const {clearToolchainDiscovery}=require('../extension/toolchainDiscoveryCache');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'offline sdk '));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const scripts=path.join(root,'scripts','west_commands','sdk');
  await fs.mkdir(scripts,{recursive:true});
  const listing=path.join(scripts,'listsdk.cmake'),counter=path.join(root,'calls.log');
  const contents=['file(APPEND "$ENV{SDK_LOG}" "run\\n")','message(STATUS "Zephyr-sdk, version=1.0, dir=$ENV{RESULT_DIR}")'].join('\n');
  const first={...process.env,RESULT_DIR:root,SDK_LOG:counter.split(path.sep).join('/')};
  const second={...first,RESULT_DIR:scripts};
  const read=env=>registered_sdk(root,'cmake',env);
  await fs.writeFile(listing,'message(FATAL_ERROR "Incomplete package")');
  assert.equal(await read(first),undefined);
  await fs.writeFile(listing,contents);
  assert.deepEqual(await Promise.all([read(first), read(first)]),[root,root]);
  assert.equal(await read(second),scripts);
  assert.equal(await read(first),root);
  clearToolchainDiscovery();
  assert.equal(await read(first),root);
  assert.equal((await fs.readFile(counter,'utf8')).trim().split(/\r?\n/).length,3);
});
