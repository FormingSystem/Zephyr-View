'use strict';
const vscode=require('vscode');
const path=require('node:path');
const fs=require('node:fs/promises');
const {hostEnvironment}=require('./environmentValues');
const {compiler_choices,select_compiler,choose_external_compiler,pick_cross_compiler,cmake_prefix}=require('./compiler_selection');
const {board_roots, distinct_roots, selected_root} = require('./boardRoots');
const variables=['ZEPHYR_BASE','ZEPHYR_TOOLCHAIN_VARIANT','ZEPHYR_SDK_INSTALL_DIR','CROSS_COMPILE','BOARD_ROOT'];
const programs=['cmake','ninja','git','west','python','dtc','gperf','wget',...(process.platform==='win32'?['7z']:[])];
const key=folder=>'environment.v1:'+folder.uri.toString();
const overrides=(context,folder)=>folder?context.workspaceState.get(key(folder),{}):{};
function resolve(context,s){
  const saved=overrides(context,s.folder);
  const environment=hostEnvironment(process.env),environmentOrigins={};
  for(const name of variables)if(saved[name]){
    environment[name]=saved[name];
    environmentOrigins[name]='override';
  }
  if(environment.CROSS_COMPILE)environment.CROSS_COMPILE=cmake_prefix(environment.CROSS_COMPILE);
  if (s.folder && saved.BOARD_ROOT) {
    const inherited = hostEnvironment(process.env).BOARD_ROOT;
    environment.BOARD_ROOT = distinct_roots([...board_roots(saved.BOARD_ROOT), ...board_roots(inherited)], s.folder.uri.fsPath).join(';');
  }
  if(s.folder&&!environment.ZEPHYR_BASE){
    const base=context.workspaceState.get('buildSetup.base:'+s.folder.uri.toString());
    if(base){
      environment.ZEPHYR_BASE=base;
      environmentOrigins.ZEPHYR_BASE='override';
    }
  }
  for(const name of programs)if(saved[name])s.tools[name]=saved[name];
  return {environment,saved,environmentOrigins};
}
async function variants(s){
  const choices=new Set(['zephyr','cross-compile']);
  const base=s.environment.ZEPHYR_BASE||s.target?.zephyrBase;
  if(base){
    const dirs=await fs.readdir(path.join(base,'cmake','toolchain'),{withFileTypes:true}).catch(()=>[]);
    for(const d of dirs)if(d.isDirectory())choices.add(d.name);
  }
  return [...choices].sort();
}
async function change_board_roots(context, s, {reset, remove, typed}, still_current) {
  if (!s.folder || !vscode.workspace.isTrusted || !still_current()) return;
  let added;
  if (!reset && remove === undefined) {
    const {inputDirectory, pickDirectory} = require('./fileDialogs');
    const options = {title:vscode.l10n.t('Add a board search root'), defaultUri:s.folder.uri, baseUri:s.folder.uri};
    const selected = typed ? await inputDirectory(options) : await pickDirectory({title:options.title, defaultUri:options.defaultUri});
    if (!selected) return;
    added = await selected_root(selected.fsPath);
    if (!added) throw Error(vscode.l10n.t('Choose a directory containing boards/ (or the boards directory itself).'));
  }
  if (!still_current()) return;
  const saved = {...overrides(context,s.folder)};
  let roots = board_roots(saved.BOARD_ROOT);
  if (reset) roots = [];
  else if (added) roots = distinct_roots([...roots, added], s.folder.uri.fsPath);
  else if (roots.includes(remove)) roots = roots.filter(root => root !== remove);
  else return;
  if (roots.length) saved.BOARD_ROOT = roots.join(';');
  else delete saved.BOARD_ROOT;
  await context.workspaceState.update(key(s.folder), saved);
}

async function configure(context,s,name,reset,variant,typed,still_current = () => true){
  if(!s.folder||!vscode.workspace.isTrusted||![...variables,...programs].includes(name))return;
  if (name === 'BOARD_ROOT') return change_board_roots(context,s,{reset,typed},still_current);
  const saved={...overrides(context,s.folder)};
  if(reset)delete saved[name];
  else if(name==='ZEPHYR_TOOLCHAIN_VARIANT'){
    if(!(await variants(s)).includes(variant)){
      if(!/^zephyr\/(gnu|llvm)$/.test(variant))return;
      const catalog=await compiler_choices(context,s);
      if(!catalog.options.some(option=>option.variant===variant))return;
    }
    saved[name]=variant;
  }else if(name==='CROSS_COMPILE'){
    const selected=await pick_cross_compiler(s,typed);
    if(!selected)return;
    saved[name]=selected.prefix;
  }else{
    const program=programs.includes(name);
    const {pickFile,pickDirectory,inputDirectory}=require('./fileDialogs');
    const current=saved[name]||s.environment[name]||s.tools[name];
    const defaultUri=current?vscode.Uri.file(current):s.folder.uri;
    const uri=program?await pickFile({title:name,defaultUri}):typed?
      await inputDirectory({title:name,baseUri:s.folder.uri,defaultUri}):await pickDirectory({title:name,defaultUri});
    if(!uri)return;
    if(program)await fs.access(uri.fsPath,fs.constants.X_OK);
    saved[name]=path.normalize(uri.fsPath);
  }
  if(!still_current())return;
  await context.workspaceState.update(key(s.folder),saved);
}
async function useInstalled(context,folder,patch) {
  const saved={...overrides(context,folder)};
  for(const name of [...programs,'ZEPHYR_BASE','ZEPHYR_SDK_INSTALL_DIR']){
    if(patch[name])saved[name]=path.normalize(patch[name]);
  }
  await context.workspaceState.update(key(folder),saved);
}
module.exports={variables,programs,overrides,resolve,configure,variants,change_board_roots,compiler_choices,select_compiler,choose_external_compiler,useInstalled};
