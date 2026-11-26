'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {parseDefinition} = require('./buildVariables');
const {board_roots, distinct_roots} = require('./boardRoots');
const execute = promisify(execFile);

function boardSettings(s, environment) {
  const definitions = (s.setup.plan?.configure || []).map(parseDefinition).filter(Boolean);
  const planned = new Map(definitions.map(({name, value}) => [name, value]));
  const cached = s.setup.cacheStatus === 'current' ? s.target.cache : undefined;
  const configured = name => planned.get(name) ?? cached?.get(name);
  const value = name => configured(name) ?? environment[name];
  const app = s.setup.app;
  const paths = name => {
    // root.cmake merges the cache, process environment and application declarations.
    const merged = ['BOARD_ROOT','SOC_ROOT','ARCH_ROOT'].includes(name);
    const inputs = merged ? [configured(name), environment[name]] : [value(name)];
    return distinct_roots(inputs.flatMap(board_roots), app).map(file => path.resolve(app, file));
  };
  return {value, paths, configured};
}

// zephyr_module.cmake replaces the manifest with ZEPHYR_MODULES, then merges both spellings of extra modules.
function boardModules(s, environment) {
  const {value,configured} = boardSettings(s,environment);
  const names = ['EXTRA_ZEPHYR_MODULES','ZEPHYR_EXTRA_MODULES'];
  const extras = [...names.map(configured),...names.map(name=>environment[name])];
  return {modules:board_roots(value('ZEPHYR_MODULES')),extraModules:extras.flatMap(board_roots)};
}

function rootOptions(s, environment) {
  const {paths} = boardSettings(s, environment);
  return {board_root: paths('BOARD_ROOT'), soc_root: paths('SOC_ROOT'), arch_root: paths('ARCH_ROOT')};
}

async function fileExists(file) {
  try { return (await fs.stat(file)).isFile(); }
  catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) return false; throw error; }
}

async function readBoards(s, environment, name, roots) {
  const {value, paths} = boardSettings(s, environment);
  const explicit = value('ZEPHYR_BASE');
  const candidates = explicit ? [path.resolve(s.setup.app, explicit)] :
    [s.manifest.uri && path.dirname(s.manifest.uri.fsPath), s.folder.uri.fsPath].filter(Boolean);
  let base;
  for (const dir of candidates) {
    if (await fileExists(path.join(dir, 'scripts', 'list_boards.py'))) { base = dir; break; }
  }
  if (!base) throw Error('ZEPHYR_BASE');
  roots ??= await pickerRoots(s, environment);
  // boards.cmake caches the directories of one resolved board. list_boards.py treats
  // --board-dir as an exclusive filter, so only reuse it to inspect that same board.
  const cachedBoard = s.target.cache.get('CACHED_BOARD') || s.target.cache.get('BOARD');
  const sameBoard = name && s.setup.cacheStatus === 'current' && name === cachedBoard?.split(/[@/]/, 1)[0];
  const modules = boardModules(s,environment);
  // Zephyr runs its module parser with ZEPHYR_BASE as its working directory.
  const resolveModules = entries => distinct_roots(entries,base).map(dir=>path.resolve(base,dir));
  const options = {base, name, roots, manifest: Boolean(s.manifest.root && s.tools.west),
    modules: resolveModules(modules.modules), extraModules: resolveModules(modules.extraModules),
    boardDirectories: sameBoard ? paths('BOARD_DIRECTORIES') : []};
  const python = s.tools.python || (process.platform === 'win32' ? 'python' : 'python3');
  const {stdout} = await execute(python, ['-B', path.join(__dirname, 'board_catalog.py'), JSON.stringify(options)],
    {env: environment, cwd: base, windowsHide: true, maxBuffer: 8*1024*1024, timeout: 30000});
  return JSON.parse(stdout);
}

function boardTargets(boards) {
  return boards.flatMap(({name, qualifiers, revisions}) =>
    ['', ...revisions.filter(Boolean).map(revision => '@'+revision)].flatMap(revision =>
      (qualifiers.length ? qualifiers : ['']).map(qualifier => name+revision+(qualifier ? '/'+qualifier : ''))));
}

