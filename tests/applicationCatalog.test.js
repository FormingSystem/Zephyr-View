'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const {discoverApplications} = require('../extension/applicationCatalog');

test('the chooser includes module samples, metadata-only test projects and marker-free images', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'application-discovery-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  async function project(dir, cmake, files = []) {
    const source = path.join(root, dir);
    await fs.mkdir(source, {recursive: true});
    await fs.writeFile(path.join(source, 'CMakeLists.txt'), cmake);
    await Promise.all(files.map(name => fs.writeFile(path.join(source, name), '')));
    return source;
  }
  const check = path.join(root, 'zephyr');
  const findZephyr = 'find_package (\n\tZephyr REQUIRED\n)\n';
  await project('zephyr', '', ['prj.conf']);
  const moduleSample = await project('zephyr/samples/modules/example', '', ['tests.yaml']);
  const legacy = await project('zephyr/tests/legacy', '', ['testcase.yaml']);
  const remote = await project('external/build/remote', findZephyr);
  await project('external/generated', findZephyr, ['CMakeCache.txt']);
  await project('external/generated/nested', findZephyr);
  await project('external/support', '# find_package(Zephyr)\n#[[find_package(Zephyr)]]');
  await project('external/sdk-helper', 'find_package(Zephyr-sdk REQUIRED)');
  assert.deepEqual(await discoverApplications([root, check, remote], check), [legacy, moduleSample, remote].sort());
});
