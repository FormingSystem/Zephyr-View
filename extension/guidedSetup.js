'use strict';

const vscode = require('vscode');
const path = require('node:path');
const fs = require('node:fs/promises');
const execute = require('node:util').promisify(require('node:child_process').execFile);
const {t,select,checkout} = require('./installationDialogs');
const {install_one,with_install_lock} = require('./componentInstall');
const {useInstalled} = require('./environment');
const {usableProgram} = require('./hostExecutables');
const {isZephyrSource} = require('./discoverLocations');

const sdk='ZEPHYR_SDK_INSTALL_DIR', source='ZEPHYR_BASE';
const targetTools=['dtc','gperf'];
const hostTools=['git','cmake','ninja','python',...targetTools];
const label=id=>id==='dependencies'?t('Zephyr 的 Python 依赖','Zephyr Python dependencies'):id===sdk?'Zephyr SDK':id;
const fileExists=async file=>!!file && (await fs.stat(file).catch(()=>undefined))?.isFile();

async function inspect(s) {
  const tools={};
  await Promise.all([...hostTools,'west'].map(async name=>{
    const file=s.tools[name];
    tools[name]=!!file && await usableProgram(file,name,process.env,process.platform);
  }));
  const base=checkout(s);
  const requirements=base && path.join(base,'scripts','requirements-base.txt');
  const hasRequirements=await fileExists(requirements);
  let python={};
  if(tools.python){
    const args=[path.join(__dirname,'install_python.py'),'--inspect',...(hasRequirements?[requirements]:[])];
    try{python=JSON.parse((await execute(s.tools.python,args,{timeout:10000,windowsHide:true})).stdout);}
    catch{ /* Keep undetermined dependencies available for user selection. */ }
  }
  const cache=s.setup.cacheStatus==='current'?s.target?.cache:new Map();
  const sdkRoot=s.environment[sdk] || cache?.get(sdk);
  const sdkFound=await fileExists(sdkRoot && path.join(sdkRoot,'sdk_version'));
  const sourceFound=!!base && await isZephyrSource(base);
  for(const name of targetTools){
    const cached=cache?.get(name.toUpperCase());
    if(!tools[name] && cached && path.isAbsolute(cached))tools[name]=await fileExists(cached);
  }
  const makeProgram=cache?.get('CMAKE_MAKE_PROGRAM');
  const generator=cache?.get('CMAKE_GENERATOR') || s.setup.westGenerator || s.environment.CMAKE_GENERATOR;
  const validMakeProgram=makeProgram && path.isAbsolute(makeProgram) && await fileExists(makeProgram);
  return {tools,python,hasRequirements,sdkFound,sourceFound,generator,validMakeProgram};
}

function missingComponents(s,method,facts) {
  const {tools,python,sourceFound,hasRequirements}=facts;
  const west=method==='west';
  const items=[];
  const add=(id,description,picked=true)=>items.push({id,label:label(id),description,picked});
  if(!tools.git && (west || !sourceFound))add('git',t('用于获取源码和仓库模块','Used to fetch source and repository modules'),west);
  if(!tools.cmake)add('cmake',t('配置和构建','Configure and build'));
  if(!tools.ninja && !facts.validMakeProgram && /^Ninja(?: Multi-Config)?$/i.test(facts.generator || 'Ninja'))
    add('ninja',t('当前构建生成器','Current build generator'));
  if(!tools.python || python.venv===false)add('python',!tools.python?t('运行 Zephyr 构建脚本','Run Zephyr build scripts'):
    t('当前解释器缺少可用的 venv/pip','Current interpreter lacks venv/pip support'),!tools.python || west);
  if(west && !tools.west)add('west',t('所选构建方式','Selected build method'));
  if(!sourceFound)add(source,t('选择本地源码或获取官方仓库','Select local source or acquire the official checkout'));
  const missing=python.missing?.filter(name=>west || name.toLowerCase()!=='west');
  if((hasRequirements || !sourceFound) && missing?.length!==0){
    const detail=missing?.length?missing.join(', '):t('按源码的 requirements-base.txt 检查','Check requirements-base.txt from the checkout');
    add('dependencies',west?detail:detail+' · '+t('完整清单可能包含 west','The full list may include west'),west);
  }
  if(suggestSdk(s,facts))add(sdk,s.compilerChoices?.triplet || t('使用 Zephyr SDK 的工具链','Toolchain using the Zephyr SDK'),!!s.setup.board);
  for(const id of targetTools)if(!tools[id])add(id,t('按目标需要选用','Optional for targets that use this tool'),false);
  return items;
}

