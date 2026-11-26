'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {workspace} = require('vscode');
const host = require('./hostExecutables');
const {profiles, findProgram, vendorDirectories, inspectDeviceGroups} = require('./probeDiagnostics');
const {searchDirectories} = require('./toolDirectories');
const {overrides} = require('./environment');
const {registeredDirectory, javaLinker} = require('./seggerCommander');

const toolsKey = folder => 'probeSupport.tools:' + folder.uri.toString();
const versionOrder = new Intl.Collator('en', {numeric:true, sensitivity:'base'});

function probeProfile(id) {
  return Object.hasOwn(profiles,id) ? profiles[id] : undefined;
}

function programNameMatches(file, program) {
  const name = path.basename(file);
  return process.platform === 'win32' ? name.toLowerCase() === (program + '.exe').toLowerCase() : name === program;
}

async function selectedProgram(file, program) {
  if (typeof file === 'string' && path.isAbsolute(file) && programNameMatches(file,program) &&
      await host.usableProgram(file,program)) {
    if (process.platform==='win32' && program==='JLink' && await javaLinker(file)) return;
    return file;
  }
}

async function jlinkInstallations(parent) {
  const entries = await fs.readdir(parent,{withFileTypes:true}).catch(()=>[]);
  return entries.filter(entry=>(entry.isDirectory() || entry.isSymbolicLink()) && /^JLink[_-]?V?\d[\w.\-]*$/i.test(entry.name))
    .map(entry=>entry.name).sort((a,b)=>versionOrder.compare(b,a)).map(name=>path.join(parent,name));
}

async function directoryProgram(id, directory) {
  const program = probeProfile(id)?.program;
  if (!program || !directory || !path.isAbsolute(directory)) return;
  const locations = [directory,path.join(directory,'bin')];
  if (id==='pyocd' && process.platform==='win32') locations.push(path.join(directory,'Scripts'));
  if (id==='stm32cubeprogrammer' && process.platform==='darwin') {
    for (const base of [directory,path.join(directory,'STM32CubeProgrammer.app')])
      for (const folder of ['MacOS','Resources']) locations.push(path.join(base,'Contents',folder,'bin'));
  }
  const found = await probeInDirectories(program,locations);
  if (found || id!=='jlink') return found;
  const packages = [path.join(directory,'JLink'),...await jlinkInstallations(directory)];
  return probeInDirectories(program,packages);
}

async function probeInDirectories(program,directories) {
  if (process.platform!=='win32' || program!=='JLink')
    return host.findProgram(program,{directories,includeHostPath:false});
  for (const directory of new Set(directories.filter(Boolean))) {
    const file = await selectedProgram(path.join(directory,'JLink.exe'),program);
    if (file) return file;
  }
}

async function automaticProgram(id,program,directories,fresh) {
  if (id!=='jlink') return findProgram(program,undefined,directories);
  const custom = await probeInDirectories(program,directories);
  if (custom) return custom;
  const vendor = vendorDirectories(program);
  const registered = process.platform==='win32' ? await registeredDirectory(fresh) : undefined;
  const standard = await probeInDirectories(program,[registered,...vendor].filter(Boolean));
  if (standard) return standard;
  for (const parent of new Set(vendor.map(dir=>path.dirname(dir)))) {
    const file = await probeInDirectories(program,await jlinkInstallations(parent));
    if (file) return file;
  }
  return probeInDirectories(program,host.hostBinDirectories());
}

function toolDirectories(context,folder,snapshot) {
  const dirs = [];
  const python = snapshot?.tools?.python || overrides(context,folder).python;
  if (python && path.isAbsolute(python)) dirs.push(path.dirname(python));
  if (folder) dirs.push(path.join(folder.uri.fsPath,'.venv',process.platform==='win32'?'Scripts':'bin'));
  return [...dirs,...(snapshot?.toolDirectories || searchDirectories(context,folder))];
}

async function listProbeTools(context,folder,snapshot,fresh = false) {
  const trusted = workspace.isTrusted;
  const saved = folder && trusted ? context.workspaceState.get(toolsKey(folder),{}) : {};
  const dirs = trusted ? toolDirectories(context,folder,snapshot) : [];
  return Promise.all(Object.entries(profiles).map(async ([id,{program}])=>{
    const selectedPath = saved[id];
    if (selectedPath && program) {
      const file = await selectedProgram(selectedPath,program);
      return {id,path:file,selectedPath,source:'selected'};
    }
    const file = program && trusted ? await automaticProgram(id,program,dirs,fresh) : undefined;
    return {id,path:file,source:'auto'};
  }));
}

async function selectProbeLocation(context,folder,id,location,kind) {
  const program = probeProfile(id)?.program;
  if (!workspace.isTrusted || !folder || !program || typeof location!=='string' || !location.trim()) return;
  const absolute = path.resolve(folder.uri.fsPath,location);
  let file;
  if (kind==='directory') file = await directoryProgram(id,absolute);
  if (kind==='executable') file = await selectedProgram(absolute,program);
  if (!file || !workspace.isTrusted) return;
  const key = toolsKey(folder);
  await context.workspaceState.update(key,{...context.workspaceState.get(key,{}),[id]:file});
  return file;
}

async function resetProbeLocation(context,folder,id) {
  if (!workspace.isTrusted || !folder || !probeProfile(id)?.program) return;
  const key = toolsKey(folder);
  const saved = {...context.workspaceState.get(key,{})};
  delete saved[id];
  await context.workspaceState.update(key,saved);
}

function probeDevices() {
  return workspace.isTrusted ? inspectDeviceGroups() : Promise.resolve({});
}

module.exports = {listProbeTools, probeDevices, selectProbeLocation, resetProbeLocation};
