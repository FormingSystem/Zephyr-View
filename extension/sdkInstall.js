'use strict';

const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const execute = require('node:util').promisify(require('node:child_process').execFile);
const {pickFile} = require('./fileDialogs');
const {taskEnvironment} = require('./buildSetup');
const {board_facts,sdk_catalog} = require('./compiler_catalog');
const {sdkVersion,fullSdkBundles,listedSdk} = require('./componentCatalog');
const {t,exists,directory,select,checkout,destination} = require('./installationDialogs');

async function version(s) {
  const recommended=checkout(s) && await fs.readFile(path.join(checkout(s),'SDK_VERSION'),'utf8').catch(()=>undefined);
  if(sdkVersion(recommended?.trim())){
    const selected=await select(t('选择 SDK 发布版本','Choose an SDK release'),[
      ['checkout',recommended.trim()+' · '+t('当前源码推荐（SDK_VERSION）','Recommended by this checkout (SDK_VERSION)')],
      ['custom',t('使用其他发布版本…','Use another release version…')] ]);
    if(!selected)return;
    if(selected==='checkout')return recommended.trim();
  }
  return vscode.window.showInputBox({title:t('Zephyr SDK 发布版本','Zephyr SDK release version'),
    value:'',prompt:t('填写 SDK Releases 中的其他版本号','Enter another version from SDK Releases'),
    validateInput:value=>sdkVersion(value)?undefined:t('例如 1.0.1','For example, 1.0.1')});
}

