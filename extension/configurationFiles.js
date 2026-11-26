'use strict';

const path = require('node:path');
const {realpath} = require('node:fs/promises');
const {l10n} = require('vscode');
const {parseDefinition} = require('./buildVariables');
const {fileControls,prepareFileConfigure} = require('./sysbuildFileInputs');
const {types, key, unique, exists, absolute, application_context, sole_main_config, candidates, automatic_files} = require('./configurationFileDiscovery');

const kinds = Object.keys(types);
const scope = (s, target) => 'configurationFiles:' + JSON.stringify([s.folder.uri.toString(),key(target.app),target.projectBoard ? null : target.board,key(s.build.fsPath)]);
const build_receipt = (s,target) => 'configurationFiles.build:' + JSON.stringify([s.folder.uri.toString(),key(target.app),key(s.build.fsPath)]);
const definitions = args => new Map(args.map(parseDefinition).filter(Boolean).map(({name,value}) => [name,value]));

function previous_configure(context, s, target) {
  const last = context.workspaceState.get(build_receipt(s,target));
  if (last) return last;
  // Older versions stored ownership alongside the selection, indexed by the resolved board.
  const id = scope(s,{...target,projectBoard:false});
  return {id,applied:context.workspaceState.get(id + ':applied',{}),previous:{}};
}

function argument_value(files, kind, root) {
  if (kind === 'dts') return files[0].split(path.sep).join('/');
  return files.map(file => {
    const location = (root ? path.relative(root,file) : file).split(path.sep).join('/');
    if (/[\s;]/.test(location) || !absolute(root || '',location))
      throw Error(l10n.t('Zephyr cannot use this fragment path in its file list: {0}. Choose a path without spaces, semicolons, or variable expansions.',location));
    return location;
  }).join(';');
}

function listed_files(value, kind, root) {
  if (value === undefined) return [];
  const entries = kind === 'dts' ? [value] : value.split(/[;\s]+/);
  return entries.filter(Boolean).map(entry => absolute(root,entry)).filter(Boolean);
}

function assign(configure, name, value) {
  const retained = configure.filter(arg => parseDefinition(arg)?.name !== name);
  retained.push(value === undefined ? '-U' + name : '-D' + name + '=' + value);
  return retained;
}

async function filePlan(context,s,target,args,env) {
  const controls = fileControls(s,target), cache = controls.cache;
  const imageCache = controls.image && target.cacheStatus === 'current' ? s.target.cache : new Map();
  const id = scope(s,target), choices = context.workspaceState.get(id,{});
  const last = previous_configure(context,s,target), owned = last.applied;
  const input = definitions(args), value = name => input.get(controls.name(name)) ?? cache.get(controls.name(name)) ??
    input.get(name) ?? cache.get(name) ?? imageCache.get(name) ?? env[name];
  const config = await application_context(target.app,value);
  let configure = args, error = '';
  const rows = {}, applied = {}, resets = {}, previous = {}, imageOrigins = {}, imageEdits = [], rootExpected = {};
  for (const kind of kinds) {
    const [name] = types[kind], choice = choices[kind];
    const control = controls.name(name);
    const root = kind === 'kconfig' ? config.root : target.app;
    const files = choice?.files?.map(file => path.resolve(target.app,file));
    const releasing = cache.has(control) && !files &&
      (cache.get(control) === owned[kind] || (choice?.reset && cache.get(control) === choice.releaseValue && cache.get(control) !== choice.initialValue));
    if (choice?.reset) resets[kind] = choice.reset;
    if (files) {
      rows[kind] = {files,source:'manual'};
      try {
        const selected = argument_value(files,kind,kind === 'kconfig' ? config.manualRoot : root);
        configure = assign(configure,control,selected);
        applied[kind] = selected;
        if (controls.image) {
          const prior=last.imageOrigins?.[kind], cached=imageCache.get(name);
          imageOrigins[kind]={...choice.imageOrigin,sticky:cached !== undefined && (cached===owned[kind] || cached===prior?.sticky) ? cached : undefined};
        }
        if (choice.previous !== undefined) previous[kind] = choice.previous;
      } catch (failure) {error ||= failure.message;}
      continue;
    }
    const origin = choice?.imageOrigin || last.imageOrigins?.[kind];
    const child = imageCache.get(name);
    if (origin && child !== undefined && child !== origin.restore &&
        (child === owned[kind] || child === choice?.releaseValue || child === origin.automatic || child === last.imageOrigins?.[kind]?.sticky))
      imageEdits.push({name,value:child,restore:origin.restore});
    let raw = input.get(control), source = 'argument';
    if (raw === undefined && releasing) {
      const restored = choice?.previous ?? last.previous[kind];
      if (controls.image) rootExpected[control] = cache.get(control);
      if (restored !== undefined) {raw = restored; source = 'configured';}
      // Remove only the cached primary variable. EXTRA_* inputs stay active.
      configure = assign(configure,control,restored);
    }
    if (raw === undefined && !releasing && cache.has(control)) {raw=cache.get(control);source='configured';}
    if (raw === undefined && controls.image) {
      raw=input.get(name) ?? cache.get(name) ?? (imageEdits.some(edit=>edit.name===name) ? origin?.restore : child);
      source = input.has(name) ? 'argument' : 'configured';
    }
    if (raw === undefined && env[name] !== undefined) {raw=env[name];source='environment';}
    if (raw !== undefined) {
      const unresolved = Boolean(raw && (!absolute(target.app,raw) || (!root && !path.isAbsolute(raw))));
      rows[kind] = {source,files:unresolved ? [] : listed_files(raw,kind,root || target.app),dynamic:unresolved};
    }
  }
  const changed = JSON.stringify(applied) !== JSON.stringify(owned) || Object.keys(resets).length ||
    (Object.keys(applied).length && last.id !== id);
  return {configure,rows,error,root:config.manualRoot,fileReset:changed ? {id,build:build_receipt(s,target),applied,previous,resets,imageOrigins,imageEdits,rootExpected} : undefined};
}

