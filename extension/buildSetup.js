'use strict';
const vscode = require('vscode');
const path = require('node:path');
const modules=require('./modules');
const {buildVariables, cacheSourceConflict, cacheStatus, parseDefinition} = require('./buildVariables');
const {build_parallelism, build_arguments, job_count} = require('./buildParallelism');
const {compiler_request, definition_matches, forget_changed_choices} = require('./compiler_selection');
const {includeFragment, fragmentPlan} = require('./buildFragments');
const {filePlan} = require('./configurationFiles');
const {buildMode, buildLayout} = require('./sysbuild');
const {listBoardChoices} = require('./boardPicker');
const {discoverApplications} = require('./applicationCatalog');
const {execFile} = require('node:child_process');
const fs = require('node:fs/promises');
const {promisify} = require('node:util');
const {hasFile} = require('./target');
const {pathKey, taskSearchPath} = require('./hostExecutables');
const {Uri,l10n} = vscode;
const execute = promisify(execFile);

function setting(folder, name) {return 'buildSetup.' + name + ':' + folder.uri.toString();}
function normal(file) {
  const resolved = path.resolve(file);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
function definitions(text,selectedBoard) {
  const args=[];
  for(const line of text.split(/\r?\n/)) {
    if(!line.trim())continue;
    const entry=parseDefinition('-D'+line.trimStart().replace(/^-D/,''));
    if(!entry)throw Error(l10n.t('Enter one CMake definition per line (NAME=value).'));
    if(entry.name==='BOARD' && selectedBoard) {
      if(entry.value!==selectedBoard)throw Error(l10n.t('To use the BOARD definition, select Use project settings in the board picker.'));
    } else args.push('-D'+entry.name+(entry.type?':'+entry.type:'')+'='+entry.value);
  }
  return args;
}
function argsKey(app){return 'buildSetup.arguments:'+normal(app);}
async function saveArguments(context,s,text) {
  if(typeof text!=='string')return;
  const parsed=definitions(text,s.setup.projectBoard ? undefined : s.setup.board);
  await context.workspaceState.update(argsKey(s.setup.app),text);
  await forget_changed_choices(context,s,parsed);
}
async function save_parallelism(context, s, value) {
  const limit = job_count(value);
  if (value !== '' && !limit) throw Error(l10n.t('Enter a positive whole number of build jobs.'));
  await context.workspaceState.update(setting(s.folder,'parallelJobs'), limit);
}

function plans(s, method, app, board, layout, parallelism) {
  const dir=s.build.fsPath, west=method==='west';
  const executable=west?s.tools.west:s.tools.cmake;
  const configure=west?['build','--cmake-only','-d',dir,app,...layout.westOptions]:['-S',layout.source,'-B',dir];
  if(board)configure.push(...(west?['-b',board]:['-DBOARD='+board]));
  if(!west && !s.target.cacheFile && !s.environment?.CMAKE_GENERATOR)configure.push('-G','Ninja');
  const definitions=[...layout.required,...layout.definitions];
  if(definitions.length)configure.push(...(west?['--']:[]),...definitions);
  return {executable,configure,build:build_arguments(method,dir,parallelism)};
}

function applicationInputs(context,s,app) {
  const argsText=context.workspaceState.get(argsKey(app),'');
  const args=argsText.split(/\r?\n/).map(line=>'-D'+line.trimStart().replace(/^-D/,''));
  const source=commandValue(args,'ZEPHYR_BASE') || s.environment.ZEPHYR_BASE ||
    context.workspaceState.get(setting(s.folder,'base')) || s.checkout;
  const sourceConflict=cacheSourceConflict(s.target,source && path.resolve(app,source));
  return {app,argsText,argumentBoard:commandValue(args,'BOARD'),sourceConflict};
}

function selectedTarget(context,s,westBoard) {
  const selectedApp=context.workspaceState.get(setting(s.folder,'app'),s.application);
  let inputs=applicationInputs(context,s,selectedApp || s.folder.uri.fsPath);
  if(!selectedApp && !inputs.sourceConflict && path.relative(inputs.app,s.target.app.fsPath)) {
    const fromCache=applicationInputs(context,s,s.target.app.fsPath);
    if(!fromCache.sourceConflict)inputs=fromCache;
  }
  const {app,argsText,argumentBoard,sourceConflict}=inputs;
  const choice=context.workspaceState.get(setting(s.folder,'board'));
  const cache=sourceConflict ? 'conflict' : cacheStatus(s.target,app,s.target.board,s.build.fsPath);
  const requested=choice || argumentBoard;
  const board=requested || (cache==='current' && s.target.board) || s.environment.BOARD || westBoard || '';
  const status=cache==='current' && requested && requested!==s.target.board?'conflict':cache;
  return {app,board,projectBoard:!choice,argsText,cacheStatus:status,sourceConflict};
}

// A Zephyr source checkout has a CMakeLists.txt, but it cannot be the application source.
async function isApplicationDirectory(app) {
  const file=name=>hasFile(Uri.file(path.join(app,name)));
  if(!await file('CMakeLists.txt'))return false;
  return !await file('share/zephyr-package/cmake/ZephyrConfig.cmake') || !await file('VERSION');
}

async function isExecutable(file) {
  try {
    await fs.access(file,fs.constants.X_OK);
    return (await fs.stat(file)).isFile();
  } catch {return false;}
}

async function usableTool(s,name) {
  if(!s.tools[name])return false;
  return !s.saved?.[name] || isExecutable(s.tools[name]);
}

async function readWestOption(context,s,name) {
  if(!vscode.workspace.isTrusted || !s.tools.west || !s.manifest.root || !s.manifest.uri || s.manifest.invalid)return;
  const options={cwd:s.manifest.root.fsPath,env:taskEnvironment(context,s),windowsHide:true,timeout:4000};
  try {return (await execute(s.tools.west,['config',name],options)).stdout.trim() || undefined;}
  catch {return undefined;}
}

function commandValue(extra,name) {
  for(let i=extra.length-1;i>=0;i--){
    const entry=parseDefinition(extra[i]);
    if(entry?.name===name)return entry.value;
  }
}

async function missingModuleDirectories(extra) {
  const paths=new Map();
  for(const key of ['ZEPHYR_MODULES','EXTRA_ZEPHYR_MODULES']){
    const list=commandValue(extra,key) || '';
    for(const item of list.match(/(?:\\;|[^;])+/g) || []){
      const location=item.replace(/\\;/g,';');
      if(path.isAbsolute(location) && !/\$<|\$(?:ENV|CACHE)?\{/.test(location))paths.set(normal(location),location);
    }
  }
  const checks=await Promise.all([...paths.values()].map(async location=>{
    try {return (await fs.stat(location)).isDirectory()?undefined:location;}
    catch(error){return ['ENOENT','ENOTDIR'].includes(error.code)?location:undefined;}
  }));
  return checks.filter(Boolean);
}

async function missingNinja(s,method,plan,extra,westGenerator,useCache) {
  const cache=useCache?s.target.cache:new Map();
  const generator=cache.get('CMAKE_GENERATOR') || (method==='west'?westGenerator:
    (plan.configure.includes('-G')?'Ninja':s.environment.CMAKE_GENERATOR));
  if(!/^Ninja(?: Multi-Config)?$/i.test(generator||''))return false;
  const requested=commandValue(extra,'CMAKE_MAKE_PROGRAM');
  const program=requested ?? cache.get('CMAKE_MAKE_PROGRAM');
  if(program && path.isAbsolute(program))return !await isExecutable(program);
  // A fresh configure may find ninja-build, samu, or a program supplied by a toolchain file.
  return requested===undefined && program?.endsWith('-NOTFOUND') && !await usableTool(s,'ninja');
}

function readinessResult(configure,build) {
  return {readiness:{configure,build},canConfigure:!configure.length,canBuild:!build.length};
}

function buildReadiness(s,method,{cmake,west,application,board,directory,ninja,error,pending,current,missingModules,compilerConflict,layoutIssue,sourceConflict}) {
  const issues=[];
  if(vscode.workspace.isTrusted===false)issues.push('trust');
  if(!cmake)issues.push('cmake');
  if(method==='west'){
    if(!west)issues.push('west');
    if(!s.manifest.root)issues.push('workspace');
    else if(s.manifest.invalid || !s.manifest.uri)issues.push('manifest');
  }
  if(!application)issues.push('application');
  if(!board)issues.push('board');
  if(!directory)issues.push('directory');
  if(sourceConflict)issues.push('sourceCheckout');
  if(compilerConflict)issues.push('compilerDirectory');
  if(error)issues.push('arguments');
  if(layoutIssue)issues.push(layoutIssue);
  if(ninja)issues.push('ninja');
  if(missingModules.length)issues.push('modules');
  const build=[...issues];
  if(!sourceConflict){
    if(!current || !s.target.generated)build.push('configureFirst');
    else if(pending)build.push('reconfigure');
  }
  return readinessResult(issues,build);
}

function overlay_discovery_key(s, app, board) {
  return 'studio.newOverlay:' + JSON.stringify([s.folder.uri.toString(), normal(app), board, normal(s.build.fsPath)]);
}

/** Zephyr caches a previously empty overlay list. A newly created default can be discovered on the next configure. */
function discover_new_overlay(s, env, extra, pending) {
  return Boolean(pending && s.target.cache.get('DTC_OVERLAY_FILE') === '' &&
    !s.target.commandDefinitions?.includes('DTC_OVERLAY_FILE') && !Object.hasOwn(env, 'DTC_OVERLAY_FILE') &&
    !extra.some(argument => parseDefinition(argument)?.name === 'DTC_OVERLAY_FILE'));
}

async function remember_new_overlay(context, s, input) {
  if (input?.creating && input.kind === 'device' && !path.relative(input.file, path.join(s.setup.app,'app.overlay')) &&
      s.setup.cacheStatus === 'current' && s.target.cache.get('DTC_OVERLAY_FILE') === '') {
    await context.workspaceState.update(overlay_discovery_key(s,s.setup.app,s.setup.board), true);
  }
}

async function describe(context,s,method) {
  if(!s.folder)return readinessResult(['folder'],['folder']);
  const westMode=method==='west';
  let target=selectedTarget(context,s);
  if(westMode && !target.board)target=selectedTarget(context,s,await readWestOption(context,s,'build.board'));
  const {app,board,projectBoard,argsText,cacheStatus:status}=target;
  const conflict=status==='conflict';
  let extra=[],error='';
  try {extra=definitions(argsText,projectBoard ? undefined : board);} catch(e) {error=e.message;}
  const compiler=compiler_request(context,s,target,extra);
  extra=compiler.args;
  const record=modules.selectedState(context,{...s,setup:{app}},method);
  const paths=modules.entries(s,record).filter(e=>record.selected.includes(e.name)&&(method==='CMake'||e.kind!=='workspace'))
    .map(e=>path.resolve(modules.rootOf(s),e.path||e.name));
  const flag=method==='west'?'EXTRA_ZEPHYR_MODULES':'ZEPHYR_MODULES';
  if(paths.length&&!extra.some(v=>v.split('=')[0].split(':')[0]==='-D'+flag))extra.push('-D'+flag+'='+paths.join(';'));
  const env = taskEnvironment(context,s);
  const mode=await buildMode({target:s.target,method,preference:context.workspaceState.get(systemKey(s,app)),
    westDefault:()=>readWestOption(context,s,'build.sysbuild')});
  const files = await filePlan(context,s,{...target,system:mode.enabled},extra,env);
  extra = files.configure;
  error ||= files.error;
  let includedFragments = [];
  try {
    const fragments = fragmentPlan(context,s,target,extra,env);
    extra = fragments.configure;
    includedFragments = fragments.includedFragments;
  } catch (e) { error ||= e.message; }
  const overlayKey = overlay_discovery_key(s,app,board);
  const refreshOverlay = status === 'current' && discover_new_overlay(s,env,extra,context.workspaceState.get(overlayKey));
  const parallelism=build_parallelism(context.workspaceState.get(setting(s.folder,'parallelJobs')),env);
  if(refreshOverlay)extra=[...extra,'-UDTC_OVERLAY_FILE'];
  const layout=buildLayout(mode,{target:s.target,app,cwd:(s.manifest.root || s.folder.uri).fsPath,
    base:env.ZEPHYR_BASE || s.target.zephyrBase},extra);
  if(layout.appConflict)error ||= l10n.t('APP_DIR differs from the selected application. Select the matching application or remove the APP_DIR definition.');
  const plan=plans(s,method,app,projectBoard ? undefined : board,layout,parallelism);
  const configurationCache=s.target.system?.cache || s.target.cache;
  const pending=refreshOverlay || Boolean(files.fileReset?.imageEdits?.length) || layout.definitions.some(arg=>{
    return arg.startsWith('-U') ? configurationCache.has(arg.slice(2)) : !definition_matches(configurationCache,parseDefinition(arg));
  });
  const [cmake,west,appExists,westGenerator,missingModules]=await Promise.all([
    usableTool(s,'cmake'),westMode && usableTool(s,'west'),isApplicationDirectory(app),
    westMode && readWestOption(context,s,'build.generator'),missingModuleDirectories(extra)
  ]);
  const ambiguous=s.locations?.groups.some(g=>g.key==='application'&&!g.selected);
  const current=status==='current', directory=(!conflict || target.sourceConflict) && normal(app)!==normal(s.build.fsPath);
  const ninja=await missingNinja(s,method,plan,extra,westGenerator,current);
  const readiness=buildReadiness(s,method,{cmake,west,board:board || projectBoard,directory,ninja,error,pending,current,missingModules,compilerConflict:compiler.conflict,layoutIssue:layout.issue,sourceConflict:target.sourceConflict,application:appExists&&!ambiguous});
  if (parallelism.invalidEnvironment && !parallelism.custom) {
    readiness.readiness.build.push('parallelJobs');
    readiness.canBuild=false;
  }
  return {app,board,projectBoard,system:layout.enabled,cacheStatus:status,conflict,plan,parallelism,argsText,error,westGenerator,missingModules,includedFragments,
    overlayDiscovery:refreshOverlay ? overlayKey : undefined,fileRows:files.rows,fileReset:files.fileReset,fileConfigRoot:files.root,...readiness};
}

function systemKey(s,app) {
  return 'buildSetup.sysbuild:'+JSON.stringify([s.folder.uri.toString(),normal(app),normal(s.build.fsPath)]);
}

function saveSystem(context,s,enabled) {
  if (!s.target.cacheFile && typeof enabled==='boolean') return context.workspaceState.update(systemKey(s,s.setup.app),enabled);
}

function applyLastConfigureResult(setup,failure){
  if(failure?.action!=='configure')return;
  const pending=setup.readiness.build.filter(code=>code!=='configureFirst' && code!=='reconfigure');
  setup.readiness.build=[...pending,'configureFailed'];
  setup.canBuild=false;
}

async function listApplications(s){
  const base=s.environment.ZEPHYR_BASE||s.target.zephyrBase;
  const roots=[s.folder.uri.fsPath,base,s.setup.app];
  const dirs=new Set(await discoverApplications(roots,base && path.resolve(base)));
  if(await isApplicationDirectory(s.setup.app))dirs.add(s.setup.app);
  return [...dirs].sort();
}
async function choices(context,s,method,kind){
  if(kind==='board')return (await boardChoicesResult(context,s,method)).items;
  if(kind==='app')return listApplications(s);
  const caches=await vscode.workspace.findFiles(new vscode.RelativePattern(s.folder,'**/CMakeCache.txt'),'**/{.git,.venv,node_modules}/**');
  return [...new Set([s.build.fsPath,path.join(s.setup.app,'build'),...caches.map(uri=>path.dirname(uri.fsPath))])];
}
async function applyChoice(context,s,kind,value){
  if(kind==='app'&&!await hasFile(Uri.file(path.join(value,'CMakeLists.txt'))))throw Error(l10n.t('The application needs a CMakeLists.txt.'));
  if(kind==='build')return context.workspaceState.update('build:'+s.folder.uri.toString(),Uri.file(value).toString());
  await context.workspaceState.update(setting(s.folder,kind),value);
}

function buildEnv(s) {
  const env={...(s.environment||process.env)};
  const key = pathKey(env);
  const explicit = Object.entries(s.saved || {}).filter(([name, file]) =>
    Object.hasOwn(s.tools || {}, name) && path.isAbsolute(file)).map(([,file]) => path.dirname(file));
  const detected = Object.values(s.tools || {}).filter(file => file && path.isAbsolute(file)).map(file => path.dirname(file));
  // Make discovered helpers available to CMake and west even when the editor started outside a shell.
  const localPython = [s.tools?.python, s.tools?.west].filter(file =>
    file && path.isAbsolute(file) && path.basename(path.dirname(path.dirname(file))) === '.venv').map(file => path.dirname(file));
  env[key] = taskSearchPath(env, [...explicit, ...localPython, ...(s.toolDirectories || [])], detected);
  return env;
}

async function boardChoicesResult(context,s,method) {
  try { return await listBoardChoices(s,taskEnvironment(context,s),method); }
  catch(error) {
    if(error.message==='ZEPHYR_BASE')throw Error(l10n.t('Locate Zephyr source (ZEPHYR_BASE)'));
    throw error;
  }
}

function taskEnvironment(context,s) {
  const env=buildEnv(s),base=context.workspaceState.get(setting(s.folder,'base'));
  if(!env.ZEPHYR_BASE && base)env.ZEPHYR_BASE=base;
  return env;
}
function variables(context,s,method) {
  return buildVariables(s,method,taskEnvironment(context,s),s.setup.westGenerator);
}
module.exports={discover_new_overlay,remember_new_overlay,includeFragment,describe,applyLastConfigureResult,selectedTarget,boardChoicesResult,choices,applyChoice,buildEnv,taskEnvironment,saveArguments,save_parallelism,saveSystem,variables};
