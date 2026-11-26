'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {l10n} = require('vscode');
const {imageDomains} = require('./sysbuild');
const {cacheEntries} = require('./target');

/** sysbuild selects the main image's namespaced variable before the unprefixed root variable. */
function fileControls(s, target) {
  const system = s.target.system;
  const systemMode = target.system ?? Boolean(system?.main);
  const image = systemMode && (system?.main?.name || path.basename(target.app));
  const cache = target.cacheStatus === 'current' ? (systemMode ? system?.cache : s.target.cache) : undefined;
  return {image, cache:cache || new Map(), name: variable => image ? image + '_' + variable : variable};
}

function inside(root, file) {
  const relative = path.relative(root, file);
  return relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
}

async function replaceCache(file, expected, content) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    await fs.writeFile(temporary,content,{flag:'wx'});
    if ((await fs.readFile(file,'utf8')) !== expected)
      throw new Error(l10n.t('The main image cache changed during configuration.'));
    await fs.rename(temporary,file);
  } finally {await fs.rm(temporary,{force:true});}
}

/** Clear only a value that the successful outer configure also left in the generated main-image cache. */
async function prepareFileConfigure(s) {
  const edits = s.setup.fileReset?.imageEdits;
  const expected = s.setup.fileReset?.rootExpected || {};
  if (!edits?.length && !Object.keys(expected).length) return;
  const {system} = s.target;
  const [rootText,domainText] = await Promise.all(['CMakeCache.txt','domains.yaml'].map(name=>
    fs.readFile(path.join(s.build.fsPath,name),'utf8')));
  const current = imageDomains(domainText,s.build.fsPath), {cache:values} = cacheEntries(rootText);
  if (!current || !system?.main || current.main.name !== system.main.name || path.relative(current.main.dir,system.main.dir) ||
      values.get('CMAKE_PROJECT_NAME') !== 'sysbuild_toplevel' || !values.get('APP_DIR') ||
      path.relative(values.get('APP_DIR'),s.setup.app) || Object.entries(expected).some(([name,value])=>values.get(name)!==value))
    throw new Error(l10n.t('The main image cache changed during configuration.'));
  if (!edits?.length) return;
  const [root,image,sourceRoot,file] = await Promise.all([s.build.fsPath,system.main.dir,s.setup.app,
    path.join(system.main.dir,'CMakeCache.txt')].map(item=>fs.realpath(item)));
  if (!inside(root,image) || path.relative(image,path.dirname(file)) || path.basename(file)!=='CMakeCache.txt' ||
      !path.relative(image,sourceRoot) || !system.domains.some(domain => domain.dir === system.main.dir && domain.name === system.main.name))
    throw new Error(l10n.t('The main image cache is outside the selected sysbuild directory.'));
  const original = await fs.readFile(file, 'utf8');
  const {cache:child} = cacheEntries(original);
  const directory = child.get('CMAKE_CACHEFILE_DIR'), source = child.get('APPLICATION_SOURCE_DIR') || child.get('CMAKE_HOME_DIRECTORY');
  if (!source || !directory || path.relative(source,s.setup.app) || path.relative(directory,system.main.dir))
    throw new Error(l10n.t('The main image cache belongs to a different application or build directory.'));
  let next = original;
  for (const {name,value,restore} of edits) {
    if (!['CONF_FILE','DTC_OVERLAY_FILE','DTS_SOURCE'].includes(name) || child.get(name) !== value) continue;
    // CMake parses its // help lines together with the entry that immediately follows.
    const entry = new RegExp('^((?://[^\\r\\n]*\\r?\\n)*' + name + ':[A-Z_]+=)[^\\r\\n]*(\\r?\\n|$)','m');
    next = next.replace(entry, (_line,prefix,eol) => restore === undefined ? '' : prefix + restore + eol);
  }
  if (original === next) return;
  await replaceCache(file,original,next);
  return () => replaceCache(file,next,original);
}

module.exports = {fileControls,prepareFileConfigure};
