'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {hostBinDirectories} = require('./hostExecutables');
const {readBoards} = require('./boardCatalog');
const {platformTarget, readPlatformArchitectures} = require('./platformArchitecture');
const {hasCurrentBuild} = require('./target');
const {compilerDirectories} = require('./toolchainDiscoveryCache');

async function text(file) {
  try {return await fs.readFile(file, 'utf8');}
  catch (error) {if (['ENOENT','ENOTDIR','EACCES','EPERM','EISDIR'].includes(error.code)) return ''; throw error;}
}

async function entries(directory) {
  try {return await fs.readdir(directory, {withFileTypes:true});}
  catch (error) {if (['ENOENT','ENOTDIR','EACCES','EPERM'].includes(error.code)) return []; throw error;}
}

/** SDK/package searches never execute workspace binaries. Select the current host's executable. */
async function executable(file) {
  if (process.platform === 'win32' ? !/\.exe$/i.test(file) : /\.exe$/i.test(file)) return false;
  try {
    await fs.access(file, fs.constants.X_OK);
    if (!(await fs.stat(file)).isFile()) return false;
    const handle = await fs.open(file,'r');
    try {
      const header=Buffer.alloc(4);
      await handle.read(header,0,4,0);
      if (process.platform==='win32') return header.toString('ascii',0,2)==='MZ';
      if (header.toString('ascii',0,2)==='#!') return true;
      if (process.platform==='darwin')
        return [0xfeedface,0xcefaedfe,0xfeedfacf,0xcffaedfe,0xcafebabe,0xbebafeca,0xcafebabf,0xbfbafeca].includes(header.readUInt32BE());
      return header.equals(Buffer.from([0x7f,0x45,0x4c,0x46]));
    } finally {await handle.close();}
  } catch {return false;}
}

/** Twister records the architecture for a qualified target in the board's platform YAML. */
async function platform_architecture(record, board) {
  const architecture = await readPlatformArchitectures(record);
  return architecture(board);
}

async function board_facts(s, env) {
  if (hasCurrentBuild(s)) {
    const output = await text(path.join((s.target.buildDir || s.build).fsPath,'zephyr','.config'));
    const config = new Map([...output.matchAll(/^(CONFIG_\w+)=(.*)$/gm)].map(([,key,value]) =>
      [key,value.trim().replace(/^"(.*)"$/,'$1')]));
    if (config.get('CONFIG_ARCH')) return {arch:config.get('CONFIG_ARCH'),source:'.config',config,
      target:config.get('CONFIG_BOARD_TARGET')};
  }
  if (!s.setup.board) return {};
  const name = s.setup.board.split(/[@/]/,1)[0];
  try {
    const [record] = await readBoards(s,env,name);
    const arch = record && await platform_architecture(record,s.setup.board);
    return {arch,source:arch && 'board metadata',target:record && platformTarget(s.setup.board,record)};
  } catch {return {};}
}

function condition(expression, facts) {
  if (!/^CONFIG_\w+$/.test(expression)) return undefined;
  if (facts.config) return facts.config.get(expression) === 'y';
  // After Zephyr's arm/arm64 architecture split the board metadata distinguishes the two.
  if (facts.split_arm && expression === 'CONFIG_ARM64') return facts.arch === 'arm64';
}

