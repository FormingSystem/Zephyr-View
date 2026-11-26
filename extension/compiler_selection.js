'use strict';

const path = require('node:path');
const vscode = require('vscode');
const {parseDefinition} = require('./buildVariables');
const {hasCurrentBuild} = require('./target');
const {registered_sdk} = require('./sdkRegistry');
const {board_facts,sdk_directory,sdk_catalog,cross_catalog,cross_prefix,executable} = require('./compiler_catalog');

const variant_key = 'ZEPHYR_TOOLCHAIN_VARIANT';
const prefix_key = 'CROSS_COMPILE';
const family_key = 'TOOLCHAIN_VARIANT_COMPILER';
const compiler_key = 'CMAKE_C_COMPILER';
const same_file = (left,right) => Boolean(left && right && !path.relative(left,right));
const cmake_prefix = value => process.platform==='win32' && typeof value==='string' ? value.replaceAll('\\','/') : value;
const key = (s,target) => 'compiler.v1:'+JSON.stringify([s.folder.uri.toString(),path.normalize(target.app),target.board]);
const scope = s => JSON.stringify([key(s,s.setup),s.build.fsPath]);
const compiler_inputs = new Set([variant_key,prefix_key,family_key,compiler_key,
  'CMAKE_CXX_COMPILER','CMAKE_ASM_COMPILER','CMAKE_TOOLCHAIN_FILE']);

function compiler_definitions(args) {
  return new Map(args.map(parseDefinition).filter(Boolean).map(entry=>[entry.name,entry.value]));
}

function manual_args(text) {
  return (text || '').split(/\r?\n/).filter(line=>line.trim()).map(line=>'-D'+line.trimStart().replace(/^-D/,''));
}

/** Only the active board's qualified prefix may be replaced; unrelated board declarations pass through. */
function project_compiler_inputs(args,target) {
  const identifier=(target || '').replace(/@[^/]*/,'');
  const normalized=(identifier.includes('/') ? identifier : identifier+'/').replaceAll('/','_');
  const scoped=prefix_key+'_'+normalized;
  const retained=[],replaced=[];
  for (const arg of args) {
    const entry=parseDefinition(arg);
    if (entry && (compiler_inputs.has(entry.name) || entry.name===scoped)) replaced.push(arg);
    else retained.push(arg);
  }
  return {retained,replaced};
}

function signature(inputs) {
  return JSON.stringify(inputs.map(arg=>{
    const {name,type,value}=parseDefinition(arg);
    return [name,type || '',value];
  }));
}

function effective_choice(record,inputs) {
  return record?.variant && (record.signature || '[]')===signature(inputs) ? record : undefined;
}

/** A later edit to compiler inputs gives that application back to its manual definitions. */
async function forget_changed_choices(context,s,args) {
  const prefix='compiler.v1:'+JSON.stringify([s.folder.uri.toString(),path.normalize(s.setup.app)]).slice(0,-1)+',';
  const keys=context.workspaceState.keys?.() || [key(s,s.setup)];
  const updates=[];
  for(const name of keys.filter(candidate=>candidate.startsWith(prefix))){
    const record=context.workspaceState.get(name);
    if(!record?.variant)continue;
    const board=record.target || JSON.parse(name.slice('compiler.v1:'.length))[2];
    const {replaced}=project_compiler_inputs(args,board);
    if(!effective_choice(record,replaced))updates.push(context.workspaceState.update(name,undefined));
  }
  await Promise.all(updates);
}

function mode(variant) {
  if (/^zephyr(?:\/|$)/.test(variant)) return 'sdk';
  return variant === 'cross-compile' ? 'cross' : 'other';
}

function variant_matches(cache, value) {
  const [variant,family]=value.split('/');
  return cache.get(variant_key)===variant && (!family || cache.get(family_key)===family);
}

function matches_selection(cache, choice, environment={}) {
  if (!variant_matches(cache,choice.variant)) return false;
  const actual = cache.get(compiler_key);
  if (choice.prefix) return actual ? same_file(cross_prefix(actual),choice.prefix) : same_file(cache.get(prefix_key),choice.prefix);
  if (!choice.path || !actual) return true;
  const hint=environment.ZEPHYR_SDK_INSTALL_DIR || '';
  if (hint && choice.sdk_hint!==undefined && !same_file(hint,choice.sdk_hint)) {
    const relative=path.relative(hint,actual);
    return !path.isAbsolute(relative) && relative!=='..' && !relative.startsWith('..'+path.sep);
  }
  return same_file(actual,choice.path);
}

