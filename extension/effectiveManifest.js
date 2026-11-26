'use strict';

const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const execute = promisify(execFile);
const {manifestCheckout} = require('./checkout');

function importsProjects(manifest) {
  // The manifest reader uses FAILSAFE_SCHEMA, so YAML false is returned as text.
  const enabled = value => value !== undefined && value !== false && value !== 'false' &&
    (!Array.isArray(value) || value.some(enabled));
  return enabled(manifest.self?.import) || (manifest.projects || []).some(project => enabled(project?.import));
}

async function effectiveManifest(manifest, west, env, run = execute) {
  const fallback = {...manifest, scope:manifest.hasImports ? 'partial' : 'direct'};
  if (!manifest.root || !west || !manifest.uri || manifest.invalid) return fallback;
  try {
    const format = '{name}\t{path}\t{revision}\t{url}';
    const {stdout} = await run(west, ['list', '-f', format], {
      cwd:manifest.root.fsPath, env, windowsHide:true, timeout:12000, maxBuffer:4*1024*1024
    });
    const records = stdout.split(/\r?\n/).filter(Boolean).map(line => line.split('\t'));
    if (!records.length || records.some(record => record.length !== 4)) return fallback;
    const projects = records.filter(([name]) => name !== 'manifest')
      .map(([name,path,revision,url]) => ({name,path,revision,url}));
    const result = {...manifest, projects, scope:'effective'};
    if (!result.checkout) result.checkout = await manifestCheckout(result);
    return result;
  } catch {
    // Direct declarations remain available offline, including when an import has not been fetched.
    return fallback;
  }
}

module.exports = {importsProjects, effectiveManifest};