// Write the receipt for the command which completed. A later selection can already exist.
async function finish_configure(context,receipt) {
  if (!receipt?.id?.startsWith('configurationFiles:')) return;
  if (receipt.build) await context.workspaceState.update(receipt.build,{id:receipt.id,applied:receipt.applied,previous:receipt.previous,imageOrigins:receipt.imageOrigins});
  else await context.workspaceState.update(receipt.id + ':applied',receipt.applied);
  const choices = {...context.workspaceState.get(receipt.id,{})};
  for (const [kind,token] of Object.entries(receipt.resets)) {
    if (choices[kind]?.reset === token) delete choices[kind];
  }
  if (Object.keys(receipt.resets).length) await context.workspaceState.update(receipt.id,choices);
}

/** Generated fragments may be valid inputs. The active configure's own merge outputs cannot be. */
async function selects_merge_output(s,files) {
  const directories = [s.build.fsPath, s.target.buildDir?.fsPath, ...(s.target.system?.domains || []).map(image => image.dir)];
  const outputs = new Set();
  for (const directory of unique(directories.filter(Boolean))) {
    const root = await realpath(directory).catch(() => directory);
    for (const name of ['.config','.config.old','zephyr.dts','zephyr.dts.pre']) outputs.add(key(path.join(root,'zephyr',name)));
  }
  const selected = await Promise.all(files.map(file => realpath(file)));
  return selected.some(file => outputs.has(key(file)));
}

async function save_selection(context,s,kind,files) {
  if (!Object.hasOwn(types,kind) || !s.setup?.app || (!s.setup.board && !s.setup.projectBoard)) return false;
  const id = scope(s,s.setup), choices = {...context.workspaceState.get(id,{})};
  const [name] = types[kind], previous = choices[kind];
  if (files === null) {
    if (!previous || previous.reset) return false;
    const root = kind === 'kconfig' ? s.setup.fileConfigRoot : s.setup.app;
    const original = previous.files.map(file => path.resolve(s.setup.app,file));
    choices[kind] = {reset:require('node:crypto').randomUUID(),previous:previous.previous,initialValue:previous.initialValue,imageOrigin:previous.imageOrigin,
      releaseValue:previous.value ?? argument_value(original,kind,root)};
  } else {
    if (!Array.isArray(files) || !files.length || (kind === 'dts' && files.length !== 1)) return false;
    if (!files.every(file => typeof file === 'string' && path.isAbsolute(file))) return false;
    if (!(await Promise.all(files.map(exists))).every(Boolean)) return false;
    if (await selects_merge_output(s,files)) throw Error(l10n.t('This build rewrites the selected file. Select an input file or save a copy first.'));
    files = unique(files);
    const cfgRoot = Object.hasOwn(s.setup,'fileConfigRoot') ? s.setup.fileConfigRoot : s.setup.app;
    const value = argument_value(files,kind,kind === 'kconfig' ? cfgRoot : s.setup.app);
    const last = previous_configure(context,s,s.setup);
    const controls = fileControls(s,s.setup), control = controls.name(name);
    const owned = controls.cache.has(control) && controls.cache.get(control) === last.applied[kind];
    const initialValue = previous ? previous.initialValue : controls.cache.get(control);
    const managedByProject = s.target.system?.cacheTypes?.get(control) === 'INTERNAL' && !s.target.system.commandDefinitions?.includes(control);
    const restore = previous ? previous.previous : owned ? last.previous[kind] : managedByProject ? undefined :
      controls.image ? initialValue : await previous_cache_value(s,kind,name);
    const imageOrigin = controls.image && (previous?.imageOrigin || last.imageOrigins?.[kind] || {
      restore:await previous_cache_value(s,kind,name),automatic:s.setup.cacheStatus === 'current' ? s.target.cache.get(name) : undefined});
    choices[kind] = {files:files.map(file => path.relative(s.setup.app,file).split(path.sep).join('/')),previous:restore,value,initialValue,imageOrigin};
  }
  await context.workspaceState.update(id,choices);
  return true;
}

let writes = Promise.resolve();
function update(operation) {
  const result = writes.then(operation);
  writes = result.catch(() => {});
  return result;
}

