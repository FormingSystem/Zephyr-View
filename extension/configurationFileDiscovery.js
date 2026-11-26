'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const types = {dts: ['DTS_SOURCE', '.dts'], kconfig: ['CONF_FILE', '.conf'], overlay: ['DTC_OVERLAY_FILE', '.overlay']};
const expandable = /\$\{|\$ENV\{|\$CACHE\{|\$<|@\w+@/;
const key = file => process.platform === 'win32' ? path.normalize(file).toLowerCase() : path.normalize(file);
const unique = files => [...new Map(files.map(file => [key(file), file])).values()];

async function entries(directory) {
  if (!directory) return [];
  try {return await fs.readdir(directory, {withFileTypes:true});}
  catch (error) {if (['ENOENT','ENOTDIR','EACCES','EPERM'].includes(error.code)) return []; throw error;}
}

async function exists(file) {
  try {return (await fs.stat(file)).isFile();}
  catch (error) {if (['ENOENT','ENOTDIR','EACCES','EPERM'].includes(error.code)) return false; throw error;}
}

function absolute(app, value) {
  if (typeof value !== 'string') return;
  const item = value.replace(/\$\{(?:APPLICATION_SOURCE_DIR|CMAKE_CURRENT_SOURCE_DIR)\}/g, () => app);
  return expandable.test(item) ? undefined : path.resolve(app, item);
}

// Leave dynamic CMake and sysbuild decisions to the project's own configure step.
async function application_context(app, value) {
  const source = await fs.readFile(path.join(app,'CMakeLists.txt'),'utf8').catch(() => '');
  const prefix = source.replace(/#\[(=*)\[[\s\S]*?\]\1\]|#[^\n]*/g, '').split(/\bfind_package\s*\(\s*Zephyr\b/i)[0];
  const declared = variable => new RegExp('\\b' + variable + '\\b').test(prefix);
  const root = absolute(app, value('APPLICATION_CONFIG_DIR') ?? app);
  const top = await entries(root);
  const zephyrTree = top.some(e => e.name === 'Kconfig.zephyr') && top.some(e => e.name === 'west.yml');
  const external = ['SNIPPET','SYSBUILD','CMAKE_PROJECT_INCLUDE','CMAKE_PROJECT_INCLUDE_BEFORE','CMAKE_PROJECT_TOP_LEVEL_INCLUDES',
    'CMAKE_TOOLCHAIN_FILE'].some(name => value(name));
  const cmakeHook = /\b(?:include|add_subdirectory|cmake_language)\s*\(/i.test(prefix);
  const dynamic = kind => !root || zephyrTree || external || cmakeHook ||
    ['APPLICATION_CONFIG_DIR','FILE_SUFFIX',types[kind][0]].some(declared);
  // A fragment selected in the GUI must still resolve when project CMake changes its config directory.
  const manualRoot = declared('APPLICATION_CONFIG_DIR') || cmakeHook ? undefined : root;
  return {app, root, manualRoot, top, dynamic, zephyrTree, suffix:value('FILE_SUFFIX') || ''};
}

function under_root(ctx, name, suffix = ctx.suffix) {
  if (!suffix) return path.join(ctx.root, name);
  const dot = name.indexOf('.');
  return path.join(ctx.root, name.slice(0,dot) + '_' + suffix + name.slice(dot));
}

async function sole_main_config(ctx) {
  if (ctx.dynamic('kconfig')) return;
  const confs = ctx.top.filter(e => e.isFile() && e.name.endsWith('.conf'));
  if (confs.some(e => ['prj.conf', 'prj_' + ctx.suffix + '.conf'].includes(e.name))) return;
  const [entry] = confs;
  if (confs.length !== 1 || /^(sysbuild|mcuboot|overlay)(?:[._-]|$)/i.test(entry.name)) return;
  // An explicit CONF_FILE bypasses Zephyr's automatic board/SoC overlays.
  const directories = await Promise.all(['boards','socs'].map(d => entries(path.join(ctx.root,d))));
  if (directories.some(items => items.some(e => e.name.endsWith('.conf')))) return;
  return path.join(ctx.root, entry.name);
}

// Walk the selected application's sources only. Nested applications, virtual
// environments, source checkouts and even custom-named CMake build trees have
// their own inputs and do not contribute replacement candidates to this one.
async function candidates(ctx, buildDirectory) {
  const groups = {dts:[], kconfig:[], overlay:[]};
  if (ctx.zephyrTree) return groups;
  const excluded = new Set(['node_modules','CMakeFiles','__pycache__','build','builds','out','generated','modules']);
  const blocked = buildDirectory && key(buildDirectory);
  const visited = new Set();
  async function walk(dir, items) {
    const id=key(dir);
    if (visited.has(id) || id === blocked || items.some(e => ['CMakeCache.txt','pyvenv.cfg','build.ninja'].includes(e.name))) return;
    visited.add(id);
    if (items.some(e => e.name === 'Kconfig.zephyr') && items.some(e => e.name === 'west.yml')) return;
    if (dir !== ctx.root && dir !== ctx.app && items.some(e => e.name === 'CMakeLists.txt')) {
      const cmake = await fs.readFile(path.join(dir,'CMakeLists.txt'),'utf8').catch(() => '');
      if (require('./applicationCatalog').isApplication(cmake)) return;
    }
    for (const item of items) {
      const file = path.join(dir,item.name);
      if (item.isDirectory() && !item.name.startsWith('.') && !excluded.has(item.name)) {
        await walk(file,await entries(file));
        continue;
      }
      const kind = Object.keys(types).find(k => item.name.endsWith(types[k][1]));
      if (kind && (item.isFile() || (item.isSymbolicLink() && await exists(file)))) groups[kind].push(file);
    }
  }
  if (ctx.root) await walk(ctx.root,ctx.top);
  if (ctx.app && (!ctx.root || key(ctx.root)!==key(ctx.app))) await walk(ctx.app,await entries(ctx.app));
  return groups;
}

async function preferred(ctx, name, suffix) {
  const suffixed = under_root(ctx,name,suffix);
  if (await exists(suffixed)) return suffixed;
  const plain = path.join(ctx.root,name);
  if (suffixed !== plain && await exists(plain)) return plain;
}

async function board_fragments(ctx, kind, layout, directory, suffix) {
  const {name,qualifier,singleSoc,revision} = layout;
  const parts = qualifier.split('/').filter(Boolean);
  const stems = [[name,...parts].join('_')];
  if (parts.length) stems.push([name,...parts.slice(1)].join('_'));
  const extension = types[kind][1], files = [];
  for (const rev of revision ? ['', '_' + revision.replace(/\./g,'_')] : ['']) {
    const [full, short] = await Promise.all(stems.map(stem => preferred(ctx,path.join(directory,stem + rev + extension),suffix)));
    if (short && (full || !singleSoc)) return {files, conflict:true};
    if (full || short) files.push(full || short);
  }
  return {files};
}

// Mirror configuration_files.cmake and zephyr_file(CONF_FILES): SoC, board,
// board revision, then the documented fallback chain for application overlays.
async function automatic_files(ctx, kind, layout) {
  if (ctx.dynamic(kind)) return {files:[],status:'configure'};
  const main = kind === 'kconfig' && await preferred(ctx,'prj.conf',ctx.suffix);
  const files = main ? [main] : [];
  if (!layout) return {files,status:'configure'};
  const soc = layout.qualifier && await preferred(ctx,path.join('socs',layout.qualifier.replace(/\//g,'_') + types[kind][1]),ctx.suffix);
  const board = await board_fragments(ctx,kind,layout,'boards',ctx.suffix);
  if (board.conflict) return {files,status:'choose'};
  if (soc) files.push(soc);
  files.push(...board.files);
  if (kind === 'kconfig') return main ? {files,status:'resolved'} : {files:[],status:'missing'};
  if (!files.length) {
    const fallback = await board_fragments(ctx,kind,layout,'','');
    if (fallback.conflict) return {files:[],status:'choose'};
    files.push(...fallback.files);
    if (!files.length) {
      const overlay = await preferred(ctx,'app.overlay',ctx.suffix);
      if (overlay) files.push(overlay);
    }
  }
  return {files,status:files.length ? 'resolved' : 'optional'};
}

module.exports = {types,unique,key,exists,absolute,application_context,sole_main_config,candidates,automatic_files};