/** Add official CMake inputs to both build modes. A previously generated compiler cannot be changed in-place. */
function compiler_request(context,s,target,args) {
  const record=context.workspaceState.get(key(s,target));
  const {retained,replaced}=project_compiler_inputs(args,record?.target || target.board);
  const choice=effective_choice(record,replaced);
  const defs=compiler_definitions(args);
  const explicit=replaced[0]?.slice(2);
  const cache=s.target.cache;
  const cached=target.cacheStatus==='current' && s.target.generated && cache.get(compiler_key);
  if (!choice && (!record?.reset_build || explicit)) {
    const variant=defs.get(variant_key) || s.saved?.[variant_key] || s.environment?.[variant_key];
    const prefix=defs.get(prefix_key) || s.saved?.[prefix_key] || s.environment?.[prefix_key];
    const cc=defs.get(compiler_key);
    const toolchain=defs.get('CMAKE_TOOLCHAIN_FILE');
    const changed=(variant && !variant_matches(cache,variant)) ||
      (defs.has(family_key) && cache.get(family_key)!==defs.get(family_key)) ||
      (toolchain && cache.get('CMAKE_TOOLCHAIN_FILE')!==toolchain) ||
      (cc && path.isAbsolute(cc) && !same_file(cc,cached)) ||
      (variant==='cross-compile' && prefix && path.isAbsolute(prefix) && !same_file(prefix,cross_prefix(cached || '')));
    return {args,explicit,conflict:Boolean(cached && changed)};
  }
  if (record.reset_build) {
    const conflict=cached && same_file(s.build.fsPath,record.reset_build) && matches_selection(s.target.cache,record.previous,s.environment);
    return {args,conflict:Boolean(conflict)};
  }
  const additions=['-D'+variant_key+'='+record.variant];
  if(record.prefix)additions.push('-D'+prefix_key+'='+cmake_prefix(record.prefix));
  const stale_files=record.previous_files && same_file(s.build.fsPath,record.previous_files.build) &&
    record.previous_files.inputs.some(([name,value])=>cache.get(name)===value);
  const conflict=cached && (stale_files || !matches_selection(s.target.cache,record,s.environment));
  return {args:[...additions,...retained],conflict:Boolean(conflict)};
}

/** Zephyr stores zephyr/gnu as two cache fields, and CMake normalizes paths on Windows. */
function definition_matches(cache,entry) {
  if(entry.name===variant_key)return variant_matches(cache,entry.value);
  if(entry.name===prefix_key && path.isAbsolute(entry.value))return same_file(cache.get(prefix_key),entry.value);
  return cache.get(entry.name)===entry.value;
}

function default_variant(s, cache) {
  const requested=s.environment[variant_key];
  const cached=cache?.get(variant_key), family=cache?.get(family_key);
  if ((!requested || requested==='zephyr') && cached==='zephyr' && family && family!=='default')
    return 'zephyr/'+family;
  return requested || cached || 'zephyr';
}

function recommendation(options, variant, configured, env_prefix) {
  if(mode(variant)==='sdk')return options.find(row=>row.source==='sdk' && row.family===(variant.split('/')[1] || 'gnu'))?.id;
  if(mode(variant)==='cross'){
    const known=options.find(row=>row.prefix && (same_file(row.prefix,env_prefix) || same_file(row.path,configured)));
    const matching=options.filter(row=>row.prefix && row.compatibility==='architecture');
    return known?.id || (matching.length===1 ? matching[0].id : undefined);
  }
}

async function compiler_choices(context,s) {
  if(!s?.folder || !s.setup?.app || !s.build)return {mode:'other',reason:'selectBoard',options:[]};
  const env=s.environment || process.env;
  const cache=hasCurrentBuild(s) ? s.target.cache : undefined;
  const record=context.workspaceState.get(key(s,s.setup));
  const facts=vscode.workspace.isTrusted && s.setup.board ? await board_facts(s,env) : {};
  const target=facts.target || record?.target || s.setup.board;
  const args=manual_args(s.setup.argsText);
  const {replaced}=project_compiler_inputs(args,target);
  const saved=effective_choice(record,replaced);
  const defs=compiler_definitions(args);
  const requestedDefinitions=replaced.map(arg=>arg.slice(2)), requested=requestedDefinitions[0];
  const resetting=record?.reset_build && same_file(record.reset_build,s.build.fsPath);
  const variant=saved?.variant || defs.get(variant_key) || default_variant(s,resetting?undefined:cache);
  const result={scope:scope(s),target,mode:mode(variant),variant,requested,requestedDefinitions,overridden:Boolean(saved),options:[]};
  const actual=cache?.get(compiler_key);
  if(actual && !actual.endsWith('-NOTFOUND'))result.configured=actual;
  if(!vscode.workspace.isTrusted)return {...result,reason:'trust'};
  if(!s.setup.board)return {...result,reason:'selectBoard'};
  const base=defs.get('ZEPHYR_BASE') || env.ZEPHYR_BASE || cache?.get('ZEPHYR_BASE');
  const hint=defs.get('ZEPHYR_SDK_INSTALL_DIR') || env.ZEPHYR_SDK_INSTALL_DIR || cache?.get('ZEPHYR_SDK_INSTALL_DIR');
  let sdk=await sdk_directory(hint && path.resolve(s.setup.app,hint),cache?.get('Zephyr-sdk_DIR'));
  if (!sdk && !hint) sdk=await sdk_directory(await registered_sdk(base,s.tools?.cmake,env));
  const {options,triplet,reason:sdk_reason}=await sdk_catalog(sdk,base,facts);
  const prefix=saved?.prefix || env[prefix_key] || cache?.get(prefix_key);
  const external=await cross_catalog(s,env,prefix,sdk,triplet,facts);
  const choices=[...options,...external].map(row=>({...row,selected:row.id===saved?.id,
    compatibility:same_file(row.path,result.configured)?'configured':row.compatibility,
    setting:variant_key+'='+row.variant+(row.prefix?' · '+prefix_key+'='+cmake_prefix(row.prefix):'')}));
  const reason=requested && !saved?'explicit':!facts.arch?'architecture':result.mode==='sdk' && !sdk?'sdk':
    result.mode==='sdk' && sdk_reason?sdk_reason:!choices.length?'unavailable':undefined;
  return {...result,reason,architecture:facts.arch,architecture_source:facts.source,triplet,options:choices,
    recommendedId:requested && !saved?undefined:recommendation(choices,variant,result.configured,prefix)};
}

