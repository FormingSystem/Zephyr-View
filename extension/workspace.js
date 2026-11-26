'use strict';

const vscode = require('vscode');
const path = require('node:path');
const {findProgram} = require('./hostExecutables');
const {overrides, programs} = require('./environment');
const {searchDirectories} = require('./toolDirectories');
const yaml = require('js-yaml');
const {importsProjects, manifestInputs} = require('./effectiveManifest');
const {containingCheckout, manifestCheckout, sameCheckout} = require('./checkout');
const {hasCurrentBuild, hasFile, readText, readTarget, resolvePath} = require('./target');

const {westTopdir, inspectConfig} = require('./westWorkspace');

async function findWestRoot(folder) {
  const root = await westTopdir(folder.fsPath);
  return root && vscode.Uri.joinPath(folder, path.relative(folder.fsPath,root).split(path.sep).join('/'));
}

function manifestLocation(root, config) {
  const parsed = inspectConfig(config);
  if (!parsed) throw Error(vscode.l10n.t('Check the INI syntax and duplicate entries in .west/config.'));
  const repositoryPath = parsed.fields.path?.value;
  if (repositoryPath) {
    const repository = vscode.Uri.joinPath(root,repositoryPath);
    return {repository, uri:vscode.Uri.joinPath(repository, parsed.fields.file?.value || 'west.yml')};
  }
}

async function parseManifest(folder, root) {
  const config = root && vscode.Uri.joinPath(root, '.west', 'config');
  let uri,repository;
  try {
    const configText = config ? await readText(config) : '';
    if (config) ({uri,repository} = manifestLocation(root, configText) || {});
    else {repository = folder; uri = vscode.Uri.joinPath(folder, 'west.yml');}
    if (!uri) throw Error(vscode.l10n.t('The [manifest] section must specify path.'));
    const source = await readText(uri);
    if (!source && !config && !await hasFile(uri)) return {projects:[]};
    if (!source) throw Error(vscode.l10n.t('The manifest file is missing or empty.'));
    const manifest = yaml.load(source, {schema:yaml.FAILSAFE_SCHEMA})?.manifest;
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest))
      throw Error(vscode.l10n.t('Expected a manifest mapping.'));
    if (manifest.projects !== undefined && !Array.isArray(manifest.projects))
      throw Error(vscode.l10n.t('Expected a list of projects under manifest.projects.'));
    if (manifest.remotes !== undefined && !Array.isArray(manifest.remotes))
      throw Error(vscode.l10n.t('Expected a list of remotes under manifest.remotes.'));
    const remotes=new Map((manifest.remotes||[]).map(r=>[r.name,r['url-base']]));
    const diagnostics=[];
    const projects = (manifest.projects || []).filter((project,index) => {
      const valid = typeof project?.name === 'string' && project.name.trim() &&
        (project.path === undefined || (typeof project.path === 'string' && project.path.trim()));
      if (!valid) diagnostics.push({kind:'manifestFile',path:uri.fsPath,
        message:vscode.l10n.t('manifest.projects[{0}] needs a nonempty name and a string path if one is specified.',index)});
      return valid;
    })
      .map(project => {
        const remote=remotes.get(project.remote??manifest.defaults?.remote);
        return {name:project.name,path:project.path||project.name,
          url:project.url||(remote?remote.replace(/\/$/,'')+'/'+(project['repo-path']||project.name):''),
          revision:String(project.revision??manifest.defaults?.revision??'master')};
      });
    return {root, config, uri, repository, projects, diagnostics, invalid:diagnostics.length>0,
      hasImports:importsProjects(manifest), inputs:root && manifestInputs(manifest,source,configText)};
  } catch (error) {
    const diagnostics = [{kind:uri ? 'manifestFile' : 'westConfig',path:(uri || config).fsPath,message:error.message}];
    return {root, config, uri, repository, projects:[], invalid:true,diagnostics};
  }
}

async function readManifest(folder, root) {
  const manifest = await parseManifest(folder,root);
  manifest.checkout = await manifestCheckout(manifest);
  return manifest;
}

function explicitSource(folder, context) {
  if (!vscode.workspace.isTrusted || !context) return;
  const locations = vscode.workspace.getConfiguration('zephyrWorkbench',folder.uri).get('locations',{});
  const session = context.workspaceState;
  const source = overrides(context,folder).ZEPHYR_BASE || locations?.ZEPHYR_BASE ||
    process.env.ZEPHYR_BASE || session.get('buildSetup.base:'+folder.uri.toString());
  return source && path.resolve(folder.uri.fsPath,source);
}

async function workspaceManifest(folder, checkout, explicit, method) {
  const root = await findWestRoot(folder.uri);
  let manifest = await readManifest(folder.uri, root);
  if (root && manifest.invalid) return manifest;
  if (checkout && ((!manifest.uri && !root) || (manifest.checkout && !await sameCheckout(checkout,manifest.checkout)))) {
    // A separate source tree can live beside the manifest repository under the same west topdir.
    manifest = await readManifest(vscode.Uri.file(checkout));
  }
  if (!explicit) return manifest;
  const source = vscode.Uri.file(explicit);
  const different = manifest.checkout && !await sameCheckout(manifest.checkout,explicit);
  const useWest = method === 'west' || (!method && manifest.root);
  if (useWest && (!manifest.root || different)) {
    const linked = await readManifest(source, await findWestRoot(source));
    if (linked.root && (!linked.checkout || await sameCheckout(linked.checkout,explicit))) return linked;
  }
  if ((!manifest.root && !manifest.uri) || (different && (!manifest.root || useWest))) return readManifest(source);
  return manifest;
}

async function inspectWorkspace(provider,context,discovery) {
  const folder = provider.folder();
  const build = folder && await provider.buildDir(folder);
  const checkout = folder?.uri.scheme === 'file' && await containingCheckout(folder.uri.fsPath);
  const explicit = folder && (explicitSource(folder,context) || discovery?.chosenSource(folder));
  const method = folder && context?.workspaceState.get('workbench.method:'+folder.uri.toString());
  const [target, manifest] = folder ? await Promise.all([readTarget(folder, build), workspaceManifest(folder,checkout,explicit,method)]) : [undefined, {projects:[]}];
  const source = checkout || manifest.checkout;
  const windows = process.platform === 'win32';
  const toolDirectories = searchDirectories(context,folder);
  const toolSource = explicit || source;
  const venvDirectories = [folder?.uri.fsPath !== checkout && folder?.uri.fsPath,toolSource,manifest.root?.fsPath].filter(Boolean)
    .map(dir => path.join(dir, '.venv', windows ? 'Scripts' : 'bin'));
  const tools = Object.fromEntries(await Promise.all(programs.map(async name => {
    const directories = ['west','python'].includes(name) ? [...venvDirectories, ...toolDirectories] : toolDirectories;
    return [name, await findProgram(name === 'python' && !windows ? 'python3' : name, {directories})];
  })));
  return {folder,build,target,manifest,tools,toolDirectories,checkout:source};
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

module.exports = {inspectWorkspace, buildFiles, explicitSource};
