'use strict';

// Paths come from the extension host, which may be running on a different OS than VS Code.
(() => {
  const platform = globalThis.document?.documentElement?.dataset?.pathPlatform
    ?? globalThis.process?.platform
    ?? (/^Win/i.test(globalThis.navigator?.platform ?? '') ? 'win32' : 'posix');

  const pathVariables = new Set([
    'APPLICATION_SOURCE_DIR', 'ARCH_ROOT', 'BOARD_DIR', 'BOARD_ROOT', 'CMAKE_CACHEFILE_DIR',
    'CMAKE_C_COMPILER', 'CMAKE_CXX_COMPILER', 'CMAKE_HOME_DIRECTORY', 'CMAKE_MAKE_PROGRAM',
    'CMAKE_PREFIX_PATH', 'CMAKE_TOOLCHAIN_FILE', 'CONF_FILE', 'CROSS_COMPILE', 'DTC_OVERLAY_FILE',
    'DTS_ROOT', 'EXTRA_CONF_FILE', 'EXTRA_DTC_OVERLAY_FILE', 'EXTRA_ZEPHYR_MODULES',
    'GNUARMEMB_TOOLCHAIN_PATH', 'LLVM_TOOLCHAIN_PATH', 'SOC_FULL_DIR', 'SOC_ROOT', 'TOOLCHAIN_ROOT',
    'VIRTUAL_ENV', 'WEST_PYTHON', 'ZEPHYR_BASE', 'ZEPHYR_EXTRA_MODULES', 'ZEPHYR_MODULES',
    'APPLICATION_CONFIG_DIR', 'ZEPHYR_BOARD_ALIASES', 'DTS_SOURCE',
    'ZEPHYR_SDK_INSTALL_DIR', 'Zephyr-sdk_DIR'
  ]);

  function displayPath(value, host = platform) {
    if (typeof value !== 'string' || !value.includes('\\')) return value;
    if (/^(?:[a-z][\w+.-]*:\/\/|[^/\\\s]+@[^:/\\\s]+:)/i.test(value)) return value;
    if (host !== 'win32' && !/^(?:[a-z]:[\\/]|\\\\)/i.test(value)) return value;
    return value.replaceAll('\\', '/');
  }

  function relativeLabel(value, root, host = platform) {
    const label = displayPath(value, host);
    if (!label || !root) return label;
    const base = displayPath(root, host).replace(/\/+$/, '');
    const windows = host === 'win32' || /^(?:[a-z]:\/|\/\/)/i.test(base);
    const key = text => windows ? text.toLowerCase() : text;
    if (key(label).replace(/\/+$/, '') === key(base)) return '.';
    return key(label).startsWith(key(base) + '/') ? label.slice(base.length + 1) : label;
  }

  function displayVariable(name, value, type, host = platform) {
    const isPath = pathVariables.has(name) || type === 'PATH' || type === 'FILEPATH';
    if (typeof value !== 'string' || !isPath) return value;
    // In a CMake list, an escaped semicolon belongs to the filename.
    return value.split(/(\\;|;)/).map((part, index) => index % 2 ? part : displayPath(part, host)).join('');
  }

  const api = {path: displayPath, relative: relativeLabel, variable: displayVariable};
  if (typeof module !== 'undefined') module.exports = api;
  else globalThis.ZephyrPathDisplay = api;
})();
