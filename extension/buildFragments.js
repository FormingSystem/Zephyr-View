'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const vscode = require('vscode');
const {parseDefinition} = require('./buildVariables');
const {projectFile} = require('./studio');

const variables = {kconfig: 'EXTRA_CONF_FILE', device: 'EXTRA_DTC_OVERLAY_FILE'};
const primary = {kconfig: 'CONF_FILE', device: 'DTC_OVERLAY_FILE'};
const expansion = /\$(?:ENV|CACHE)?\{|\$<|@[A-Za-z_]\w*@/;
const keyPath = file => process.platform === 'win32' ? path.normalize(file).toLowerCase() : path.normalize(file);
let registration = Promise.resolve();

function scope(snapshot, target) {
  return 'buildSetup.fragments:' + JSON.stringify([snapshot.folder.uri.toString(), keyPath(target.app),
    target.board, keyPath(snapshot.build.fsPath)]);
}

function definitions(args) {
  const result = new Map();
  args.forEach((argument, index) => {
    const entry = parseDefinition(argument);
    if (entry) result.set(entry.name, {...entry, index});
  });
  return result;
}

function fragmentRoot(target, kind, values, cache, environment) {
  if (kind === 'device') return target.app;
  const directory = values.get('APPLICATION_CONFIG_DIR')?.value ?? cache.get('APPLICATION_CONFIG_DIR') ??
    environment.APPLICATION_CONFIG_DIR ?? target.app;
  const resolved = directory.replace(/\$\{APPLICATION_SOURCE_DIR\}/g, () => target.app);
  return expansion.test(resolved) ? undefined : path.resolve(target.app, resolved);
}

function contains(list, root, file) {
  return typeof list === 'string' && list.split(/[; ]+/).some(value =>
    value && !expansion.test(value) && (path.isAbsolute(value) || root) &&
    keyPath(path.resolve(root || '', value)) === keyPath(file));
}

function alreadySelected(kind, root, file, values, cache, environment) {
  const base = primary[kind];
  if (contains(values.get(base)?.value ?? cache.get(base) ?? environment[base], root, file)) return true;
  const keys = kind === 'kconfig' ? [variables[kind], 'OVERLAY_CONFIG'] : [variables[kind]];
  return keys.some(key => contains(values.get(key)?.value ?? cache.get(key), root, file) || contains(environment[key], root, file));
}

function inDirectory(directory, file) {
  const relative = path.relative(directory, file);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
}

function argumentPath(root, file) {
  // Zephyr accepts application-relative paths. Its list parser splits literal spaces even inside quotes.
  const relative = (root ? path.relative(root, file) : file).split(path.sep).join('/');
  if (/[\s;]/.test(relative) || expansion.test(relative))
    throw Error(vscode.l10n.t('Zephyr cannot use this fragment path in its file list: {0}. Choose a path without spaces, semicolons, or variable expansions.', relative));
  return relative;
}

function currentCache(snapshot, target) {
  return target.cacheStatus === 'current' ? snapshot.target.cache : new Map();
}

/** Add only the command-line contributions; Zephyr merges environment and project scopes itself. */
function fragmentPlan(context, snapshot, target, args, environment) {
  const names = context.workspaceState.get(scope(snapshot, target), []);
  const includedFragments = names.map(name => path.resolve(target.app, name));
  if (!includedFragments.length) return {configure: args, includedFragments};
  const configure = [...args], values = definitions(args), cache = currentCache(snapshot, target);
  for (const [kind, key] of Object.entries(variables)) {
    const root = fragmentRoot(target, kind, values, cache, environment);
    const explicit = values.get(key);
    const original = explicit?.value ?? cache.get(key) ?? '';
    let value = original;
    for (const file of includedFragments) {
      if (path.extname(file).toLowerCase() !== (kind === 'device' ? '.overlay' : '.conf')) continue;
      if (alreadySelected(kind, root, file, values, cache, environment)) continue;
      value += (value ? ';' : '') + argumentPath(root, file);
    }
    if (value === original) continue;
    const definition = '-D' + key + (explicit?.type ? ':' + explicit.type : '') + '=' + value;
    if (explicit) configure[explicit.index] = definition;
    else configure.push(definition);
  }
  return {configure, includedFragments};
}

/** Register an existing application fragment in exactly one folder/application/board/build target. */
async function register(context, snapshot, filename, stillCurrent) {
  const target = snapshot.setup;
  if (!vscode.workspace.isTrusted || !snapshot.folder || !target.board || typeof filename !== 'string' || !stillCurrent())
    return false;
  const file = path.resolve(target.app, filename);
  const input = snapshot.inputs?.find(item => keyPath(item.file) === keyPath(file));
  if (!input || !Object.hasOwn(variables, input.kind)) throw Error(vscode.l10n.t('Reopen the configuration input before saving.'));
  const actual = await projectFile(target.app, file, input.kind, false);
  const build = await fs.realpath(snapshot.build.fsPath).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return snapshot.build.fsPath;
  });
  if (inDirectory(build, actual)) throw Error(vscode.l10n.t('Select a source fragment outside the build directory.'));
  if (!(await fs.stat(actual)).isFile()) throw Error(vscode.l10n.t('Reopen the configuration input before saving.'));
  await fs.access(actual, fs.constants.W_OK);
  const relative = path.relative(target.app, file).split(path.sep).join('/');
  const key = scope(snapshot, target), included = context.workspaceState.get(key, []);
  if (input.applied || included.some(name => keyPath(path.resolve(target.app, name)) === keyPath(file))) return false;
  const values = definitions(target.plan.configure), cache = currentCache(snapshot, target), env = snapshot.environment || {};
  const root = fragmentRoot(target, input.kind, values, cache, env);
  if (alreadySelected(input.kind, root, file, values, cache, env)) return false;
  argumentPath(root, file);
  if (!stillCurrent()) return false;
  await context.workspaceState.update(key, [...included, relative]);
  return true;
}

function includeFragment(context, snapshot, filename, stillCurrent) {
  const next = registration.then(() => register(context, snapshot, filename, stillCurrent));
  registration = next.catch(() => {});
  return next;
}

module.exports = {includeFragment, fragmentPlan};
