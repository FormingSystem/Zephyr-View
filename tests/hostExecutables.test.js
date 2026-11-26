'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {findProgram, hostBinDirectories, taskSearchPath} = require('../extension/hostExecutables');

test('macOS GUI discovery adds the native Homebrew prefix while honoring explicit search order', () => {
  const env = {PATH:'/work/tools:/usr/bin:/bin'};
  assert.deepEqual(hostBinDirectories(env, 'darwin', 'arm64'), ['/work/tools','/opt/homebrew/bin','/usr/bin','/bin']);
  assert.deepEqual(hostBinDirectories(env, 'darwin', 'x64'), ['/work/tools','/usr/local/bin','/usr/bin','/bin']);
  assert.deepEqual(hostBinDirectories({...env,HOMEBREW_PREFIX:'/Volumes/Tools'}, 'darwin', 'arm64'),
    ['/work/tools','/Volumes/Tools/bin','/usr/bin','/bin']);
  assert.deepEqual(hostBinDirectories({PATH:'/usr/bin:/opt/homebrew/bin'}, 'darwin', 'arm64'),
    ['/usr/bin','/opt/homebrew/bin']);
});

test('task subprocesses see the selected virtual environment and the same Homebrew precedence', () => {
  const env = {PATH:'/my/tools:/usr/bin'};
  assert.equal(taskSearchPath(env, ['/app/.venv/bin'], ['/opt/homebrew/bin'], 'darwin', 'arm64'),
    '/app/.venv/bin:/my/tools:/opt/homebrew/bin:/usr/bin');
  assert.equal(taskSearchPath(env, [], [], 'darwin', 'arm64'), env.PATH);
});

test('Windows accepts quoted Path entries and Unix keeps PATH case sensitive', () => {
  assert.deepEqual(hostBinDirectories({Path:'"C:\\Program Files\\CMake\\bin";relative;D:\\custom'}, 'win32', 'x64'),
    ['C:\\Program Files\\CMake\\bin','D:\\custom']);
  assert.deepEqual(hostBinDirectories({Path:'/other',PATH:'./local:/usr/bin'}, 'linux', 'x64'), ['/usr/bin']);
});

test('explicit directories take priority, ignore directories named like programs, and can disable host fallback', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'zephyr host tools '));
  t.after(() => fs.rm(temp, {recursive:true,force:true}));
  const filename = process.platform === 'win32' ? 'west.exe' : 'west';
  const dirs = ['invalid', 'venv', 'system'].map(name => path.join(temp, name));
  await Promise.all(dirs.map(dir => fs.mkdir(dir)));
  await fs.mkdir(path.join(dirs[0], filename));
  for (const dir of dirs.slice(1)) await fs.writeFile(path.join(dir,filename), 'fixture', {mode:0o755});
  const env = {PATH:dirs[2]};
  assert.equal(await findProgram('west', {directories:dirs.slice(0,2),env}),path.join(dirs[1],filename));
  assert.equal(await findProgram('west', {directories:[dirs[0]],env}),path.join(dirs[2],filename));
  assert.equal(await findProgram('west', {directories:[dirs[0]],env,includeHostPath:false}),undefined);
});
