'use strict';

const {execFile} = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const {promisify} = require('node:util');
const {boardCatalogBase, boardModules, boardTargets, pickerRoots, readBoardCatalog} = require('./boardCatalog');

const execute = promisify(execFile);

async function westBoardSource(s, env, method) {
  if (method !== 'west' || !s.tools.west || !s.manifest.root || !s.manifest.uri || s.manifest.invalid) return;
  const {modules, extraModules} = boardModules(s, env);
  if (modules.length || extraModules.length) return;
  // A sibling checkout may share the west topdir but define a different set of boards.
  const base = await boardCatalogBase(s, env);
  if (!base) return;
  const manifestDir = path.dirname(s.manifest.uri.fsPath);
  if (!path.relative(base, manifestDir)) return base;
  try {
    const [source, manifest] = await Promise.all([fs.realpath(base), fs.realpath(manifestDir)]);
    if (!path.relative(source, manifest)) return base;
  } catch (error) {
    if (!['ENOENT','ENOTDIR'].includes(error.code)) throw error;
  }
}

async function westTargets(s, env, roots, run) {
  const options = {env:{...env,PYTHONIOENCODING:'utf-8'},cwd:s.manifest.root.fsPath,
    windowsHide:true,maxBuffer:8*1024*1024,timeout:120000};
  const help = await run(s.tools.west, ['boards','--help'], options);
  const supported = new Set(help.stdout.match(/--[a-z][a-z-]*/g));
  const args = ['boards','--all-targets'];
  if (!supported.has('--all-targets')) return;
  for (const [kind,directories] of Object.entries(roots)) {
    const option = '--' + kind.replace('_','-');
    if (directories.length && !supported.has(option)) return;
    for (const directory of directories) args.push(option,directory);
  }
  const {stdout} = await run(s.tools.west,args,options);
  return stdout.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
}

function westDiagnostic(error) {
  // execFile and nested Python commands can include every invocation argument in their error text.
  const lastLine = String(error.stderr || '').trim().split(/\r?\n/).pop();
  const echoedCommand = /command (?:failed|['"\[])|calledprocesserror:/i.test(lastLine);
  const message = lastLine && !echoedCommand ? lastLine : String(error.code || 'west boards');
  return {kind:'west',message:message.slice(0,400)};
}

/** Return targets from the active build's checkout together with any recoverable catalog errors. */
async function listBoardChoices(s, env, method, run = execute, catalog = readBoardCatalog) {
  const roots = await pickerRoots(s, env);
  const diagnostics = [];
  let targets;
  const source = await westBoardSource(s,env,method);
  if (source) {
    try { targets = await westTargets(s,{...env,ZEPHYR_BASE:source},roots,run); }
    catch (error) { diagnostics.push(westDiagnostic(error)); }
  }
  if (targets === undefined) {
    // Older west interfaces omit qualifiers or revisions. The checkout's board parser retains both.
    const result = await catalog(s,env,undefined,roots);
    targets = boardTargets(result.boards);
    diagnostics.push(...result.diagnostics);
  }
  const normalized = targets.map(target=>target.replace(/@(?=\/|$)/,''));
  return {items:[...new Set(normalized)].sort(),diagnostics};
}

module.exports = {listBoardChoices};
