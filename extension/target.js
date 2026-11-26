'use strict';

const vscode = require('vscode');
const path = require('node:path');
const yaml = require('js-yaml');

async function readText(uri) {
  try {
    return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
  } catch (error) {
    if (error.code === 'FileNotFound' || error.code === 'FileIsADirectory') return '';
    throw error;
  }
}

async function fileInfo(uri) {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return (stat.type & vscode.FileType.File) ? stat : undefined;
  } catch {
    return undefined;
  }
}

async function hasFile(uri) {
  return Boolean(await fileInfo(uri));
}

function cacheEntries(text) {
  const cache = new Map();
  const cacheTypes = new Map();
  const commandDefinitions = [];
  let commandLineHelp = false;
  for (const line of text.split(/\r?\n/)) {
    const match = /^([^#/][^:]*):(\w+)=(.*)$/.exec(line);
    if (match) {
      const [, name, type, value] = match;
      cache.set(name, value);
      cacheTypes.set(name, type);
      if (commandLineHelp || type === 'UNINITIALIZED') commandDefinitions.push(name);
    }
    commandLineHelp = line.startsWith('//No help, variable specified on the command line.');
  }
  return {cache, cacheTypes, commandDefinitions};
}

function resolvePath(root, value) {
  if (!value) return undefined;
  if (root.scheme === 'file' && path.isAbsolute(value)) return vscode.Uri.file(value);
  const normalized = value.replace(/\\/g, '/');
  if (normalized.startsWith('/')) return root.with({path: normalized});
  return vscode.Uri.joinPath(root, normalized);
}

function matchesRecordedBoard(record, target) {
  const requested = /^([^@/]+)(?:@([^/]+))?(?:\/(.+))?$/.exec(target || '');
  if (!requested || record?.name !== requested[1]) return false;
  const [, , revision, qualifiers] = requested;
  if (revision && revision !== record.revision) return false;
  if (!qualifiers) return true;
  // Zephyr expands e.g. board//cpu to board/soc/cpu on single-SoC boards.
  if (qualifiers.startsWith('/')) return typeof record.qualifiers === 'string' && record.qualifiers.split('/').slice(1).join('/') === qualifiers.slice(1);
  return qualifiers === record.qualifiers;
}

// A missing record permits legacy cache lookups. A conflicting record invalidates them.
async function buildRecord(buildDir, app, board, cache) {
  const text = await readText(vscode.Uri.joinPath(buildDir, 'build_info.yml'));
  if (!text) return undefined;
  let cmake;
  try { cmake = yaml.load(text, {schema: yaml.FAILSAFE_SCHEMA})?.cmake; }
  catch { return null; }
  const sourceDir = cmake?.application?.['source-dir'];
  if (typeof sourceDir !== 'string' || path.relative(app.fsPath, sourceDir)) return null;
  if (!matchesRecordedBoard(cmake.board, board) && !await matchesResolvedBoard(buildDir,cmake.board,cache)) return null;
  return cmake;
}

// BOARD in the cache can be an alias. Check the resolved target against independent build outputs.
async function matchesResolvedBoard(buildDir,record,cache) {
  const dir=cache.get('BOARD_DIR');
  if (!dir || !Array.isArray(record?.path) || !record.path.some(item=>typeof item==='string' && !path.relative(item,dir))) return false;
  const config=await readText(vscode.Uri.joinPath(buildDir,'zephyr','.config'));
  const target=/^CONFIG_BOARD_TARGET="([^"\r\n]+)"\r?$/m.exec(config)?.[1];
  const revision=/^CONFIG_BOARD_REVISION="([^"\r\n]*)"\r?$/m.exec(config)?.[1];
  return Boolean(target && matchesRecordedBoard(record,target) && (!record.revision || revision===record.revision));
}

async function readDevicetree(buildDir, app, cmake) {
  const unknown = {sourcesKnown: false, overlays: []};
  if (cmake === null) return unknown;
  const output = vscode.Uri.joinPath(buildDir, 'zephyr', 'zephyr.dts');
  const merged = await hasFile(output) ? output : undefined;
  const files = cmake?.devicetree?.files;
  if (!Array.isArray(files) || !files.length || !files.every(file => typeof file === 'string' && file.trim())) return {...unknown, merged};
  // Zephyr passes this ordered list to the preprocessor with APPLICATION_SOURCE_DIR as its working directory.
  const [base, ...overlays] = files.map(file => resolvePath(app, file));
  return {sourcesKnown: true, base, overlays, merged};
}