async function releaseAssets(selected,python) {
  const {stdout}=await execute(python,[path.join(__dirname,'install_sdk.py'),'--print-host'],{timeout:5000,windowsHide:true});
  const response=await fetch('https://api.github.com/repos/zephyrproject-rtos/sdk-ng/releases/tags/v'+encodeURIComponent(selected),
    {headers:{'User-Agent':'Zephyr-Extension'},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error(t('读取官方 SDK 发布信息失败','Could not read official SDK release')+' · HTTP '+response.status);
  return {host:stdout.trim(),names:(await response.json()).assets.map(asset=>asset.name)};
}

async function onlineBundle(s) {
  const selected=await version(s);
  if(!selected)return;
  const release=await releaseAssets(selected,s.tools.python);
  const names=fullSdkBundles(release.names,selected,release.host);
  if(!names.length)throw Error(t('此版本没有匹配的完整 SDK 包，请选择兼容的发布版本或使用本机已有工具链。',
    'This release has no matching full SDK bundle. Choose a compatible release or use an existing toolchain.')+' · '+release.host);
  const filename=names.length===1?names[0]:await select(t('选择官方工具链包','Choose an official toolchain bundle'),names.map(name=>[name,name]));
  if(!filename)return;
  const keep=await select(t('下载缓存','Download cache'),[
    ['temporary',t('安装后清理下载包','Remove downloaded archive after installation')],
    ['keep',t('另存已校验的包与校验清单','Keep the verified bundle and checksum for offline installation')] ]);
  if(!keep)return;
  const cache=keep==='keep' && await destination(s,'sdk-cache-'+selected);
  if(keep==='keep'&&!cache)return;
  return {args:['--release',filename,...(cache?['--cache',cache]:[])],label:[filename,cache].filter(Boolean).join('\n'),version:selected};
}

async function westSdkPlan(context,s) {
  const selected=await version(s);
  if(!selected)return;
  const cwd=s.manifest.root.fsPath,env=taskEnvironment(context,s);
  const query=args=>execute(s.tools.west,['sdk',...args],{cwd,env,timeout:20000,windowsHide:true});
  const {stdout:help}=await query(['install','--help']);
  const option=help.includes('--gnu-toolchains')?'--gnu-toolchains':'--toolchains';
  if(!['--install-dir','--version',option].every(value=>help.includes(value)))throw Error(t('当前 west sdk 缺少按目标安装的选项，请选择完整发布包','This checkout lacks targeted SDK installation options. Choose a full bundle.'));
  const sdkPython=path.join(path.dirname(s.tools.west),process.platform==='win32'?'python.exe':'python');
  const interpreter=await exists(sdkPython)?sdkPython:s.tools.python;
  if(!interpreter)throw Error(t('请选择用于 west SDK 工具的 Python','Select the Python interpreter for the west SDK tools'));
  const release=await releaseAssets(selected,interpreter);
  const prefixes=['toolchain_gnu_','toolchain_'].map(label=>label+release.host+'_');
  const triplets=release.names.flatMap(name=>{
    const prefix=prefixes.find(value=>name.startsWith(value));
    return prefix?[name.slice(prefix.length).split('.')[0]]:[];
  }).filter(name=>/^[a-z0-9][a-z0-9_-]*$/.test(name)).sort();
  if(!triplets.length)throw Error(t('未发现适用宿主机的 GNU 工具链','This release has no GNU toolchains for the current host'));
  const preferred=s.compilerChoices?.triplet,selectedTarget=s.setup.board||'';
  const choices=triplets.map(label=>({label,picked:label===preferred,description:label===preferred?selectedTarget:undefined}));
  const targets=await vscode.window.showQuickPick(choices,{canPickMany:true,title:t('选择目标 GNU 工具链','Choose target GNU toolchains')+' · '+selectedTarget});
  if(!targets?.length)return;
  let listing;
  try{listing=(await query(['list'])).stdout;}
  catch(error){
    if(!/No Zephyr SDK installed\./i.test((error.stderr||'')+'\n'+(error.stdout||'')))throw error;
    listing='';
  }
  if(listing.trim() && !/^\s+path:\s*\S/m.test(listing))
    throw Error(t('无法核实已注册 SDK 的目录，请使用完整发布包安装','Could not identify registered SDK locations. Choose a complete release bundle.'));
  const registered=listedSdk(listing,selected);
  const location=registered||await destination(s,'zephyr-sdk-'+selected);
  if(!location)return;
  const args=['sdk','install','--version',selected,...(registered?[]:['--install-dir',location]),option,...targets.map(item=>item.label)];
  const detail=registered?t('west 将更新这个已注册的同版本 SDK','west will update this existing registered SDK'):t('安装到新目录','Install in a new directory');
  return {steps:[{program:s.tools.west,args,cwd}],newLocation:registered?undefined:location,sdkVersion:selected,patch:{ZEPHYR_SDK_INSTALL_DIR:location},
    detail:[detail+' · '+location,targets.map(item=>item.label).join(', '),
      t('west 将联网下载并注册到当前用户的 CMake 包注册表。','west downloads components and registers this SDK in the current user’s CMake package registry.')].join('\n')};
}

async function offlineBundle(s) {
  const archive=await pickFile({title:t('选择本地完整 SDK 发布包','Choose a local full SDK release bundle'),defaultUri:s.folder.uri});
  if(!archive)return;
  const adjacent=path.join(path.dirname(archive.fsPath),'sha256.sum');
  const checksums=await exists(adjacent)?adjacent:(await pickFile({title:t('选择该版本官方 sha256.sum','Choose the official sha256.sum for this release'),defaultUri:archive}))?.fsPath;
  if(!checksums)return;
  const filename=path.basename(archive.fsPath);
  return {args:['--archive',archive.fsPath,'--checksums',checksums],label:archive.fsPath+'\nSHA-256 · '+checksums,
    version:/^zephyr-sdk-([^_]+)_/.exec(filename)?.[1]};
}

async function existingSdk(s) {
  const root=await directory(s,t('选择包含 sdk_version 的 SDK 目录','Choose the SDK directory containing sdk_version'));
  if(!root)return;
  const metadata=await fs.readFile(path.join(root,'sdk_version'),'utf8').catch(()=>undefined);
  if(!sdkVersion(metadata?.trim()) || !await exists(path.join(root,'cmake','Zephyr-sdkConfig.cmake')))
    throw Error(t('未发现 SDK 版本或 CMake 包文件','A valid SDK version or CMake package file was not found'));
  const facts=await board_facts(s,s.environment);
  const catalog=await sdk_catalog(root,checkout(s),facts);
  const target=facts.arch && (s.setup.board||facts.arch)+' · '+(catalog.options.map(option=>option.label).join(', ')||
    t('未识别到适配的已安装编译器','No installed compiler matched this target'));
  return {steps:[],patch:{ZEPHYR_SDK_INSTALL_DIR:root},detail:[root,'Zephyr SDK '+metadata.trim(),target].filter(Boolean).join('\n')};
}

async function sdkPlan(context,s) {
  const mode=await select('Zephyr SDK',[
    ['existing',t('使用已安装的 SDK','Use an existing SDK')],
    ['local',t('从本地发布包安装（离线）','Install a local release bundle (offline)')],
    ['online',t('从官方发布页获取完整包并安装','Download and install a complete official bundle')],
    ...(s.tools.west&&s.manifest.root?[['west',t('用 west 下载指定目标的工具链','Use west to install selected target toolchains')]]:[]) ]);
  if(!mode)return;
  if(mode==='west')return westSdkPlan(context,s);
  if(mode==='existing')return existingSdk(s);
  if(!s.tools.python || !s.tools.cmake)throw Error(t('安装 SDK 需要工作区的 Python 和 CMake','SDK installation requires Python and CMake in this workspace'));
  const bundle=await (mode==='local'?offlineBundle(s):onlineBundle(s));
  if(!bundle)return;
  const location=await destination(s,'zephyr-sdk-'+(bundle.version||'local'));
  if(!location)return;
  const registration=await select(t('SDK 注册范围','SDK registration'),[
    ['workspace',t('仅此工作区','This workspace only')],
    ['cmake',t('同时注册到当前用户的 CMake 包注册表','Also register in the current user’s CMake package registry')] ]);
  if(!registration)return;
  const args=[path.join(__dirname,'install_sdk.py'),...bundle.args,'--destination',location,'--cmake',s.tools.cmake];
  if(registration==='cmake')args.push('--register');
  return {steps:[{program:s.tools.python,args}],sdkVersion:bundle.version,patch:{ZEPHYR_SDK_INSTALL_DIR:location},
    detail:bundle.label+'\n→ '+location+'\n'+t('校验 SHA-256，解包并运行官方 SDK 安装脚本。','Verify SHA-256, extract the bundle and run its official setup script.')+
      (registration==='cmake'?'\n'+t('写入当前用户 CMake 包注册表。','Writes the current user’s CMake package registry.'):'')};
}

module.exports={sdkPlan};