// boards.cmake expands a missing SoC only for single-SoC boards. dts.cmake tests the
// full and shortened names in each board directory, retaining the last directory's match.
async function boardDts(record, target, includeLayout = false) {
  const match = /^([^@/]+)(?:@([^/]+))?(?:\/(.+))?$/.exec(target);
  if (!match || !record || match[1] !== record.name) return {detectionStatus: 'notFound'};
  if (match[2] && !record.revisions.includes(match[2])) return {detectionStatus: 'configure'};
  const singleSoc = record.socs.length === 1;
  let qualifier = match[3] || '';
  if (singleSoc && (!qualifier || qualifier.startsWith('/'))) qualifier = record.socs[0]+qualifier;
  if ((qualifier || record.qualifiers.length) && !record.qualifiers.includes(qualifier)) return {detectionStatus: 'notFound'};
  const parts = qualifier ? qualifier.split('/') : [];
  const filename = segments => [record.name, ...segments].join('_')+'.dts';
  let boardFile, ambiguous = false;
  const candidates = [];
  for (const dir of record.directories) {
    const full = path.join(dir, filename(parts));
    const short = parts.length && path.join(dir, filename(parts.slice(1)));
    const [hasFull, hasShort] = await Promise.all([fileExists(full), short && fileExists(short)]);
    if (hasFull) candidates.push(full);
    if (hasShort) candidates.push(short);
    if (hasShort && (!singleSoc || hasFull)) ambiguous = true;
    if (hasFull || hasShort) boardFile = hasFull ? full : short;
  }
  const result = ambiguous ? {detectionStatus: 'ambiguous'} :
    boardFile ? {boardFile, boardSource: 'detected'} : {detectionStatus: 'notFound'};
  if (includeLayout) {
    result.candidates = candidates;
    result.boardLayout = {name: record.name, qualifier, singleSoc, revision: match[2] || record.defaultRevision || ''};
  }
  return result;
}

// Read unconditional literal root declarations commonly used by out-of-tree applications.
// Conditional CMake, helper calls and variable expansion belong to real configuration.
function applicationRoots(source, app, roots) {
  const local = {board_root:[], soc_root:[], arch_root:[]};
  const prefix = source.replace(/#\[(=*)\[[\s\S]*?\]\1\]|#[^\n]*/g, '')
    .split(/\bfind_package\s*\(\s*Zephyr\b/i)[0];
  const declaration = /^\s*(set\s*\(|list\s*\(\s*(APPEND|PREPEND)\s+)\s*(BOARD_ROOT|SOC_ROOT|ARCH_ROOT)\s+([^()]*)\)/gim;
  const remainder = prefix.replace(declaration, (statement, _command, action, name, values, offset) => {
    if (/\b(?:if|foreach|while|function|macro|block|include)\s*\(/i.test(prefix.slice(0,offset))) return statement;
    const paths = [];
    for (const word of values.match(/"[^"]*"|[^\s"]+/g) || []) {
      const value = word.replace(/^"(.*)"$/, '$1').replace(/\$\{CMAKE_CURRENT_(?:SOURCE|LIST)_DIR\}/g, () => app);
      if (/[\$`"'<>\[\]]/.test(value) || /^(CACHE|PARENT_SCOPE|ENV)$/i.test(value)) return statement;
      paths.push(...value.split(';').filter(Boolean).map(dir => path.resolve(app,dir)));
    }
    const key = name.toLowerCase();
    if (!action) local[key] = paths;
    else if (action.toUpperCase() === 'PREPEND') local[key].unshift(...paths);
    else local[key].push(...paths);
    return '';
  });
  if (/\binclude\s*\(/i.test(remainder)) return;
  if (/\b(?:DTS_SOURCE|ZEPHYR_BOARD_ALIASES|BOARD_ROOT|BOARD_DIR|BOARD_DIRECTORIES|SOC_ROOT|ARCH_ROOT)\b/.test(remainder)) return;
  // root.cmake merges cache and environment roots before the application's current scope.
  return Object.fromEntries(Object.entries(roots).map(([name,external]) =>
    [name,distinct_roots([...external,...local[name]],app)]));
}

async function pickerRoots(s, environment) {
  const configured = rootOptions(s, environment);
  const file = path.join(s.setup.app, 'CMakeLists.txt');
  const source = await fs.readFile(file, 'utf8').catch(() => '');
  const roots = applicationRoots(source, s.setup.app, configured) || rootOptions(s, environment);
  // Offer boards bundled with the application too. The preview uses only effective roots.
  roots.board_root.push(s.setup.app);
  roots.soc_root.push(s.setup.app);
  return roots;
}

async function detectBoardDts(s, environment, lookup = readBoards, includeLayout = false) {
  const target = s.setup.board;
  if (!target || !s.setup.app) return {detectionStatus: 'selectBoard'};
  const {value} = boardSettings(s, environment);
  if (value('ZEPHYR_BOARD_ALIASES') || s.setup.error) return {detectionStatus: 'configure'};
  try {
    const source = await fs.readFile(path.join(s.setup.app, 'CMakeLists.txt'), 'utf8');
    const roots = applicationRoots(source, s.setup.app, rootOptions(s, environment));
    if (!roots) return {detectionStatus: 'configure'};
    const explicit = value('DTS_SOURCE');
    if (explicit != null) {
      if (path.isAbsolute(explicit) && await fileExists(explicit)) return {boardFile: path.normalize(explicit), boardSource: 'detected'};
      return {detectionStatus: 'configure'};
    }
    const name = target.split(/[@/]/, 1)[0];
    const [record] = await lookup(s, environment, name, roots);
    return await boardDts(record, target, includeLayout);
  } catch { return {detectionStatus: 'unavailable'}; }
}

module.exports = {boardDts, boardModules, boardTargets, detectBoardDts, pickerRoots, readBoards, rootOptions};
