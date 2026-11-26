'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {isApplication} = require('./applicationCatalog');
const {localModule} = require('./modules');

const containers = new Set(['applications','apps','modules','sdk','sdks','toolchains','components','bootloader','deps','third_party']);
const ignore = new Set(['node_modules','build','out','dist','__pycache__']);

async function children(dir) {
  try {
    return (await fs.readdir(dir,{withFileTypes:true})).filter(entry =>
      entry.isDirectory() && !entry.name.startsWith('.') && !ignore.has(entry.name)).map(entry => path.join(dir,entry.name));
  } catch { return []; }
}

async function file(dir, name) {
  try {
    const full=path.join(dir,name);
    const actual=await fs.realpath(full);
    const relative=path.relative(await fs.realpath(dir),actual);
    if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))return false;
    return (await fs.stat(actual)).isFile();
  }catch{return false;}
}

async function isZephyrSource(dir) {
  return await file(dir,'share/zephyr-package/cmake/ZephyrConfig.cmake') && await file(dir,'VERSION');
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

async function scanLocations(folder, westRoot) {
  const own = await classify(folder);
  const roots = new Set([folder]);
  if (westRoot) roots.add(westRoot);
  else if (own?.kind === 'application' || own?.kind === 'ZEPHYR_BASE') {
    const parent = path.dirname(folder);
    const enclosing = ['apps','applications'].includes(path.basename(parent)) ? path.dirname(parent) : parent;
    if (enclosing !== path.parse(enclosing).root && enclosing !== os.homedir() && enclosing !== os.tmpdir()) roots.add(enclosing);
  }
  const records = [];
  const seen = new Set();
  async function visit(dir, levels, moduleLevels = 0) {
    if (seen.has(dir)) return;
    seen.add(dir);
    const entry = dir===folder ? own : await classify(dir);
    if (entry) records.push(entry);
    const moduleDir=entry ? undefined : await fs.lstat(path.join(dir,'zephyr')).catch(()=>undefined);
    const local=moduleDir?.isDirectory() && await localModule(dir,true).catch(()=>undefined);
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
  return records.sort((a,b)=>a.path.localeCompare(b.path));
}

module.exports = {scanLocations, isZephyrSource};
