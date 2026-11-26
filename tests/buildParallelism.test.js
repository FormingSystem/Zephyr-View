'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {build_parallelism, build_arguments, host_parallelism, job_count} = require('../extension/buildParallelism');

test('automatic scheduling uses the CPUs available to the extension host', () => {
  const restricted = {availableParallelism:() => 6, cpus:() => Array(24)};
  assert.equal(host_parallelism(restricted), 6);
  assert.equal(host_parallelism({cpus:() => Array(4)}), 4);
  assert.equal(host_parallelism({cpus:() => []}), 1);
  const policy = build_parallelism('', {}, host_parallelism(restricted));
  assert.equal(policy.jobs, 6);
  assert.deepEqual(build_arguments('CMake','out dir',policy), ['--build','out dir','--parallel','6']);
  assert.deepEqual(build_arguments('west','out dir',policy), ['build','-d','out dir','-o=-j6']);
});

test('an empty CMake parallel level delegates to the native build tool', () => {
  const policy = build_parallelism(undefined, {CMAKE_BUILD_PARALLEL_LEVEL:''}, 8);
  assert.equal(policy.source, 'environment');
  assert.equal(policy.invalidEnvironment, false);
  assert.deepEqual(build_arguments('CMake','out',policy), ['--build','out']);
});

test('a custom positive limit overrides the environment and can be reset', () => {
  const env = {CMAKE_BUILD_PARALLEL_LEVEL:'3'};
  assert.equal(build_parallelism('1',env,8).jobs, 1);
  assert.equal(build_parallelism('',env,8).jobs, 3);
  const invalid = {CMAKE_BUILD_PARALLEL_LEVEL:'all'};
  assert.equal(build_parallelism('',invalid,8).invalidEnvironment,true);
  assert.equal(build_parallelism('4',invalid,8).custom,4);
  assert.equal(build_parallelism('4',invalid,8).jobs,4);
  for (const value of [false,null,{},'0','-1','2.5','2x','3\n4','2147483648']) {
    assert.equal(job_count(value), undefined);
  }
});
