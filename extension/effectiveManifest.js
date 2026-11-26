'use strict';

const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const execute = promisify(execFile);
const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash} = require('node:crypto');
const yaml = require('js-yaml');
const {manifestCheckout} = require('./checkout');
const {ProbeCache, probeKey} = require('./probeCache');

function importsProjects(manifest) {
  // The manifest reader uses FAILSAFE_SCHEMA, so YAML false is returned as text.
  const enabled = value => value !== undefined && value !== false && value !== 'false' &&
    (!Array.isArray(value) || value.some(enabled));
  return enabled(manifest.self?.import) || (manifest.projects || []).some(project => enabled(project?.import));
}

async function listProjects(manifest, west, env, run) {
  try {
    const format = '{name}\t{path}\t{revision}\t{url}';
    const {stdout} = await run(west, ['list', '-f', format], {
      cwd:manifest.root.fsPath, env, windowsHide:true, timeout:12000, maxBuffer:4*1024*1024
    });
    const records = stdout.split(/\r?\n/).filter(Boolean).map(line => line.split('\t'));
    if (!records.length || records.some(record => record.length !== 4)) return;
    return records.filter(([name]) => name !== 'manifest')
      .map(([name,path,revision,url]) => ({name,path,revision,url}));
  } catch {
    // Direct declarations remain available offline, including when an import has not been fetched.
  }
}

async function resolved(manifest, projects) {
  if (!projects) return {...manifest, scope:manifest.hasImports ? 'partial' : 'direct'};
  const result = {...manifest, projects, scope:'effective'};
  if (!result.checkout) result.checkout = await manifestCheckout(result);
  return result;
}

function canList(manifest, west) {
  return manifest.root && west && manifest.uri && !manifest.invalid;
}

async function effectiveManifest(manifest, west, env, run = execute) {
  return resolved(manifest,canList(manifest,west) ? await listProjects(manifest,west,env,run) : undefined);
}

// Only track dependencies whose on-disk inputs are known. west still resolves all project metadata.
function localImports(manifest, source) {
  if (!manifest || source.includes('<<') || manifest.projects?.some(p => p?.import !== undefined)) return;
  const value = manifest.self?.import;
  if (value === undefined) return [];
  const paths = Array.isArray(value) ? value : [value];
  if (paths.length <= 64 && paths.every(p => typeof p === 'string' && p && !path.isAbsolute(p) &&
      !p.split(/[\\/]/).includes('..') && !['true','false'].includes(p))) return paths;
}

function manifestInputs(manifest, source, config) {
  return {digest:createHash('sha256').update(source).update('\0').update(config).digest('hex'),
    imports:localImports(manifest,source)};
}

async function importDigest(manifest) {
  if (!manifest.inputs?.imports) return;
  const hash = createHash('sha256');
  const files = new Set();
  let bytes = 0;
  try {
    for (const relative of manifest.inputs.imports) {
      const entry = path.resolve(manifest.repository.fsPath, relative);
      const stat = await fs.stat(entry);
      if (stat.isDirectory()) {
        for (const name of (await fs.readdir(entry)).sort()) {
          if (/\.ya?ml$/.test(name)) files.add(path.join(entry,name));
        }
      } else files.add(entry);
      if (files.size > 64) return;
    }
    for (const file of files) {
      const stat = await fs.stat(file);
      bytes += stat.size;
      if (!stat.isFile() || bytes > 1024 * 1024) return;
      const text = await fs.readFile(file,'utf8');
      const imported = yaml.load(text,{schema:yaml.FAILSAFE_SCHEMA})?.manifest;
      if (localImports(imported,text)?.length !== 0) return;
      hash.update(file).update('\0').update(text).update('\0');
    }
    return hash.digest('hex');
  } catch {
    // Missing imports, malformed YAML and unfamiliar schemas are left to west.
  }
}

function createManifestResolver(run = execute) {
  const newCache = () => new ProbeCache(4, 5000);
  let cache = newCache();
  async function resolve(manifest, west, env) {
    if (!canList(manifest,west)) return resolved(manifest);
    const results = cache;
    const imports = env.WEST_CONFIG_LOCAL ? undefined : await importDigest(manifest);
    const key = probeKey(west,[manifest.root.fsPath,manifest.uri.fsPath,manifest.inputs?.digest,imports],env);
    const projects = await results.read(key, () => listProjects(manifest,west,env,run),
      rows => imports !== undefined && rows !== undefined);
    return resolved(manifest,projects);
  }
  return {resolve, clear:() => { cache = newCache(); }};
}

module.exports = {importsProjects, manifestInputs, effectiveManifest, createManifestResolver};
