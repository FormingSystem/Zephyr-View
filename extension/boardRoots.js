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

/** Accept either the directory containing boards/ or the boards directory itself. */
async function selected_root(directory) {
  if (directory.includes(';')) return undefined;
  const candidate = path.normalize(directory);
  try {
    if ((await fs.stat(path.join(candidate, 'boards'))).isDirectory()) return candidate;
  } catch (error) {
    if (!['ENOENT','ENOTDIR'].includes(error.code)) throw error;
  }
  const name = path.basename(candidate);
  if ((process.platform === 'win32' ? name.toLowerCase() : name) !== 'boards') return undefined;
  return (await fs.stat(candidate)).isDirectory() ? path.dirname(candidate) : undefined;
}

module.exports = {board_roots, distinct_roots, selected_root};
