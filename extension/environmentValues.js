'use strict';

const {win32} = require('node:path');

const literalVariables = new Set([
  'ZEPHYR_TOOLCHAIN_VARIANT', 'BOARD', 'SHIELD', 'CMAKE_GENERATOR', 'CMAKE_BUILD_TYPE',
  'CMAKE_BUILD_PARALLEL_LEVEL', 'FILE_SUFFIX', 'SNIPPET'
]);

// The webview receives only named build inputs. The task still inherits the full host environment.
const names = [
  'ZEPHYR_BASE', 'ZEPHYR_TOOLCHAIN_VARIANT', 'ZEPHYR_SDK_INSTALL_DIR', 'CROSS_COMPILE',
  'BOARD', 'BOARD_ROOT', 'SOC_ROOT', 'ARCH_ROOT', 'DTS_ROOT', 'SHIELD',
  'TOOLCHAIN_ROOT', 'GNUARMEMB_TOOLCHAIN_PATH', 'LLVM_TOOLCHAIN_PATH',
  'ZEPHYR_MODULES', 'EXTRA_ZEPHYR_MODULES', 'ZEPHYR_EXTRA_MODULES',
  'VIRTUAL_ENV', 'WEST_PYTHON', 'CMAKE_GENERATOR', 'CMAKE_BUILD_TYPE', 'CMAKE_BUILD_PARALLEL_LEVEL',
  'CMAKE_PREFIX_PATH', 'CMAKE_TOOLCHAIN_FILE',
  'CONF_FILE', 'EXTRA_CONF_FILE', 'DTC_OVERLAY_FILE', 'EXTRA_DTC_OVERLAY_FILE',
  'APPLICATION_CONFIG_DIR', 'FILE_SUFFIX', 'ZEPHYR_BOARD_ALIASES', 'DTS_SOURCE', 'SNIPPET'
];

function hostEnvironment(input, platform = process.platform) {
  const env = {...input};
  if (platform !== 'win32') return env;
  const canonical = new Set(names);
  for (const key of Object.keys(env)) {
    const upper = key.toUpperCase();
    if (upper === key || !canonical.has(upper)) continue;
    if (!Object.hasOwn(env, upper)) env[upper] = env[key];
    delete env[key];
  }
  return env;
}

function comparable(name, value, platform) {
  if (platform !== 'win32' || !value || literalVariables.has(name)) return value;
  return value.split(';').map(part => part && win32.normalize(part).toLowerCase()).join(';');
}

function environmentRows(state, taskEnvironment, platform = process.platform) {
  const cache = state.setup?.cacheStatus === 'current' ? state.target.cache : undefined;
  return names.map(name => {
    const value = taskEnvironment[name];
    const cacheKey = name === 'BOARD' && cache?.has('CACHED_BOARD') ? 'CACHED_BOARD' : name;
    const cached = cache?.get(cacheKey);
    const source = state.locations?.origins[name] || state.environmentOrigins?.[name] || 'host';
    const matches = cached !== undefined && value !== undefined &&
      comparable(name, value, platform) === comparable(name, cached, platform);
    return {name, value, source, cacheKey, cached, matches};
  });
}

module.exports = {hostEnvironment, environmentRows};