function configurationDirectory(app,cmake,cache) {
  const root = cmake?.application?.['configuration-dir'] || cache.get('APPLICATION_CONFIG_DIR');
  return typeof root === 'string' && root ? resolvePath(app,root) : app;
}

function primaryInputs(record, root, empty) {
  const inputs = record?.['user-files'];
  const valid = values => Array.isArray(values) && values.every(file => typeof file === 'string' && file.trim());
  if (!valid(record?.files)) return;
  if (inputs === undefined && empty) return [];
  if (!valid(inputs)) return;
  const merged = record.files.map(file => resolvePath(root,file).fsPath);
  const primary = inputs.map(file => resolvePath(root,file).fsPath);
  if (primary.every(file => merged.some(other => !path.relative(file,other)))) return primary;
}

async function readKconfigFiles(app, buildDir, cmake, cache) {
  if (cmake === null) return {files: [], kconfigSourcesKnown: false};
  const kconfig = cmake?.kconfig;
  const paths = kconfig?.files;
  const kconfigSourcesKnown = Array.isArray(paths) && paths.every(file => typeof file === 'string' && file.trim());
  const configDir = configurationDirectory(app,cmake,cache);
  // Only "files" records the actual merge. User-file lists or older caches describe candidate inputs.
  const requested = key => (cache.get(key) || '').split(/[;\s]+/).filter(Boolean);
  const list = kconfigSourcesKnown ? paths : [
    ...(Array.isArray(kconfig?.['user-files']) ? kconfig['user-files'] : requested('CONF_FILE')),
    ...(Array.isArray(kconfig?.['extra-user-files']) ? kconfig['extra-user-files'] :
      [...requested('OVERLAY_CONFIG'), ...requested('EXTRA_CONF_FILE')])
  ];
  const files = new Map();
  for (const entry of list) {
    if (typeof entry !== 'string' || !entry.trim()) continue;
    const file = resolvePath(configDir, entry);
    const relative = path.relative(buildDir.fsPath, file.fsPath);
    if (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep)) continue;
    files.set(file.toString(), file);
  }
  const inputs = [...files.values()];
  const exists = await Promise.all(inputs.map(hasFile));
  return {files: inputs.filter((_, index) => exists[index]), kconfigSourcesKnown};
}

function hasCurrentBuild({setup, target}) {
  return setup.cacheStatus === 'current' && Boolean(target?.generated) && !setup.readiness?.build?.includes('configureFailed');
}

function taskScope(s) {
  return 'build.failure:'+JSON.stringify([s.folder?.uri.toString(),s.setup.app,s.setup.projectBoard ? null : s.setup.board,s.build?.fsPath]);
}

async function lastBuildFailure(context, s) {
  let key = taskScope(s), failure = context.workspaceState.get(key);
  if (!failure && s.setup.projectBoard && s.setup.board) {
    key=taskScope({...s,setup:{...s.setup,projectBoard:false}});
    failure=context.workspaceState.get(key);
  }
  if (failure?.action === 'configure' && s.setup.cacheStatus === 'current' && s.target.generatedAt > failure.time) {
    await context.workspaceState.update(key, undefined);
    return undefined;
  }
  return failure;
}

function debugRunner(s) {
  const {l10n} = vscode;
  if (s.setup.readiness?.build?.includes('configureFailed')) return {message:l10n.t('Last configuration failed')};
  if (s.setup.cacheStatus === 'conflict') return {message:l10n.t('Build directory belongs to another target')};
  if (!hasCurrentBuild(s)) return {message:l10n.t('Configure this target first')};
  if (s.target.conflictingRunnerMetadata) return {message:l10n.t('Build metadata does not match this target')};
  if (!s.target.runnersFile) return {message:l10n.t('No runners.yaml generated')};
  const file = s.target.runnersFile.fsPath;
  if (s.target.invalidRunners) return {file, message:l10n.t('Unable to parse runners.yaml')};
  if (!s.target.runner) return {file, message:l10n.t('No debug runner specified')};
  return {file, name:s.target.runner};
}