function suggestSdk(s,facts){
  const compiler=s.compilerChoices || {};
  const variant=compiler.variant || s.environment.ZEPHYR_TOOLCHAIN_VARIANT;
  if(compiler.mode!=='sdk' && !/^zephyr(?:\/|$)/.test(variant || ''))return false;
  if(compiler.configured || s.environment.CROSS_COMPILE ||
    compiler.requestedDefinitions?.some(item=>/^(?:CMAKE_(?:TOOLCHAIN_FILE|C_COMPILER)|CROSS_COMPILE)(?::[^=]+)?=/.test(item)))return false;
  const family=variant?.split('/')[1];
  if(compiler.options?.some(o=>o.source==='sdk' && (!family || o.family===family)))return false;
  return !facts.sdkFound || compiler.reason==='unsupported' || !!compiler.triplet;
}

/** Recheck the current workspace after each action; keep the original dependency order. */
async function applySelected(items,read,apply,current) {
  let state=await read();
  for(const [i,item] of items.entries()){
    if(!current() || !state)return items.slice(i);
    if(!state.rows.some(row=>row.id===item.id))continue;
    if(!await apply(item.id,state))return items.slice(i);
    state=await read();
    if(!current() || !state || state.rows.some(row=>row.id===item.id))return items.slice(i);
  }
  return [];
}

async function guide(context,s,method,refresh,current) {
  async function state(snapshot) {
    if(!current() || !snapshot)return;
    const facts=await inspect(snapshot);
    return {snapshot,facts,rows:missingComponents(snapshot,method,facts)};
  }
  const initial=await state(s);
  if(!current() || !initial)return;
  if(!initial.rows.length){
    void vscode.window.showInformationMessage(t('已检测到当前构建方式所需的基础组件。','The base components for this build method were detected.'));
    return;
  }
  const selected=await vscode.window.showQuickPick(initial.rows,{canPickMany:true,
    title:t('补齐缺失组件','Set up missing components')+' · '+method,
    placeHolder:t('勾选要安装或配置的组件，已有组件会自动跳过','Select components to install or configure. Existing components are skipped.')});
  if(!selected?.length || !current())return;
  const ids=new Set(selected.map(row=>row.id));
  const rows=initial.rows.filter(row=>ids.has(row.id));
  const route=rows.some(row=>hostTools.includes(row.id))?await select(t('主机工具安装方式','Host tool installation'),[
    ['auto',t('使用可用的软件包管理器和默认位置','Use the available package manager and default locations')],
    ['custom',t('逐项选择已有程序、本地安装包或安装位置','Choose existing programs, local installers or locations individually')]
  ]):'custom';
  if(!route || !current())return;
  if(route==='auto'){
    const names=rows.filter(row=>hostTools.includes(row.id)).map(row=>row.label).join(', ');
    const accept=t('安装主机工具','Install host tools');
    const detail=names+'\n'+t('使用宿主机的软件包管理器及默认目录，可能需要联网或管理员授权。系统缺少包管理器时可选本地文件。',
      'Use the host package manager and its default directories. It may use the network or request administrator access. A local installer can be selected when a manager is unavailable.');
    if(await vscode.window.showInformationMessage(accept,{modal:true,detail},accept)!==accept || !current())return;
  }
  const remaining=await applySelected(rows,async()=>state(await refresh()),async(id,{snapshot,facts})=>{
    if(id!==source)return install_one(context,snapshot,id,current,{guided:true,automatic:route==='auto',activeVenv:facts.python.activeVenv});
    try{
      const root=await require('./sourceSetup').acquireSource(snapshot,method,current);
      if(!root || !current())return false;
      await useInstalled(context,snapshot.folder,{[source]:root});
      return true;
    }catch(error){
      if(current())void vscode.window.showErrorMessage(error.message);
      return false;
    }
  },current);
  if(current()){
    const message=remaining.length?t('待处理：','Still to set up: ')+remaining.map(row=>row.label).join(', '):
      t('已重新检测选中的组件。','The selected components were verified.');
    void vscode.window.showInformationMessage(message);
  }
}

function installMissing(context,s,method,refresh,current) {
  return with_install_lock(s.folder,()=>guide(context,s,method,refresh,current));
}
module.exports={installMissing,missingComponents,applySelected};