function selectFiles(context,s,kind,files) {
  return update(() => save_selection(context,s,kind,files));
}

function acknowledgeFileReset(context,receipt) {
  return update(() => finish_configure(context,receipt));
}

function board_layout(s) {
  const layout = s.devicetree?.boardLayout;
  if (layout) return layout;
  const boardRecord = s.setup.cacheStatus === 'current' && s.target.configuredBoard;
  if (boardRecord?.name && typeof boardRecord.qualifiers === 'string')
    return {name:boardRecord.name,qualifier:boardRecord.qualifiers,revision:boardRecord.revision || '',singleSoc:true};
  const [board, ...parts] = (s.setup.board || '').split('/');
  if (!board || !parts.length || parts.some(part => !part)) return;
  const [name, revision = ''] = board.split('@');
  return {name,qualifier:parts.join('/'),revision,singleSoc:false};
}

async function previous_cache_value(s,kind,name) {
  if (s.setup.cacheStatus !== 'current' || !s.target.cache.has(name)) return;
  const cached = s.target.cache.get(name);
  if (s.target.commandDefinitions?.includes(name) || kind === 'dts') return cached;
  const config = await application_context(s.setup.app,k => k === 'SYSBUILD' && s.target.system ? undefined : s.target.cache.get(k) ?? s.environment?.[k]);
  const normal = await automatic_files(config,kind,board_layout(s));
  const actual = listed_files(cached,kind,(kind === 'kconfig' && config.root) || s.setup.app);
  if (normal.status === 'configure' || normal.files.length !== actual.length ||
      normal.files.some((file,i) => key(file) !== key(actual[i]))) return cached;
}

function recorded_files(s,kind) {
  const issues = s.setup.readiness?.build || [];
  if (s.setup.cacheStatus !== 'current' || issues.includes('configureFailed') || issues.includes('configureFirst')) return;
  if (kind === 'dts') {
    const tree = s.target.devicetree;
    return tree?.sourcesKnown && tree.base ? [tree.base.fsPath] : undefined;
  }
  return s.target.confirmedInputs?.[kind];
}

async function describeFiles(context,s,env) {
  if (!s.setup?.app) return {};
  const controls = fileControls(s,s.setup), cache = controls.cache;
  const args = definitions(s.setup.plan.configure);
  const value = name => args.get(controls.name(name)) ?? cache.get(controls.name(name)) ?? args.get(name) ?? cache.get(name) ??
    (controls.image && s.setup.cacheStatus==='current' ? s.target.cache.get(name) : undefined) ?? env[name];
  const config = await application_context(s.setup.app,value);
  const options = await candidates(config,s.build.fsPath), result = {};
  const tree = s.devicetree || {}, layout = board_layout(s);
  for (const kind of kinds) {
    const row = s.setup.fileRows?.[kind];
    const [variable] = types[kind];
    const control = controls.name(variable);
    let files = row?.files || [], status = 'resolved', source = row?.source || 'automatic';
    const confirmed = recorded_files(s,kind);
    const pending = s.setup.readiness?.build?.includes('reconfigure') || s.setup.plan.configure.includes('-U' + control) ||
      (args.has(control) && args.get(control) !== cache.get(control));
    if (confirmed && !pending && (!row || row.dynamic || row.source === 'configured')) {
      files = confirmed;
      source = row?.source || 'configured';
      status = files.length || kind === 'kconfig' ? 'resolved' : 'optional';
    } else if (!row && kind === 'dts') {
      const stale = tree.boardSource === 'configured' && pending;
      files = tree.boardFile && !stale ? [tree.boardFile] : [];
      if (tree.boardSource === 'configured' && !stale) source = 'configured';
      status = files.length ? 'resolved' : tree.detectionStatus === 'ambiguous' ? 'choose' : 'configure';
    } else if (!row) {
      ({files,status} = await automatic_files(config,kind,layout));
    } else if (row.dynamic || (pending && row.source === 'configured')) status = 'configure';
    else if (!files.length && kind === 'overlay') status = 'optional';
    const missing = [];
    for (const file of files) if (!await exists(file)) missing.push(file);
    const found = unique([...(kind === 'dts' ? tree.candidates || [] : []),...options[kind],...files.filter(f => !missing.includes(f))]);
    let suggestedFile;
    if (missing.length) status = 'missing';
    else if (!row && !files.length && kind === 'kconfig' && (status === 'missing' || status === 'configure')) {
      if (found.length === 1) suggestedFile = await sole_main_config(config);
      if (suggestedFile) status = 'suggested';
      else if (status === 'missing') status = found.length ? 'choose' : 'configure';
    }
    result[kind] = {variable,source,status,files,candidates:found.sort((a,b) => a.localeCompare(b)),missing};
    if (suggestedFile) result[kind].suggestedFile = suggestedFile;
    if (confirmed && (files.length !== confirmed.length || files.some((file,i) => key(file) !== key(confirmed[i]))))
      result[kind].confirmedFiles = confirmed;
  }
  return result;
}

module.exports = {filePlan,selectFiles,describeFiles,acknowledgeFileReset,prepareFileConfigure};
