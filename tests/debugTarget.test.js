'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');

function uri(file) {
  const fsPath = path.normalize(file);
  return {scheme:'file',fsPath,path:fsPath.split(path.sep).join('/'),toString:() => fsPath};
}

class Emitter {
  constructor() {
    this.handlers = [];
    this.event = callback => { this.handlers.push(callback); return {dispose() {}}; };
  }
  fire(value) { this.handlers.forEach(callback => callback(value)); }
}

const editorChanged = new Emitter(), sessionChanged = new Emitter();
const commands = new Map(), launches = [];
const ignore = () => ({dispose() {}});
const vscode = {
  EventEmitter:Emitter, TreeItem:class {constructor(label){this.label=label;}}, ThemeIcon:class {},
  Uri:{file:uri, parse:uri, joinPath:(base,...parts)=>uri(path.join(base.fsPath,...parts))},
  FileType:{File:1,Directory:2}, l10n:{t:(text,...args)=>text.replace(/\{(\d+)\}/g,(_,index)=>args[index])},
  commands:{registerCommand:(id,run)=>commands.set(id,run),executeCommand:async()=>{}},
  window:{onDidChangeActiveTextEditor:editorChanged.event,registerTreeDataProvider:ignore,registerCustomEditorProvider:ignore},
  debug:{onDidChangeActiveDebugSession:sessionChanged.event,onDidStartDebugSession:ignore,onDidTerminateDebugSession:ignore,
    startDebugging:(folder,name)=>launches.push([folder.name,name])},
  workspace:{
    getWorkspaceFolder(file) {
      return this.workspaceFolders.find(folder => file.fsPath.startsWith(folder.uri.fsPath+path.sep));
    },
    getConfiguration(section,folder) {
      return {get:(name,otherwise)=>section==='launch' && name==='configurations'
        ? [{type:'cortex-debug',request:'launch',name:'launch '+path.basename(folder.fsPath)}] : otherwise};
    },
    asRelativePath:file=>file.fsPath, onDidChangeWorkspaceFolders:ignore,
    createFileSystemWatcher:()=>({onDidCreate:ignore,onDidChange:ignore,onDidDelete:ignore}),
    fs:{
      async readFile(file) {
        try {return await fs.readFile(file.fsPath);}
        catch(error) {if(error.code==='ENOENT')error.code='FileNotFound';throw error;}
      },
      async stat(file) {
        const stat=await fs.stat(file.fsPath);
        return {type:stat.isFile()?1:2,mtime:stat.mtimeMs};
      }
    }
  }
};

let activate;
const loader=Module._load;
try {
  Module._load=function(name,parent,...rest) {
    if(name==='vscode')return vscode;
    if(name==='./workbench' && parent.filename===require.resolve('../extension/extension'))return {registerWorkbench(){}};
    return loader.call(this,name,parent,...rest);
  };
  ({activate}=require('../extension/extension'));
} finally {Module._load=loader;}

async function makeFolder(root,name) {
  const directory=path.join(root,name),build=path.join(directory,'build');
  await fs.mkdir(path.join(build,'zephyr'),{recursive:true});
  await Promise.all([
    fs.writeFile(path.join(directory,'prj.conf'),''),
    fs.writeFile(path.join(build,'CMakeCache.txt'),['APPLICATION_SOURCE_DIR:PATH='+directory,
      'CACHED_BOARD:STRING=board_'+name,'CMAKE_GENERATOR:INTERNAL=Ninja','CMAKE_CACHEFILE_DIR:INTERNAL='+build].join('\n')),
    fs.writeFile(path.join(build,'build.ninja'),''),
    fs.writeFile(path.join(build,'zephyr','runners.yaml'),'debug-runner: runner_'+name)
  ]);
  return {uri:uri(directory),name};
}

