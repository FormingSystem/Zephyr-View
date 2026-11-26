'use strict';

const vscode = require('vscode');
const path = require('node:path');
const {findProgram} = require('./hostExecutables');
const yaml = require('js-yaml');
const {importsProjects} = require('./effectiveManifest');
const {hasCurrentBuild, hasFile, readText, readTarget, resolvePath} = require('./target');

async function findWestRoot(folder) {
  let directory = folder;
  while (true) {
    if (await hasFile(vscode.Uri.joinPath(directory, '.west', 'config'))) return directory;
    const parent = vscode.Uri.joinPath(directory, '..');
    if (parent.toString() === directory.toString()) return undefined;
    directory = parent;
  }
}

function manifestLocation(root, config) {
  const fields = {};
  let section;
  for (const line of config.split(/\r?\n/)) {
    const header = /^\s*\[([^\]]+)\]/.exec(line);
    if (header) section = header[1].toLowerCase();
    const entry = /^\s*(path|file)\s*[=:]\s*(.+?)\s*$/i.exec(line);
    if (section === 'manifest' && entry) fields[entry[1].toLowerCase()] = entry[2];
  }
  if (fields.path) return vscode.Uri.joinPath(root, fields.path, fields.file || 'west.yml');
}

async function readManifest(folder) {
  const root = await findWestRoot(folder);
  const config = root && vscode.Uri.joinPath(root, '.west', 'config');
  const uri = (config && manifestLocation(root, await readText(config))) || vscode.Uri.joinPath(folder, 'west.yml');
  const source = await readText(uri);
  if (!source) return {root, config, projects:[]};
  try {
    const manifest = yaml.load(source, {schema:yaml.FAILSAFE_SCHEMA})?.manifest;
    if (!manifest || (manifest.projects !== undefined && !Array.isArray(manifest.projects))) throw Error();
    const remotes=new Map((manifest.remotes||[]).map(r=>[r.name,r['url-base']]));
    const projects = (manifest.projects || []).filter(project => typeof project?.name === 'string')
      .map(project => {
        const remote=remotes.get(project.remote??manifest.defaults?.remote);
        return {name:project.name,path:project.path||project.name,
          url:project.url||(remote?remote.replace(/\/$/,'')+'/'+(project['repo-path']||project.name):''),
          revision:String(project.revision??manifest.defaults?.revision??'master')};
      });
    return {root, config, uri, projects, hasImports:importsProjects(manifest)};
  } catch {
    return {root, config, uri, projects:[], invalid:true};
  }
}

async function workspaceManifest(folder, context) {
  const manifest = await readManifest(folder.uri);
  if (manifest.root || manifest.uri || !vscode.workspace.isTrusted ||
      context?.workspaceState.get('workbench.method:'+folder.uri.toString()) !== 'west') return manifest;
  const locations = vscode.workspace.getConfiguration('zephyrWorkbench',folder.uri).get('locations',{});
  const source = require('./environment').overrides(context,folder).ZEPHYR_BASE || locations?.ZEPHYR_BASE || process.env.ZEPHYR_BASE;
  if (!source) return manifest;
  const linked = await readManifest(vscode.Uri.file(path.resolve(folder.uri.fsPath,source)));
  return linked.root ? linked : manifest;
}

async function inspectWorkspace(provider,context) {
  const folder = provider.folder();
  const build = folder && await provider.buildDir(folder);
  const [target, manifest] = folder ? await Promise.all([readTarget(folder, build), workspaceManifest(folder,context)]) : [undefined, {projects:[]}];
  const windows = process.platform === 'win32';
  const toolDirectories = require('./toolDirectories').searchDirectories(context,folder);
  const venvDirectories = [folder?.uri, manifest.root].filter(Boolean)
    .map(root => path.join(root.fsPath, '.venv', windows ? 'Scripts' : 'bin'));
  const tools = Object.fromEntries(await Promise.all(require('./environment').programs.map(async name => {
    const directories = ['west','python'].includes(name) ? [...venvDirectories, ...toolDirectories] : toolDirectories;
    return [name, await findProgram(name === 'python' && !windows ? 'python3' : name, {directories})];
  })));
  return {folder,build,target,manifest,tools,toolDirectories};
}

function plannedInputs(app, configure) {
  const names = new Map([['CONF_FILE', 'prj.conf'], ['EXTRA_CONF_FILE', ''],
    ['DTC_OVERLAY_FILE', ''], ['EXTRA_DTC_OVERLAY_FILE', '']]);
  for (const arg of configure) {
    const entry = /^-D(\w+)(?::\w+)?=(.*)$/.exec(arg);
    if (entry && names.has(entry[1])) names.set(entry[1], entry[2]);
  }
  return [...names.values()].flatMap(value => value.split(';').filter(Boolean).map(file => resolvePath(app, file)));
}

async function buildFiles({target, setup, build}) {
  if (!setup.app) return [];
  const app = vscode.Uri.file(setup.app);
  const current = hasCurrentBuild({target, setup});
  const tree = target.devicetree;
  const inputs = current ? [...target.files, tree.base, ...tree.overlays].filter(Boolean) : plannedInputs(app, setup.plan.configure);
  const image=target.buildDir || build;
  const outputs = current ? [vscode.Uri.joinPath(image, 'zephyr', '.config'), tree.merged, vscode.Uri.joinPath(image, 'zephyr', 'zephyr.elf')].filter(Boolean) : [];
  const candidates = [vscode.Uri.joinPath(app, 'CMakeLists.txt'), ...inputs, ...outputs];
  const unique = [...new Map(candidates.map(uri => [uri.toString(), uri])).values()];
  const present = await Promise.all(unique.map(hasFile));
  return unique.filter((uri, index) => present[index]);
}

module.exports = {inspectWorkspace, buildFiles};
