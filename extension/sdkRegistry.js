'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');

const {registeredSdks} = require('./toolchainDiscoveryCache');
const {probeKey} = require('./probeCache');
const run = promisify(execFile);

/** Use a single installation reported by Zephyr. CMake resolves version precedence during configure. */
function unique_registered_sdk(output) {
  const directories = new Set();
  for (const line of output.split(/\r?\n/)) {
    const record = /^-- Zephyr-sdk, version=[^,]+, dir=(.+)$/.exec(line);
    if (record) directories.add(record[1].trim());
  }
  if (directories.size === 1) return [...directories][0];
}

/** Query the installed checkout's offline SDK listing, also used by west sdk list. */
async function registered_sdk(base, cmake, environment) {
  if (!base || !cmake) return;
  const script = path.join(base, 'scripts', 'west_commands', 'sdk', 'listsdk.cmake');
  try {
    await fs.access(script);
    const env = {...environment, ZEPHYR_BASE:base};
    return await registeredSdks.read(probeKey(cmake,script,env), async () => {
      const result = await run(cmake, ['-DZEPHYR_BASE='+base, '-P', script], {
        cwd:base, env, windowsHide:true, timeout:5000
      });
      return unique_registered_sdk(result.stdout);
    });
  } catch {
    // Older checkouts can leave SDK discovery to the native configure step.
    return undefined;
  }
}

module.exports = {unique_registered_sdk, registered_sdk};