async function setup(t) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'zephyr-workspace-roots-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const [a,b]=await Promise.all(['A','B'].map(name=>makeFolder(directory,name)));
  vscode.workspace.workspaceFolders=[a,b];
  vscode.window.activeTextEditor=undefined;
  vscode.debug.activeDebugSession=undefined;
  launches.length=0;
  editorChanged.handlers.length=sessionChanged.handlers.length=0;
  const saved=new Map();
  const state={get:(key,fallback)=>saved.has(key)?saved.get(key):fallback,update:(key,value)=>saved.set(key,value)};
  const {target}=activate({subscriptions:[],workspaceState:state,extensionUri:uri(directory)});
  const row=async name=>(await target.getChildren()).find(item=>item.label===name);
  const edit=folder=>editorChanged.fire(folder && {document:{uri:uri(path.join(folder.uri.fsPath,'main.c'))}});
  const debug=session=>{vscode.debug.activeDebugSession=session;sessionChanged.fire(session);};
  return {a,b,target,row,edit,debug,saved,directory};
}

test('an editor, explicit root selection, and scoped debug sessions own the target across focus changes',async t=>{
  const {a,b,row,edit,debug,directory}=await setup(t);
  assert.equal((await row('Application')).description,'Current directory');
  assert.equal((await row('Refresh debug target')).command.command,'zephyrWorkbench.refresh');
  edit(b);
  edit(undefined);
  edit({uri:uri(path.join(directory,'outside'))});
  assert.equal((await row('Workspace folder')).description,'B');
  assert.equal((await row('Debug runner')).description,'runner_B');
  vscode.window.showWorkspaceFolderPick=async()=>a;
  await commands.get((await row('Workspace folder')).command.command)();
  assert.equal((await row('Workspace folder')).description,'A');
  const executable=path.join(b.uri.fsPath,'build','zephyr','zephyr.elf');
  debug({name:'B session',configuration:{executable},workspaceFolder:b});
  assert.equal((await row('Debug session')).description,'B session');
  edit(a);
  assert.equal((await row('Debug session')).description,'Idle');
  assert.equal((await row('Build directory')).description,a.uri.path+'/build');
  assert.equal((await row('Workspace folder')).tooltip,a.uri.path);
  const cache=await row('CMakeCache.txt');
  assert.equal(cache.description,a.uri.path+'/build/CMakeCache.txt');
  assert.equal(cache.command.arguments[0].fsPath,path.join(a.uri.fsPath,'build','CMakeCache.txt'));
  debug({name:'Unscoped session',configuration:{executable}});
  debug(undefined);
  assert.equal((await row('Workspace folder')).description,'A');
  vscode.window.showQuickPick=async options=>options[0];
  await commands.get('zephyrWorkbench.launch')();
  assert.deepEqual(launches,[['A','launch A']]);
  vscode.window.showQuickPick=async options=>{edit(b);return options[0];};
  await commands.get('zephyrWorkbench.launch')();
  assert.equal(launches.length,1);
});

test('the directory prompt displays forward slashes and accepts the native path as well as its displayed value',async t=>{
  const {inputDirectory}=require('../extension/fileDialogs');
  const {a}=await setup(t);
  const directory=path.join(a.uri.fsPath,'build','zephyr');
  for(const input of ['build/zephyr',path.join('build','zephyr')]){
    vscode.window.showInputBox=async options=>{
      assert.equal(options.value,'build/zephyr');
      assert.ok(options.prompt.includes(a.uri.path));
      assert.equal(options.validateInput(input),undefined);
      return input;
    };
    const selected=await inputDirectory({baseUri:a.uri,defaultUri:uri(directory),title:'Build'});
    assert.equal(selected.fsPath,directory);
  }
});