/** Read literal SDK triplet assignments; unresolved branches and SoC substitutions stay unknown. */
function sdk_triplet(script, facts) {
  if (!facts.arch) return;
  const branch = [], candidates = new Set();
  const statements = script.replace(/#[^\n]*/g,'').matchAll(/\b(if|elseif|else|endif|set)\s*\(\s*([^()]*)\)/gi);
  for (const [,keyword,raw] of statements) {
    const command = keyword.toLowerCase(), value = raw.trim();
    if (command === 'if') branch.push(condition(value,facts));
    else if (command === 'endif') branch.pop();
    else if (command === 'elseif') branch[branch.length-1] = undefined;
    else if (command === 'else') {
      const before = branch.pop();
      branch.push(before === undefined ? undefined : !before);
    } else if (!branch.includes(false)) {
      const [variable,triplet] = value.split(/\s+/);
      if (variable !== 'CROSS_COMPILE_TARGET_'+facts.arch || !triplet) continue;
      if (branch.includes(undefined)) return;
      const resolved = triplet.replace('${SOC_TOOLCHAIN_NAME}',facts.config?.get('CONFIG_SOC_TOOLCHAIN_NAME') || '?');
      if (!/^[\w.-]+$/.test(resolved)) return;
      candidates.add(resolved);
    }
  }
  return candidates.size === 1 ? [...candidates][0] : undefined;
}

function compare_versions(left,right) {
  const a=left.split('.').map(Number), b=right.split('.').map(Number);
  for(let i=0;i<Math.max(a.length,b.length);i++){
    const difference=(a[i]||0)-(b[i]||0);
    if(difference)return difference;
  }
  return 0;
}

/** Honor the checkout's literal find_package constraint and the SDK's backward-compatibility floor. */
function incompatible_sdk(host_tools,version_script,installed) {
  const request=/\bfind_package\s*\(\s*Zephyr-sdk\s+(\d+(?:\.\d+)*)(?:\.\.\.(<?)(\d+(?:\.\d+)*))?\s*[)\s]/i
    .exec(host_tools.replace(/#[^\n]*/g,''));
  if(!request || !/^\d+(?:\.\d+)*$/.test(installed))return false;
  const [,minimum,exclusive,maximum]=request;
  const floor=/\bset\s*\(\s*ZEPHYR_SDK_MINIMUM_COMPATIBLE_VERSION\s+(\d+(?:\.\d+)*)\s*\)/i.exec(version_script)?.[1];
  const upper=maximum && compare_versions(installed,maximum);
  return compare_versions(installed,minimum)<0 || Boolean(floor && compare_versions(minimum,floor)<0) ||
    (maximum!==undefined && (exclusive==='<'?upper>=0:upper>0));
}

async function sdk_catalog(sdk, base, facts) {
  if (!sdk || !facts.arch || !base) return {options:[]};
  const integration = await text(path.join(base,'cmake','toolchain','zephyr','generic.cmake'));
  if (!integration) return {options:[]};
  const sdk_cmake = path.join(sdk,'cmake','zephyr');
  const modern = await text(path.join(sdk_cmake,'gnu','target.cmake'));
  const script = modern || await text(path.join(sdk_cmake,'target.cmake'));
  const host_tools = await text(path.join(base,'cmake','modules','FindHostTools.cmake'));
  const [version,version_script]=await Promise.all([text(path.join(sdk,'sdk_version')),text(path.join(sdk,'cmake','Zephyr-sdkConfigVersion.cmake'))]);
  if(incompatible_sdk(host_tools,version_script,version.trim()))return {options:[],reason:'unsupported'};
  const families = host_tools.includes('TOOLCHAIN_VARIANT_COMPILER') && integration.includes('TOOLCHAIN_VARIANT_COMPILER');
  const split_arm = Boolean(await text(path.join(base,'arch','arm64','Kconfig')));
  const triplet = sdk_triplet(script,{...facts,split_arm});
  const extension = process.platform === 'win32' ? '.exe' : '';
  const options = [];
  if (triplet) {
    const file = path.join(sdk,modern?'gnu':'',triplet,'bin',triplet+'-gcc'+extension);
    if (await executable(file)) options.push({id:'sdk:gnu',family:'gnu',label:'GNU · '+triplet,path:file,
      source:'sdk',compatibility:'sdk',variant:families?'zephyr/gnu':'zephyr'});
  }
  if (families && integration.includes('/llvm/generic.cmake')) {
    const llvm = await text(path.join(sdk_cmake,'llvm','target.cmake'));
    const architectures = [...llvm.matchAll(/(?:if|elseif)\s*\(\s*"?\$\{ARCH\}"?\s+STREQUAL\s+"([\w-]+)"/gi)].map(match=>match[1]);
    const file = path.join(sdk,'llvm','bin','clang'+extension);
    if (architectures.includes(facts.arch) && await executable(file))
      options.push({id:'sdk:llvm',family:'llvm',label:'LLVM · Clang',path:file,source:'sdk',compatibility:'sdk',variant:'zephyr/llvm'});
  }
  return {options,triplet};
}

function cross_prefix(file) {
  const suffix = process.platform === 'win32' ? /gcc\.exe$/i : /gcc$/;
  const name = path.basename(file);
  if (!suffix.test(name) || !name.replace(suffix,'').endsWith('-')) return;
  return file.replace(suffix,'');
}

// Keep just relevant names. Recheck directory changes and the executable itself before offering it.
async function candidateNames(dir, workspaceRoot = false) {
  let info;
  try { info = await fs.stat(dir,{bigint:true}); }
  catch (error) {
    if (['ENOENT','ENOTDIR','EACCES','EPERM'].includes(error.code)) return [];
    throw error;
  }
  if (!info.isDirectory()) return [];
  const key = JSON.stringify([dir,workspaceRoot,String(info.ino),String(info.mtimeNs),String(info.ctimeNs)]);
  return compilerDirectories.read(key, async () => {
    const files = await entries(dir);
    return files.filter(item=>workspaceRoot ? item.isDirectory() && !item.name.startsWith('.') : cross_prefix(item.name))
      .map(item=>item.name);
  });
}

async function cross_catalog(s, env, prefix, sdk, triplet, facts) {
  const dirs = new Set(hostBinDirectories(env));
  if (prefix && path.isAbsolute(prefix)) dirs.add(path.dirname(prefix));
  const roots = new Set([s.folder.uri.fsPath,s.manifest?.root?.fsPath].filter(Boolean));
  for (const root of roots) {
    dirs.add(path.join(root,'bin'));
    for (const name of await candidateNames(root,true)) dirs.add(path.join(root,name,'bin'));
  }
  const rows = await Promise.all([...dirs].map(async dir=>{
    const in_sdk=sdk && under(sdk,dir);
    if (in_sdk && (!prefix || path.relative(path.dirname(prefix),dir))) return [];
    const items = [];
    for (const name of await candidateNames(dir)) {
      const file = path.join(dir,name), value = cross_prefix(file);
      if ((in_sdk && path.relative(value,prefix)) || !await executable(file)) continue;
      const machine = name.split('-')[0];
      const matches = machine === (triplet?.split('-')[0] || facts.arch);
      items.push({id:'cross:'+path.normalize(file),family:'gnu',source:prefix && path.normalize(value)===path.normalize(prefix)?'prefix':'path',
        compatibility:matches?'architecture':'unverified',label:name,path:file,prefix:value,variant:'cross-compile'});
    }
    return items;
  }));
  return [...new Map(rows.flat().map(row=>[path.normalize(row.path),row])).values()]
    .sort((a,b)=>a.label.localeCompare(b.label)||a.path.localeCompare(b.path));
}

function under(parent,child) {
  const relative=path.relative(parent,child);
  return !path.isAbsolute(relative) && relative!=='..' && !relative.startsWith('..'+path.sep);
}

/** CMake can be given the SDK itself or a directory containing versioned SDK installations. */
async function sdk_directory(hint,package_dir) {
  const valid=async dir=>dir && Boolean(await text(path.join(dir,'sdk_version'))) &&
    Boolean(await text(path.join(dir,'cmake','Zephyr-sdkConfig.cmake')));
  if (await valid(hint)) return hint;
  const recorded=package_dir && path.dirname(package_dir);
  if (await valid(recorded) && (!hint || under(hint,recorded))) return recorded;
  if (!hint) return;
  const dirs=(await entries(hint)).filter(entry=>entry.isDirectory() && entry.name.startsWith('zephyr-sdk-'));
  const matches=(await Promise.all(dirs.map(async entry=>{
    const dir=path.join(hint,entry.name);
    return await valid(dir) ? dir : undefined;
  }))).filter(Boolean);
  if(matches.length===1)return matches[0];
}

module.exports = {board_facts,platform_architecture,sdk_directory,sdk_catalog,sdk_triplet,incompatible_sdk,cross_catalog,cross_prefix,executable};
