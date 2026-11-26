'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {hasWestDirectory} = require('./westWorkspace');
const os = require('node:os');
const {isApplication} = require('./applicationCatalog');
const {localModule} = require('./modules');
const {localFile: file, isZephyrSource, sameCheckout} = require('./checkout');
const {l10n} = require('vscode');

const containers = new Set(['applications','apps','modules','sdk','sdks','toolchains','components','bootloader','deps','third_party']);
const ignore = new Set(['node_modules','build','out','dist','__pycache__']);

async function children(dir) {
  try {
    return (await fs.readdir(dir,{withFileTypes:true})).filter(entry =>
      entry.isDirectory() && !entry.name.startsWith('.') && !ignore.has(entry.name)).map(entry => path.join(dir,entry.name));
  } catch { return []; }
}

async function classify(dir) {
  if (await isZephyrSource(dir))
    return {kind:'ZEPHYR_BASE',path:dir,evidence:'VERSION + share/zephyr-package/cmake/ZephyrConfig.cmake'};
  if (await file(dir,'sdk_version') && await file(dir,'cmake/Zephyr-sdkConfig.cmake'))
    return {kind:'ZEPHYR_SDK_INSTALL_DIR',path:dir,evidence:'sdk_version + cmake/Zephyr-sdkConfig.cmake'};
  if (await file(dir,'CMakeLists.txt')) {
    const text = await fs.readFile(path.join(dir,'CMakeLists.txt'),'utf8').catch(()=>'');
    if (isApplication(text))
      return {kind:'application',path:dir,evidence:'CMakeLists.txt · find_package(Zephyr)'};
  }
}

async function inspectLocalModule(dir,diagnostics,explicit=false) {
  try {
    const local = await localModule(dir,true);
    if (local) return local;
    throw Error(l10n.t('Expected module metadata with a valid name.'));
  } catch (error) {
    const metadata = await file(dir,'zephyr/module.yml') ? 'zephyr/module.yml' :
      await file(dir,'zephyr/module.yaml') ? 'zephyr/module.yaml' : undefined;
    if (metadata || explicit) {
      const location = path.join(dir,metadata || 'zephyr/module.yml');
      if (!diagnostics.some(d=>d.path===location))
        diagnostics.push({kind:'moduleFile',path:location,message:error.message});
    }
  }
}

async function nearbyRoot(directory) {
  const parent = path.dirname(directory);
  if ([path.parse(parent).root,os.homedir(),os.tmpdir()].includes(parent) || await hasWestDirectory(parent)) return;
  return parent;
}

function containsDirectory(root, directory) {
  const relative=path.relative(root,directory);
  return relative!=='..' && !relative.startsWith('..'+path.sep) && !path.isAbsolute(relative);
}

function workspaceApplications(records,folder) {
  const externalSources=records.filter(r=>r.kind==='ZEPHYR_BASE' && !containsDirectory(r.path,folder));
  const candidates=records.filter(r=>r.kind==='application' && !externalSources.some(source=>containsDirectory(source.path,r.path)));
  const local=candidates.filter(r=>containsDirectory(folder,r.path));
  return new Set(local.length ? local : candidates);
}

async function scanLocations(folder, westRoot, checkout, moduleSource = checkout) {
  const own = await classify(folder);
  const roots = new Set([folder]);
  if (checkout) roots.add(checkout);
  if (westRoot) roots.add(westRoot);
  else if (own?.kind === 'application' || own?.kind === 'ZEPHYR_BASE') {
    const parent = path.dirname(folder);
    const enclosing = await nearbyRoot(['apps','applications'].includes(path.basename(parent)) ? parent : folder);
    if (enclosing) roots.add(enclosing);
  }
  const records = [];
  const diagnostics = [];
  const seen = new Set();
  async function visit(dir, levels, moduleLevels = 0) {
    if (seen.has(dir)) return;
    seen.add(dir);
    const entry = dir===folder ? own : await classify(dir);
    // A peer checkout never supplies this checkout's applications or modules.
    if (moduleSource && entry?.kind === 'ZEPHYR_BASE' && !await sameCheckout(moduleSource,dir)) {
      if (!checkout) records.push(entry);
      return;
    }
    if (!roots.has(dir) && await hasWestDirectory(dir)) {
      if (entry?.kind === 'ZEPHYR_BASE') records.push(entry);
      return;
    }
    if (entry) records.push(entry);
    const moduleDir=entry && entry.kind!=='application' ? undefined : await fs.lstat(path.join(dir,'zephyr')).catch(()=>undefined);
    const local=moduleDir?.isDirectory() && await inspectLocalModule(dir,diagnostics);
    if (local) records.push({...local,kind:'modules'});
    if ((entry?.kind==='ZEPHYR_BASE' || entry?.kind==='ZEPHYR_SDK_INSTALL_DIR' || local) && !roots.has(dir)) return;
    if (roots.has(dir)) levels=Math.max(1,levels);
    else if(entry) return;
    if (levels<=0 && moduleLevels<=0) return;
    const dirs = await children(dir);
    for (let i=0;i<dirs.length;i+=12) {
      await Promise.all(dirs.slice(i,i+12).map(sub=>{
        const name = path.basename(sub);
        const depth = containers.has(name) ? 1 : levels-1;
        const nested = name==='modules' ? 2 : moduleLevels-1;
        return visit(sub,depth,nested);
      }));
    }
  }
  // Start with the broadest enclosing root, so shared directories are visited once.
  for (const dir of [...roots].sort((a,b)=>a.length-b.length)) await visit(dir,1);
  // A sample may be several directories below its checkout. Its offline modules can live beside that checkout.
  if (moduleSource && !westRoot) {
    const parent = await nearbyRoot(moduleSource);
    if (parent && !roots.has(parent)) {
      for (const dir of await children(parent)) {
        if (seen.has(dir) || await hasWestDirectory(dir) || await isZephyrSource(dir)) continue;
        const name = path.basename(dir);
        if (['modules','components','deps','third_party','bootloader'].includes(name)) {
          await visit(dir,0,name==='modules' ? 2 : 1);
        } else if (await fs.stat(path.join(dir,'zephyr')).then(s=>s.isDirectory(),()=>false)) {
          const local = await inspectLocalModule(dir,diagnostics);
          if (local) records.push({...local,kind:'modules'});
        }
      }
    }
  }
  const byPath = (a,b) => a.path.localeCompare(b.path);
  const unique=new Map(records.map(entry=>[entry.kind+'\0'+entry.path,entry]));
  // A checkout provides build tools and manually searchable samples. Its child projects do not select the workspace app.
  const applications=workspaceApplications(records,folder);
  return {records:[...unique.values()].filter(entry=>entry.kind!=='application'||applications.has(entry)).sort(byPath),
    diagnostics:diagnostics.sort(byPath)};
}

module.exports = {scanLocations, isZephyrSource, inspectLocalModule};