test('the debug sidebar discards generated runner data from a sibling Zephyr checkout', async t => {
  const {a,b,row}=await setup(t);
  const packageDir=path.join(a.uri.fsPath,'share','zephyr-package','cmake');
  await fs.mkdir(packageDir,{recursive:true});
  await fs.writeFile(path.join(packageDir,'ZephyrConfig.cmake'),'');
  await fs.writeFile(path.join(a.uri.fsPath,'VERSION'),'');
  await fs.appendFile(path.join(a.uri.fsPath,'build','CMakeCache.txt'),'\nZEPHYR_BASE:PATH='+b.uri.fsPath);
  const runner=await row('Debug runner');
  assert.equal(runner.command,undefined);
  assert.equal(runner.description,'Build directory belongs to another target');
});

test('debugging a declared sysbuild image only switches the debug sidebar to that image',async t=>{
  const {a,debug,target,row}=await setup(t);
  const root=path.join(a.uri.fsPath,'build'), image=path.join(root,'remote');
  await fs.mkdir(image);
  await fs.writeFile(path.join(image,'CMakeCache.txt'),'CACHED_BOARD:STRING=net');
  const domains={build_dir:root,default:'main',domains:[{name:'main',build_dir:path.join(root,'main')},{name:'remote',build_dir:image}]};
  await fs.writeFile(path.join(root,'domains.yaml'),JSON.stringify(domains));
  debug({name:'Network CPU',configuration:{executable:path.join(image,'zephyr','zephyr.elf')},workspaceFolder:a});
  assert.equal((await target.buildDir(a)).fsPath,root);
  assert.equal((await row('Build directory')).description,uri(image).path);
});

test('sidebar runner reports only evidence from the selected app, board and successful generation',async t=>{
  const {a,row,saved}=await setup(t);
  const runner=()=>row('Debug runner');
  const build=path.join(a.uri.fsPath,'build'),file=path.join(build,'zephyr','runners.yaml');
  const boardKey='buildSetup.board:'+a.uri;
  const failureKey='build.failure:'+JSON.stringify([a.uri.toString(),a.uri.fsPath,'board_A',build]);
  assert.equal((await runner()).command.arguments[0].fsPath,file);
  saved.set(boardKey,'next_board');
  assert.equal((await runner()).description,'Build directory belongs to another target');
  assert.equal((await runner()).command,undefined);
  saved.delete(boardKey);
  const appKey='buildSetup.app:'+a.uri;
  saved.set(appKey,path.join(a.uri.fsPath,'other-app'));
  assert.equal((await runner()).description,'Build directory belongs to another target');
  saved.delete(appKey);
  saved.set(failureKey,{action:'configure',time:Date.now()+5000});
  assert.equal((await runner()).description,'Last configuration failed');
  saved.set(failureKey,{action:'configure',time:0});
  assert.equal((await runner()).description,'runner_A');
  await fs.writeFile(path.join(build,'build_info.yml'),'cmake: {board: {name: other}}');
  assert.equal((await runner()).description,'Build metadata does not match this target');
  await fs.unlink(path.join(build,'build_info.yml'));
  const boardDir=path.join(a.uri.fsPath,'boards','board_A');
  await fs.appendFile(path.join(build,'CMakeCache.txt'),'\nBOARD_DIR:PATH='+boardDir);
  await fs.writeFile(file,'debug-runner: stale\nconfig:\n  board_dir: '+path.join(boardDir,'..','board_B'));
  assert.equal((await runner()).description,'Build metadata does not match this target');
  assert.equal((await runner()).command,undefined);
  await fs.writeFile(file,'debug-runner: [');
  assert.equal((await runner()).description,'Unable to parse runners.yaml');
  await fs.writeFile(file,'runners: [qemu]');
  assert.equal((await runner()).description,'No debug runner specified');
  await fs.writeFile(file,'');
  assert.equal((await runner()).description,'No debug runner specified');
  await fs.unlink(file);
  assert.equal((await runner()).description,'No runners.yaml generated');
  await fs.unlink(path.join(build,'build.ninja'));
  assert.equal((await runner()).description,'Configure this target first');
});
