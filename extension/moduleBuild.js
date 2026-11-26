'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const execute = require('node:util').promisify(require('node:child_process').execFile);
const {workspace} = require('vscode');
const {parseDefinition} = require('./buildVariables');
const {entries,rootOf,selectedState} = require('./modules');
const {westModuleDiscovery} = require('./toolchainDiscoveryCache');
const {probeKey} = require('./probeCache');

const primary = 'ZEPHYR_MODULES', extra = 'EXTRA_ZEPHYR_MODULES';
const marker = 'ZEPHYR_EXTENSION_MODULE_INPUT';

function previousInput(cache) {
  try {
    const entry=JSON.parse(cache.get(marker));
    if ([primary,extra].includes(entry.key) && entry.value===cache.get(entry.key)) return entry;
  } catch {}
}

async function projectOwnsModuleList(app,base) {
  const visited=new Set(),pending=[path.join(app,'CMakeLists.txt')];
  while (pending.length) {
    const file=pending.pop();
    if (visited.has(file)) continue;
    if (visited.size>=64) return true;
    visited.add(file);
    const text=await fs.readFile(file,'utf8').catch(()=>undefined);
    if (text===undefined) return true;
    const prefix=text.replace(/#\[(=*)\[[\s\S]*?\]\1\]|#[^\n]*/g,'').split(/\bfind_package\s*\(\s*Zephyr\b/i)[0];
    if (/\bZEPHYR_MODULES\b|\b(?:add_subdirectory|cmake_language)\s*\(/i.test(prefix)) return true;
    for (const match of prefix.matchAll(/\binclude\s*\(\s*(?:"([^"]+)"|([^\s)]+))([^)]*)\)/gi)) {
      const token=(match[1]||match[2]).replace(/\$\{CMAKE_CURRENT_LIST_DIR\}/g,()=>path.dirname(file))
        .replace(/\$\{(?:CMAKE_CURRENT_SOURCE_DIR|APPLICATION_SOURCE_DIR)\}/g,()=>app)
        .replace(/\$(?:ENV)?\{ZEPHYR_BASE\}/g,m=>base||m);
      // File includes use the current source directory. Module-name and computed includes belong to CMake.
      if (token.includes('$') || !/\.cmake$/i.test(token)) return true;
      const child=path.resolve(app,token);
      if (/\bOPTIONAL\b/i.test(match[3]) && !await fs.stat(child).catch(()=>undefined)) continue;
      pending.push(child);
    }
  }
  return false;
}

// Zephyr checks west with its build interpreter, from ZEPHYR_BASE even for an external application.
async function cmakeUsesWest(s, target, manual, cache, environment) {
  const selected = name => manual.get(name)?.value;
  const buildPython = selected('Python3_EXECUTABLE') || selected('WEST_PYTHON');
  if (cache.has('WEST') && !buildPython && !selected('ZEPHYR_BASE')) {
    const value = cache.get('WEST');
    return Boolean(value && !value.endsWith('-NOTFOUND'));
  }
  const source = selected('ZEPHYR_BASE') || environment.ZEPHYR_BASE || cache.get('ZEPHYR_BASE') || s.checkout;
  const python = buildPython || cache.get('Python3_EXECUTABLE') || s.tools?.python;
  if (!source || !python || !workspace.isTrusted) return false;
  const cwd = path.resolve(target.app, source);
  return westModuleDiscovery.read(probeKey(python, cwd, environment), async () => {
    try {
      await execute(python, ['-c', 'import sys; del sys.path[0]; from west.util import west_topdir; west_topdir()'],
        {cwd,env:environment,windowsHide:true,timeout:5000});
      return true;
    } catch { return false; }
  });
}

/** Preserve the project's primary module set. Zephyr merges EXTRA_ZEPHYR_MODULES from each scope. */
async function moduleArguments(context,s,target,method,args,environment) {
  const record=selectedState(context,{...s,setup:target},method);
  const paths=entries(s,record).filter(e=>record.selected.includes(e.name) && (method==='CMake' || e.kind!=='workspace'))
    .map(e=>path.resolve(rootOf(s),e.path||e.name).split(path.sep).join('/'));
  const cache=target.cacheStatus==='current' ? (s.target.system?.cache||s.target.cache) : new Map();
  const old=previousInput(cache);
  if (!paths.length && !cache.has(marker)) return args;
  const manual=new Map(args.map(parseDefinition).filter(Boolean).map(d=>[d.name,d]));
  const original=key=>manual.get(key)?.value ?? (old?.key===key ? old.original : cache.get(key));
  const base=original(primary) ?? environment[primary];
  const supplementary=method==='west' || base || (paths.length && (
    await projectOwnsModuleList(target.app,environment.ZEPHYR_BASE) ||
    await cmakeUsesWest(s,target,manual,cache,environment)));
  const key=supplementary ? extra : primary;
  const result=paths.length ? args.filter(arg=>parseDefinition(arg)?.name!==key) : [...args];
  // Only clear cache values that still match the extension's last input, allowing external CMake edits.
  if (old && (!paths.length || old.key!==key) && !manual.has(old.key)) {
    result.push(old.original===undefined ? '-U'+old.key : '-D'+old.key+'='+old.original);
  }
  if (!paths.length) return [...result,'-U'+marker];
  const prior=original(key);
  const value=[prior,...paths].filter(Boolean).join(';');
  const stamp=JSON.stringify({key,value,original:prior});
  const type=manual.get(key)?.type;
  return [...result,'-D'+key+(type ? ':'+type : '')+'='+value,'-D'+marker+':INTERNAL='+stamp];
}

module.exports={moduleArguments};
