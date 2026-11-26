'use strict';

const os = require('node:os');

// CMake accepts a positive signed integer as the build job limit.
function job_count(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  const text = String(value);
  if (!/^\d+$/.test(text)) return undefined;
  const count = Number(text);
  return count > 0 && count <= 2147483647 ? count : undefined;
}

function host_parallelism(host = os) {
  return job_count(host.availableParallelism?.()) ?? job_count(host.cpus?.()?.length) ?? 1;
}

/** Resolve the job limit on the extension host, including remote workspaces. */
function build_parallelism(request, env = process.env, hostCount = host_parallelism()) {
  const inherited = env.CMAKE_BUILD_PARALLEL_LEVEL;
  const automatic = inherited === undefined ? hostCount : job_count(inherited);
  const custom = job_count(request);
  return {
    hostCount, automatic, custom, jobs: custom ?? automatic,
    source: inherited === undefined ? 'host' : 'environment',
    invalidEnvironment: inherited !== undefined && inherited !== '' && !automatic
  };
}

/** Keep native build flags out of the CMake configuration command. */
function build_arguments(method, directory, parallelism) {
  const west = method === 'west';
  const args = west ? ['build', '-d', directory] : ['--build', directory];
  const count = parallelism?.jobs;
  if (!count) return args;
  return args.concat(west ? ['-o=-j' + count] : ['--parallel', String(count)]);
}

module.exports = {job_count, host_parallelism, build_parallelism, build_arguments};
