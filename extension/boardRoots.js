'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

function board_roots(value) {
  return typeof value === 'string' ? value.split(';').filter(Boolean) : [];
}

/** Preserve lookup order while combining the workspace, environment and CMake roots. */
function distinct_roots(values, base) {
  const seen = new Set();
  return values.filter(value => {
    const absolute = path.resolve(base, value);
    const key = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function isDirectory(directory) {
  try { return (await fs.stat(directory)).isDirectory(); }
  catch (error) {
    if (['ENOENT','ENOTDIR'].includes(error.code)) return false;
    throw error;
  }
}

/** Resolve a board root, its boards/ folder, or a board definition directory beneath it. */
async function selected_root(directory) {
  if (directory.includes(';')) return undefined;
  const candidate = path.normalize(directory);
  if (await isDirectory(path.join(candidate,'boards'))) return candidate;
  if (!await isDirectory(candidate)) return;
  const isBoards = value => (process.platform === 'win32' ? value.toLowerCase() : value) === 'boards';
  if (isBoards(path.basename(candidate))) return path.dirname(candidate);
  const entries = await fs.readdir(candidate, {withFileTypes:true});
  if (!entries.some(entry => entry.isFile() && (entry.name === 'board.yml' || entry.name.endsWith('_defconfig')))) return;
  let parent = path.dirname(candidate);
  while (parent !== path.dirname(parent)) {
    if (isBoards(path.basename(parent))) return path.dirname(parent);
    parent = path.dirname(parent);
  }
}

module.exports = {board_roots, distinct_roots, selected_root};