async function readTarget(folder, buildDir) {
  const cacheText=await readText(vscode.Uri.joinPath(buildDir,'CMakeCache.txt'));
  const entries=cacheEntries(cacheText), {cache}=entries;
  if (cache.get('CMAKE_PROJECT_NAME')!=='sysbuild_toplevel') return readImage(folder,buildDir,cacheText,entries);
  const system={...entries,root:buildDir.fsPath,...require('./sysbuild').imageDomains(
    await readText(vscode.Uri.joinPath(buildDir,'domains.yaml')),buildDir.fsPath)};
  if (system.main) {
    const image=await readImage(folder,vscode.Uri.file(system.main.dir));
    if (image.cacheFile) {
      image.system=system;
      return image;
    }
  }
  const incomplete=await readImage(folder,buildDir,cacheText,entries);
  incomplete.app=resolvePath(buildDir,cache.get('APP_DIR')) || folder.uri;
  incomplete.generated=false;
  incomplete.system=system;
  return incomplete;
}

async function readImage(folder, buildDir, existingCache, entries) {
  const cacheFile = vscode.Uri.joinPath(buildDir, 'CMakeCache.txt');
  const runnersFile = vscode.Uri.joinPath(buildDir, 'zephyr', 'runners.yaml');
  const [cacheText, runnersText] = await Promise.all([existingCache ?? readText(cacheFile), readText(runnersFile)]);
  const {cache, cacheTypes, commandDefinitions} = entries ?? cacheEntries(cacheText);
  let runners = {};
  let invalidRunners = false;
  if (runnersText) {
    try {
      runners = yaml.load(runnersText, {schema: yaml.JSON_SCHEMA}) || {};
      invalidRunners = typeof runners !== 'object' || Array.isArray(runners) ||
        (runners['debug-runner'] != null && typeof runners['debug-runner'] !== 'string');
    } catch {
      invalidRunners = true;
    }
  }
  const app = resolvePath(buildDir, cache.get('APPLICATION_SOURCE_DIR') || cache.get('CMAKE_HOME_DIRECTORY')) || folder.uri;
  const generator = cache.get('CMAKE_GENERATOR') || '';
  const makefile = /Ninja/i.test(generator) ? 'build.ninja' : /Makefiles/i.test(generator) ? 'Makefile' : 'CMakeFiles/cmake.check_cache';
  const output = cacheText && await fileInfo(vscode.Uri.joinPath(buildDir,makefile));
  const generated = Boolean(output);
  const board = cache.get('CACHED_BOARD') || cache.get('BOARD');
  const cmake = generated ? await buildRecord(buildDir, app, board, cache) : null;
  const runnerBoard = runners.config?.board_dir;
  const cacheBoard = cache.get('BOARD_DIR');
  const conflictingRunnerMetadata = cmake === null || Boolean(typeof runnerBoard === 'string' && cacheBoard &&
    path.isAbsolute(runnerBoard) && path.isAbsolute(cacheBoard) && path.relative(cacheBoard, runnerBoard));
  const [devicetree, kconfig] = await Promise.all([
    readDevicetree(buildDir, app, cmake), readKconfigFiles(app, buildDir, cmake, cache)
  ]);
  const confirmedInputs = {
    kconfig: primaryInputs(cmake?.kconfig,configurationDirectory(app,cmake,cache),cache.get('CONF_FILE') === ''),
    overlay: primaryInputs(cmake?.devicetree,app,cache.get('DTC_OVERLAY_FILE') === '')
  };
  return {app, buildDir, cache, cacheTypes, commandDefinitions, devicetree, generated, generatedAt:generated ? output.mtime : undefined, zephyrBase:cache.get('ZEPHYR_BASE'), board,
    runner: runners?.['debug-runner'], runnerData: invalidRunners ? {} : runners, invalidRunners, conflictingRunnerMetadata, ...kconfig,confirmedInputs,configuredBoard:cmake?.board,
    cacheFile: cacheText ? cacheFile : undefined, runnersFile: runnersText || await hasFile(runnersFile) ? runnersFile : undefined};
}

async function looksLikeZephyr(folder) {
  for (const name of ['prj.conf', 'west.yml', '.west/config', 'build/zephyr/.config']) {
    if (await hasFile(vscode.Uri.joinPath(folder.uri, name))) return true;
  }
  const cmake = await readText(vscode.Uri.joinPath(folder.uri, 'CMakeLists.txt'));
  return require('./applicationCatalog').isApplication(cmake);
}

module.exports = {cacheEntries, debugRunner, taskScope, lastBuildFailure, hasCurrentBuild, hasFile, looksLikeZephyr, readText, readTarget, resolvePath};

