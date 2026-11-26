'use strict';

const path = require('node:path');
const vscode = require('vscode');
const {scanLocations, inspectLocalModule} = require('./discoverLocations');
const {selectedTarget} = require('./buildSetup');
const {cacheSourceConflict} = require('./buildVariables');

const preference = 'locations';
const fields = ['application','ZEPHYR_BASE','ZEPHYR_SDK_INSTALL_DIR'];
const configuration = folder => vscode.workspace.getConfiguration('zephyrWorkbench',folder.uri);
const absolute = (root,value) => typeof value==='string' && value.trim() ? path.resolve(root,value) : undefined;
const relative = (root,value) => (path.relative(root,value)||'.').split(path.sep).join('/');
const same = (a,b) => path.relative(a,b)==='';

function makeGroups(records,root,skip,choices){
  const grouped = new Map();
  for (const entry of records) {
    if (skip.has(entry.kind)) continue;
    const key = entry.kind==='modules' ? 'module:'+entry.name : entry.kind;
    if (!grouped.has(key)) grouped.set(key,[]);
    grouped.get(key).push(entry);
  }
  return [...grouped].map(([key,items])=>{
    const options=items.map(item=>({path:relative(root,item.path),evidence:item.evidence}));
    const currentApp=key==='application' && items.find(item=>same(root,item.path));
    const selected=(choices.has(key) ? items.find(item=>same(item.path,choices.get(key))) : undefined) ??
      (currentApp || (items.length===1 ? items[0] : undefined));
    return {key,options,selected:selected ? relative(root,selected.path) : ''};
  });
}

function createDiscovery(){
  const scans=new Map(),choices=new Map(),dismissed=new Map();
  function reset(folder){
    const key=folder?.uri.toString();
    if(key){scans.delete(key);dismissed.delete(key);}
  }
  function choose(folder,key,value){
    const id=folder.uri.toString();
    if(!choices.has(id))choices.set(id,new Map());
    if(value)choices.get(id).set(key,path.resolve(folder.uri.fsPath,value));
    else choices.get(id).delete(key);
  }
  function chosenSource(folder){return folder && choices.get(folder.uri.toString())?.get('ZEPHYR_BASE');}
  async function apply(context,s){
    if(!s.folder || s.folder.uri.scheme!=='file' || !vscode.workspace.isTrusted)return;
    s.checkout ??= s.manifest.checkout;
    const folder=s.folder,root=folder.uri.fsPath,id=folder.uri.toString();
    const saved=configuration(folder).get(preference,{})||{};
    const skip=new Set();
    const origins={};
    const manualApp=context.workspaceState.get('buildSetup.app:'+id);
    if(manualApp)skip.add('application');
    if(saved.application){
      skip.add('application');
      if(!manualApp)s.application=absolute(root,saved.application);
    }
    const source=absolute(root,s.saved.ZEPHYR_BASE || saved.ZEPHYR_BASE || s.environment.ZEPHYR_BASE || s.checkout);
    const foreignCache=cacheSourceConflict(s.target,source);
    // The cache in a reused build directory may describe a different checkout and application.
    if(foreignCache && !manualApp && !s.application)s.application=root;
    const cache=!foreignCache&&s.target.cacheFile&&selectedTarget(context,s).cacheStatus==='current'?s.target.cache:undefined;
    if(cache)skip.add('application');
    for(const name of fields.slice(1)){
      const configured=absolute(root,saved[name]);
      if(configured&&!s.saved[name]){s.environment[name]=configured;origins[name]='workspace';}
      const cacheEntry=cache?.get(name);
      const cached=cacheEntry&&!cacheEntry.endsWith('-NOTFOUND')?cacheEntry:undefined;
      if(s.environment[name]||cached)skip.add(name);
      if(!s.environment[name]&&cached){s.environment[name]=cached;origins[name]='cache';}
    }
    const variant=s.environment.ZEPHYR_TOOLCHAIN_VARIANT||cache?.get('ZEPHYR_TOOLCHAIN_VARIANT');
    if(variant && !/^zephyr(?:\/|$)/.test(variant))skip.add('ZEPHYR_SDK_INSTALL_DIR');
    if(Array.isArray(saved.modules))skip.add('modules');
    const westRoot=s.manifest.root?.fsPath;
    const searchSource=chosenSource(folder) ? undefined : s.checkout;
    const scope=JSON.stringify([westRoot,searchSource]);
    if(scans.get(id)?.scope!==scope)scans.set(id,{scope,records:scanLocations(root,westRoot,searchSource)});
    const scan=scans.get(id);
    let records,diagnostics;
    try{({records,diagnostics}=await scan.records);}
    catch(error){if(scans.get(id)===scan)scans.delete(id);throw error;}
    const manifest=new Map(s.manifest.projects.map(p=>[p.name,path.resolve(s.manifest.root?.fsPath||root,p.path||p.name)]));
    const conflicts=records.filter(r=>r.kind==='modules'&&manifest.has(r.name)&&!same(manifest.get(r.name),r.path))
      .map(r=>({name:r.name,path:relative(root,manifest.get(r.name)),other:relative(root,r.path)}));
    const available=records.filter(r=>r.kind!=='modules'||!manifest.has(r.name));
    const groups=makeGroups(available,root,skip,choices.get(id)||new Map());
    const selectedModules=[];
    for(const group of groups){
      if(!group.selected)continue;
      const location=path.resolve(root,group.selected);
      if(group.key==='application')s.application=location;
      else if(group.key.startsWith('module:'))selectedModules.push(location);
      else {s.environment[group.key]=location;origins[group.key]='detected';}
    }
    const paths=Array.isArray(saved.modules)?saved.modules.map(v=>absolute(root,v)).filter(Boolean):selectedModules;
    const discovered=new Map(records.filter(x=>x.kind==='modules').map(x=>[x.path,x]));
    diagnostics=[...diagnostics];
    s.localModules=(await Promise.all([...new Set(paths)].map(dir=>discovered.get(dir)||
      inspectLocalModule(dir,diagnostics,true)))).filter(Boolean);
    const signature=JSON.stringify(groups);
    s.locations={groups,origins,conflicts,diagnostics,signature,hidden:dismissed.get(id)===signature};
  }
  function dismiss(s){dismissed.set(s.folder.uri.toString(),s.locations.signature);}
  async function save(s){
    if(!s.locations.groups.length||s.locations.groups.some(g=>!g.selected))return false;
    const settings=configuration(s.folder);
    const inspected=settings.inspect(preference);
    const current={...(inspected?.workspaceFolderValue || (!vscode.workspace.workspaceFile && inspected?.workspaceValue) || {})};
    const effective=settings.get(preference,{})||{};
    const modules=[];
    for(const {key,selected} of s.locations.groups){
      if(!selected)continue;
      if(key.startsWith('module:'))modules.push(selected);
      else if(!Object.hasOwn(effective,key))current[key]=selected;
    }
    if(modules.length && !Object.hasOwn(effective,'modules'))current.modules=modules;
    await settings.update(preference,current,vscode.ConfigurationTarget.WorkspaceFolder);
    return true;
  }
  return {apply,save,reset,dismiss,choose,chosenSource};
}
module.exports={createDiscovery};