function can_save(s, requested_scope, still_current) {
  return Boolean(s?.folder && s.setup?.app && s.setup.board && s.build && vscode.workspace.isTrusted &&
    scope(s)===requested_scope && (!still_current || still_current()));
}

function save_choice(context,s,row,catalog) {
  const inputs=project_compiler_inputs(manual_args(s.setup.argsText),catalog.target).replaced;
  const record={id:row.id,variant:row.variant,prefix:row.prefix,path:row.path,target:catalog.target,signature:signature(inputs)};
  if(row.source==='sdk')record.sdk_hint=s.environment.ZEPHYR_SDK_INSTALL_DIR || '';
  if (catalog.configured) {
    const compiler_files=new Set(['CMAKE_TOOLCHAIN_FILE','CMAKE_CXX_COMPILER','CMAKE_ASM_COMPILER']);
    if (!same_file(catalog.configured,row.path))compiler_files.add(compiler_key);
    const previous=[...compiler_definitions(inputs)].filter(([name,value])=>compiler_files.has(name) &&
      s.target.cache.get(name)!==undefined && (same_file(value,s.target.cache.get(name)) || value===s.target.cache.get(name)));
    if(previous.length)record.previous_files={build:s.build.fsPath,inputs:previous.map(([name])=>[name,s.target.cache.get(name)])};
  }
  return context.workspaceState.update(key(s,s.setup),record);
}

async function select_compiler(context,s,id,requested_scope,still_current) {
  if(!can_save(s,requested_scope,still_current))return false;
  const catalog=await compiler_choices(context,s);
  if(!can_save(s,requested_scope,still_current))return false;
  if(id==='auto'){
    const old=context.workspaceState.get(key(s,s.setup));
    if(!old?.variant)return true;
    const inherited=default_variant(s,undefined);
    const default_match=old && (old.variant===inherited || (inherited==='zephyr' && old.variant==='zephyr/gnu')) &&
      (!old.prefix || same_file(old.prefix,s.environment[prefix_key]));
    const reset=old?.variant && !default_match && catalog.configured && matches_selection(s.target.cache,old,s.environment);
    await context.workspaceState.update(key(s,s.setup),reset?{reset_build:s.build.fsPath,previous:old}:undefined);
    return true;
  }
  const row=catalog.options.find(option=>option.id===id);
  if(!row)return false;
  await save_choice(context,s,row,catalog);
  return true;
}

async function pick_cross_compiler(s,typed) {
  let file;
  if(typed){
    const value=await vscode.window.showInputBox({title:'CROSS_COMPILE',prompt:vscode.l10n.t('Enter a GCC tool prefix ending in a dash.')});
    if(!value?.trim())return false;
    const input=value.trim();
    const paths=[s.folder.uri.fsPath];
    if(input===path.basename(input)){
      const env=s.environment || process.env;
      const path_key=Object.keys(env).find(name=>name.toUpperCase()==='PATH');
      paths.push(...(env[path_key]||'').split(path.delimiter).filter(path.isAbsolute));
    }
    for(const dir of paths){
      file=path.resolve(dir,input)+(process.platform==='win32'?'gcc.exe':'gcc');
      if(await executable(file))break;
    }
  }else{
    const picked=await require('./fileDialogs').pickFile({title:vscode.l10n.t('Select the cross GCC executable'),defaultUri:s.folder.uri});
    if(!picked || picked.scheme!=='file')return false;
    file=picked.fsPath;
  }
  const prefix=cross_prefix(file);
  if(!prefix || !await executable(file))throw Error(vscode.l10n.t('Select an executable with a GCC tool prefix ending in a dash.'));
  return {id:'cross:'+path.normalize(file),path:file,variant:'cross-compile',prefix};
}

async function choose_external_compiler(context,s,requested_scope,typed,still_current) {
  if(!can_save(s,requested_scope,still_current))return false;
  const catalog=await compiler_choices(context,s);
  if(!can_save(s,requested_scope,still_current))return false;
  const selected=await pick_cross_compiler(s,typed);
  if(!selected)return false;
  if(!can_save(s,requested_scope,still_current))return false;
  await save_choice(context,s,selected,catalog);
  return true;
}

module.exports={compiler_choices,select_compiler,choose_external_compiler,pick_cross_compiler,compiler_request,definition_matches,cmake_prefix,forget_changed_choices};
