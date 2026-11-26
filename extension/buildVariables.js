'use strict';

const path = require('node:path');
const {realpathSync} = require('node:fs');

// These variables can reach configuration through the Zephyr or CMake environment.
const environmentKeys = [
  'CMAKE_GENERATOR', 'ZEPHYR_BASE', 'ZEPHYR_TOOLCHAIN_VARIANT', 'ZEPHYR_SDK_INSTALL_DIR',
  'CROSS_COMPILE', 'CMAKE_TOOLCHAIN_FILE', 'CMAKE_BUILD_TYPE', 'BOARD_ROOT', 'SHIELD',
  'CONF_FILE', 'EXTRA_CONF_FILE', 'DTC_OVERLAY_FILE', 'EXTRA_DTC_OVERLAY_FILE',
  'BOARD', 'SOC_ROOT', 'ARCH_ROOT', 'DTS_ROOT', 'APPLICATION_CONFIG_DIR', 'FILE_SUFFIX',
  'ZEPHYR_BOARD_ALIASES', 'DTS_SOURCE', 'SNIPPET',
  'ZEPHYR_MODULES', 'EXTRA_ZEPHYR_MODULES'
];

const cacheKeys = [...environmentKeys, 'Zephyr-sdk_DIR', 'CMAKE_C_COMPILER', 'CMAKE_CXX_COMPILER',
  'CMAKE_MAKE_PROGRAM', 'WEST_PYTHON', 'BOARD_DIR', 'SOC_FULL_DIR'];

function parseDefinition(argument) {
  const match = /^-D([A-Za-z_][\w.+-]*)(?::(\w+))?\s*=([\s\S]*)$/.exec(argument);
  if (match) return {name: match[1], type: match[2], value: match[3]};
}

/** Expose only the requested configuration entries, with credentials omitted from the summary. */
function displayedValue(name, value, source, type) {
  const sensitive = /(?:password|passwd|secret|token|credential|api[_-]?key|private[_-]?key)/i;
  const loginUrl = /[a-z][a-z\d+.-]*:\/\/[^\s/]+@/i;
  const loginParameter = /[?&](?:access_token|token|key|password|signature|credential)=/i;
  if (sensitive.test(name) || loginUrl.test(value) || loginParameter.test(value)) {
    return {source, type, hidden: true};
  }
  return {source, type, value};
}

function previewPlan(plan) {
  if (!plan) return;
  const configure = plan.configure.map(argument => {
    const entry = parseDefinition(argument);
    if (!entry || !displayedValue(entry.name, entry.value).hidden) return argument;
    return argument.slice(0, argument.indexOf('=') + 1) + '••••';
  });
  return {...plan, configure};
}

/** An existing build can keep its toolchain and generated files when two paths name the same checkout. */
function cacheSourceConflict(target, selectedBase) {
  if (!target.cacheFile || !selectedBase) return false;
  const sources = [target.cache.get('ZEPHYR_BASE'), target.system?.cache.get('ZEPHYR_BASE')];
  return sources.some(source => {
    if (!source || source.endsWith('-NOTFOUND') || !path.relative(selectedBase, source)) return false;
    try { return Boolean(path.relative(realpathSync.native(selectedBase), realpathSync.native(source))); }
    catch { return true; }
  });
}

/** Identify a cache by its recorded application, board, build directory and Zephyr checkout. */
function cacheStatus(target, application, board, buildDirectory, selectedBase) {
  if (!target.cacheFile) return 'absent';
  if (cacheSourceConflict(target, selectedBase)) return 'conflict';
  const app = target.cache.get('APPLICATION_SOURCE_DIR') || target.cache.get('CMAKE_HOME_DIRECTORY');
  const directory = (target.system?.cache || target.cache).get('CMAKE_CACHEFILE_DIR');
  if ((app && path.relative(application, target.app.fsPath)) ||
      (directory && path.relative(buildDirectory, directory)) ||
      (target.board && target.board !== board)) return 'conflict';
  if (!app || !target.board) return 'unknown';
  return 'current';
}

function commandInputs(snapshot, method, environment, westGenerator) {
  const {app, board, projectBoard, plan} = snapshot.setup;
  const inputs = new Map();
  for (const name of environmentKeys) {
    if (Object.hasOwn(environment, name)) inputs.set(name, {source: 'env', value: environment[name]});
  }
  inputs.set('APPLICATION_SOURCE_DIR', {source: snapshot.setup.system ? 'APP_DIR' : method === 'west' ? 'west' : '-S', value: app});
  inputs.set('CMAKE_CACHEFILE_DIR', {source: method === 'west' ? '-d' : '-B', value: snapshot.build.fsPath});
  // west passes its own -G to CMake; the CMAKE_GENERATOR environment default does not choose it.
  if (method === 'west') {
    inputs.delete('CMAKE_GENERATOR');
    if (westGenerator) inputs.set('CMAKE_GENERATOR', {source: 'west config', value: westGenerator});
  }
  const generator = plan.configure.indexOf('-G');
  if (generator >= 0) inputs.set('CMAKE_GENERATOR', {source: '-G', value: plan.configure[generator + 1]});
  for (const argument of plan.configure) {
    const definition = parseDefinition(argument);
    if (definition) inputs.set(definition.name, {...definition, source: '-D'});
  }
  if (board && !projectBoard) inputs.set('BOARD', {source: method === 'west' ? '-b' : '-D', value: board});
  else if (board && !inputs.has('BOARD')) {
    const cached=snapshot.setup.cacheStatus==='current' && snapshot.target.board===board;
    inputs.set('BOARD',{source:cached ? 'CACHED_BOARD' : 'west config',value:board});
  }
  return inputs;
}

function cachedInput(target, name) {
  if(target.system && (name==='CMAKE_CACHEFILE_DIR' || name==='APP_DIR' || target.system.commandDefinitions.includes(name))) {
    const value=target.system.cache.get(name);
    if(value!==undefined)return displayedValue(name,value,'sysbuild · '+name,target.system.cacheTypes.get(name));
  }
  const aliases = {BOARD: ['CACHED_BOARD', 'BOARD'], APPLICATION_SOURCE_DIR: ['APPLICATION_SOURCE_DIR', 'CMAKE_HOME_DIRECTORY']};
  const key = (Object.hasOwn(aliases, name) ? aliases[name] : [name]).find(k => target.cache.has(k));
  if (key) return displayedValue(name, target.cache.get(key), key, target.cacheTypes.get(key));
}

function buildVariables(snapshot, method, environment, westGenerator) {
  const {target} = snapshot;
  const status = snapshot.setup.cacheStatus;
  const inputs = commandInputs(snapshot, method, environment, westGenerator);
  const definitions = [...inputs].filter(([, input]) => input.source === '-D').map(([key]) => key);
  const names = new Set(['BOARD', 'CMAKE_GENERATOR', ...definitions, 'APPLICATION_SOURCE_DIR', 'CMAKE_CACHEFILE_DIR',
    ...cacheKeys, ...(status === 'current' ? [...target.commandDefinitions,...(target.system?.commandDefinitions || [])] : [])]);
  const rows = [];
  for (const name of names) {
    const input = inputs.get(name);
    const configured = status === 'current' ? cachedInput(target, name) : undefined;
    if (!input && !configured && name !== 'BOARD' && name !== 'CMAKE_GENERATOR') continue;
    const planned = input && displayedValue(name, input.value, input.source, input.type);
    rows.push({name, planned, configured});
  }
  return {status, rows};
}

module.exports = {buildVariables, cacheSourceConflict, cacheStatus, parseDefinition, previewPlan};
