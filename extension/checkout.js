'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

async function localFile(dir, name) {
  try {
    const actual = await fs.realpath(path.join(dir, name));
    const relative = path.relative(await fs.realpath(dir), actual);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return false;
    return (await fs.stat(actual)).isFile();
  } catch { return false; }
}

async function isZephyrSource(dir) {
  return await localFile(dir, 'share/zephyr-package/cmake/ZephyrConfig.cmake') && await localFile(dir, 'VERSION');
}

/** Windows junctions and Unix symlinks can expose a west checkout under a second directory. */
async function sameCheckout(left,right) {
  if (!path.relative(left,right)) return true;
  try {
    const [first,second] = await Promise.all([fs.realpath(left),fs.realpath(right)]);
    return !path.relative(first,second);
  } catch (error) {
    if (['ENOENT','ENOTDIR'].includes(error.code)) return false;
    throw error;
  }
}

/** Source containing the opened folder. A nested west workspace owns its own checkout. */
async function containingCheckout(directory) {
  for (let dir = path.resolve(directory);;) {
    if (await isZephyrSource(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir || await localFile(dir, '.west/config')) return;
    dir = parent;
  }
}

/** Resolve the manifest repository or its declared Zephyr project by their on-disk markers. */
async function manifestCheckout(manifest) {
  const repository = manifest.repository?.fsPath || (manifest.uri?.fsPath && path.dirname(manifest.uri.fsPath));
  if (repository && await isZephyrSource(repository)) return repository;
  const project = manifest.projects.find(entry => entry.name === 'zephyr');
  if (manifest.root && project) {
    const directory = path.resolve(manifest.root.fsPath,project.path);
    if (await isZephyrSource(directory)) return directory;
  }
}

module.exports = {localFile, isZephyrSource, sameCheckout, containingCheckout, manifestCheckout};
