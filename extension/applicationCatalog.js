'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const descriptors = ['sample.yaml', 'tests.yaml', 'testcase.yaml', 'app.yaml', 'prj.conf'];
const ignoredDirectories = new Set(['.git', '.west', '.venv', '__pycache__', 'node_modules', 'CMakeFiles']);
const inaccessible = new Set(['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM']);

function isApplication(text){
  const tokens=/#\[(=*)\[[\s\S]*?\]\1\]|#[^\r\n]*|"(?:\\[\s\S]|[^"\\])*"|\[(=*)\[[\s\S]*?\]\2\]|[()]|[^\s()#"\[]+|\S/g;
  let depth=0,command='',first=false;
  for(const [token] of text.matchAll(tokens)){
    if(token[0]==='#')continue;
    if(first && /^(?:Zephyr|"Zephyr")$/i.test(token))return true;
    first=false;
    if(token==='('){first=depth===0 && command==='find_package';depth++;}
    else if(token===')'){depth=Math.max(0,depth-1);command='';}
    else if(!depth)command=token.toLowerCase();
  }
  return false;
}

async function inspectDirectory(directory, checkout) {
  const entries = await fs.readdir(directory, {withFileTypes: true}).catch(error => {
    if (inaccessible.has(error.code)) return [];
    throw error;
  });
  const names = new Set(entries.map(entry => entry.name));
  if (names.has('CMakeCache.txt') || names.has('pyvenv.cfg') ||
      (names.has('sdk_version') && names.has('cmake'))) return {};
  const children = entries.filter(entry => entry.isDirectory() && !ignoredDirectories.has(entry.name))
    .map(entry => path.join(directory, entry.name));
  if (!names.has('CMakeLists.txt') || (checkout && !path.relative(directory, checkout))) return {children};
  if (descriptors.some(name => names.has(name))) return {children, application: directory};
  const cmake = await fs.readFile(path.join(directory, 'CMakeLists.txt'), 'utf8').catch(error => {
    if (inaccessible.has(error.code) || error.code === 'EISDIR') return '';
    throw error;
  });
  return {children, application: isApplication(cmake) ? directory : undefined};
}

/** Search on the extension host, including a Zephyr checkout outside the open VS Code folder. */
async function discoverApplications(roots, checkout) {
  const pending = roots.filter(Boolean).map(root => path.resolve(root));
  const visited = new Set(), applications = [];
  while (pending.length) {
    const batch = pending.splice(-32).filter(directory => {
      const key = process.platform === 'win32' ? directory.toLowerCase() : directory;
      if (visited.has(key)) return false;
      visited.add(key);
      return true;
    });
    for (const {children, application} of await Promise.all(batch.map(dir => inspectDirectory(dir, checkout)))) {
      if (children) pending.push(...children);
      if (application) applications.push(application);
    }
  }
  return applications.sort();
}

module.exports = {discoverApplications, isApplication};
