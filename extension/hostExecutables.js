'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const run = promisify(execFile);

function pathKey(env, platform = process.platform) {
  if (platform !== 'win32') return 'PATH';
  return Object.keys(env).find(key => key.toUpperCase() === 'PATH') || 'Path';
}

function pathEntries(env, platform, arch, detected) {
  const windows = platform === 'win32';
  const paths = windows ? path.win32 : path.posix;
  const directories = (env[pathKey(env, platform)] || '').split(paths.delimiter)
    .map(dir => windows ? dir.replace(/^"|"$/g, '') : dir).filter(Boolean);
  if (platform === 'darwin') {
    const prefix = paths.isAbsolute(env.HOMEBREW_PREFIX || '') ? env.HOMEBREW_PREFIX :
      (arch === 'arm64' ? '/opt/homebrew' : '/usr/local');
    const brew = paths.join(prefix, 'bin');
    // Finder can start the host with just Apple's system PATH; prefer the installed toolchain there.
    if (!directories.includes(brew) && (!detected || detected.includes(brew))) {
      const system = directories.findIndex(dir => ['/usr/bin', '/bin', '/usr/sbin', '/sbin'].includes(dir));
      directories.splice(system < 0 ? directories.length : system, 0, brew);
    }
  }
  return directories;
}

function hostBinDirectories(env = process.env, platform = process.platform, arch = process.arch) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  return [...new Set(pathEntries(env, platform, arch).filter(dir => paths.isAbsolute(dir)))];
}

function taskSearchPath(env, preferred, detected, platform = process.platform, arch = process.arch) {
  const delimiter = platform === 'win32' ? ';' : ':';
  const inherited = pathEntries(env, platform, arch, detected);
  return [...new Set([...preferred, ...inherited, ...detected])].join(delimiter);
}

async function usableProgram(file, name, env = process.env, platform = process.platform) {
  try {
    await fs.access(file, fs.constants.X_OK);
    const stat = await fs.stat(file);
    if (!stat.isFile()) return false;
    // Windows also ships a Store redirect called python.exe. Real Store interpreters answer --version.
    if (platform === 'win32' && stat.size === 0 && /^python3?$/i.test(name) && env.LOCALAPPDATA &&
        path.win32.relative(path.win32.join(env.LOCALAPPDATA, 'Microsoft', 'WindowsApps'), path.win32.dirname(file)) === '') {
      const {stdout, stderr} = await run(file, ['--version'], {windowsHide:true, timeout:3000});
      return /^Python 3\./.test((stdout + stderr).trim());
    }
    return true;
  } catch {
    return false;
  }
}

async function findProgram(name, {directories = [], env = process.env, platform = process.platform,
  arch = process.arch, includeHostPath = true} = {}) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const filename = platform === 'win32' && !name.toLowerCase().endsWith('.exe') ? name + '.exe' : name;
  const search = includeHostPath ? hostBinDirectories(env, platform, arch) : [];
  if (includeHostPath && platform === 'darwin' && name === 'cmake') search.push('/Applications/CMake.app/Contents/bin');
  if (includeHostPath && platform === 'win32' && name === 'winget' && env.LOCALAPPDATA)
    search.push(paths.join(env.LOCALAPPDATA, 'Microsoft', 'WindowsApps'));
  for (const dir of new Set([...directories, ...search])) {
    if (!paths.isAbsolute(dir)) continue;
    const file = paths.join(dir, filename);
    if (await usableProgram(file, name, env, platform)) return file;
  }
}

module.exports = {findProgram, hostBinDirectories, pathKey, taskSearchPath, usableProgram};
