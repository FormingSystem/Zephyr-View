'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {execFile} = require('node:child_process');
const run = require('node:util').promisify(execFile);
const {Uri} = require('vscode');
const {readTarget,hasCurrentBuild} = require('./target');

function deviceIds(args) {
  if (!Array.isArray(args)) return [];
  const ids = [];
  for (let i = 0; i < args.length; ++i) {
    const arg = args[i];
    if (arg === '--dev-id' || arg === '-i') ids.push(args[++i]);
    else if (typeof arg === 'string' && arg.startsWith('--dev-id=')) ids.push(arg.slice(9));
  }
  return ids;
}

async function firmwareFiles(target) {
  const directory = path.dirname(target.runnersFile.fsPath);
  const types = ['elf','hex','bin','uf2','exe','mot'];
  const files = [];
  for (const type of types) {
    const entry = target.runnerData.config?.[type + '_file'];
    if (typeof entry !== 'string' || !entry) continue;
    const file = path.resolve(directory, entry);
    const stat = await fs.stat(file).catch(() => undefined);
    if (stat?.isFile()) files.push({file, size:stat.size, mtime:stat.mtimeMs});
  }
  return files;
}

async function imageInfo(target, name, caps) {
  const data = target.runnerData || {};
  const recorded=target.cache.get('CMAKE_CACHEFILE_DIR');
  const valid = target.generated && (!recorded || !path.relative(recorded,target.buildDir.fsPath)) &&
    !target.conflictingRunnerMetadata && !target.invalidRunners;
  const declared = valid && Array.isArray(data.runners) ? data.runners : [];
  const runners = declared.filter(id => typeof id === 'string' && /^[\w.-]+$/.test(id) && caps[id]?.flash &&
    (data.args?.[id]===undefined || (Array.isArray(data.args[id]) && data.args[id].every(arg=>typeof arg==='string'))));
  return {name, dir:target.buildDir.fsPath, board:target.board, runners, defaultRunner:data['flash-runner'],
    files:valid && target.runnersFile ? await firmwareFiles(target) : [],
    args:Object.fromEntries(runners.map(id=>[id,data.args?.[id] || []])),
    deviceIds:Object.fromEntries(runners.map(id=>[id,deviceIds(data.args?.[id])]))};
}

async function domainImage(target,domain,folder,root,caps) {
  const realDir=await fs.realpath(domain.dir).catch(()=>undefined);
  const relative=realDir && path.relative(root,realDir);
  if (target.system && (!relative || relative==='..' || relative.startsWith('..'+path.sep) || path.isAbsolute(relative)))
    return {name:domain.name,dir:domain.dir,runners:[],files:[]};
  const image=domain.dir===target.buildDir.fsPath ? target : await readTarget(folder,Uri.file(domain.dir));
  return imageInfo(image,domain.name,caps);
}

/** Capability probes only import runner declarations and read CLI help in a trusted workspace. */
class FlashMetadata {
  async tools(s, env, fresh) {
    const base = s.target.zephyrBase || env.ZEPHYR_BASE;
    const python = s.target.cache.get('WEST_PYTHON') || s.target.cache.get('Python3_EXECUTABLE') ||
      s.target.cache.get('_Python3_EXECUTABLE') || s.tools.python;
    const cwd = base || s.manifest.root?.fsPath || s.folder.uri.fsPath;
    const key = JSON.stringify([base,python,s.tools.west,cwd,env.PATH || env.Path]);
    if (!fresh && key === this.key) return this.result;
    const options = {env,cwd,windowsHide:true,timeout:8000,maxBuffer:2*1024*1024};
    const query = async (program,args) => program && (await run(program,args,options)).stdout;
    const [capText, help] = await Promise.all([
      base && query(python,['-B',path.join(__dirname,'flash_caps.py'),base]).catch(()=>undefined),
      query(s.tools.west,['flash','-h']).catch(()=>undefined)
    ]);
    let caps = {};
    try {caps = JSON.parse(capText);} catch { /* A workspace task remains available for external runners. */ }
    const noRebuild=['--no-rebuild','--skip-rebuild'].find(flag=>help?.includes(flag));
    this.key=key;
    this.result={caps,west:help && /--runner\b/.test(help) ? s.tools.west : undefined,domainFlag:Boolean(help?.includes('--domain')),noRebuild,cwd};
    return this.result;
  }

  async describe(s, env, fresh = false, tools = {}) {
    if (!s.folder || !hasCurrentBuild(s) || s.lastFailure) return;
    const target = fresh ? await readTarget(s.folder,s.build) : s.target;
    if (!target.generated || target.board !== s.target.board || path.relative(target.app.fsPath,s.setup.app)) return;
    const {caps,west,domainFlag,noRebuild,cwd} = await this.tools({...s,target},env,fresh);
    const system = target.system, root = s.build.fsPath;
    const domains = system ? system.domains || [] : [{name:target.board,dir:root}];
    const realRoot = await fs.realpath(root);
    const images = await Promise.all(domains.map(domain=>domainImage(target,domain,s.folder,realRoot,caps)));
    const order = system ? system.flashOrder || [] : [target.board];
    const model = {root,system:Boolean(system),west,domainFlag,noRebuild,cwd,order,images,caps,tools};
    model.id = createHash('sha256').update(JSON.stringify(model)).digest('hex');
    return model;
  }
}

module.exports = {FlashMetadata, deviceIds, imageInfo};
