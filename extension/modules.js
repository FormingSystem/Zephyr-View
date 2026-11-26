'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const vscode=require('vscode');
const yaml=require('js-yaml');
const {execFile}=require('node:child_process');
const {sameCheckout}=require('./checkout');
const {hasCurrentBuild,readText}=require('./target');
const exec=require('node:util').promisify(execFile);
const sha=value=>/^[0-9a-f]{40}$/i.test(value||'');
function repositoryURL(url) {
  if(typeof url!=='string'||/[\s\x00-\x1f]/.test(url))return false;
  if(/^git@[\w.-]+:[\w./-]+$/.test(url))return true;
  try {const u=new URL(url);return ['https:','ssh:'].includes(u.protocol)&&!!u.hostname&&!u.password&&(u.protocol==='ssh:'||!u.username);}catch{return false;}
}
async function stat(file){try{return await fs.stat(file);}catch(e){if(e.code==='ENOENT')return;throw e;}}
async function metadata(dir,contained=false){
  async function available(name){
    const file=path.join(dir,name);
    const info=await stat(file);
    if(!info||!contained)return info;
    const relative=path.relative(await fs.realpath(dir),await fs.realpath(file));
    return relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)?undefined:info;
  }
  for(const name of ['zephyr/module.yml','zephyr/module.yaml']){
    const file=path.join(dir,name),info=await available(name);
    if(!info)continue;
    if(!info.isFile()||info.size>1048576)throw Error('无效的模块描述文件');
    return {file:name,yaml:await fs.readFile(file,'utf8')};
  }
  if((await available('zephyr/CMakeLists.txt'))?.isFile()&&(await available('zephyr/Kconfig'))?.isFile())return {legacy:true};
  throw Error('该目录没有 Zephyr 模块入口。');
}
async function localModule(dir,contained=false) {
  const record=await metadata(dir,contained);
  const meta=record.file ? yaml.load(record.yaml,{schema:yaml.JSON_SCHEMA}) : {};
  if (!meta || typeof meta!=='object' || Array.isArray(meta)) return;
  const name=meta.name??path.basename(dir);
  if (typeof name!=='string' || !name.trim() || /[\r\n\x00]/.test(name)) return;
  return {name,path:await fs.realpath(dir),evidence:record.file||'zephyr/CMakeLists.txt + zephyr/Kconfig'};
}
function git(s,cwd,args){return exec(s.tools.git||'git',['-c','core.hooksPath='+ (process.platform==='win32'?'NUL':'/dev/null'),...args],
  {cwd,windowsHide:true,maxBuffer:8*1024*1024,timeout:120000,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}}).then(r=>r.stdout.trim());}
function rootOf(s){return (s.manifest.root||s.folder.uri).fsPath;}
function scope(s,method){return 'modules.v1:'+method+':'+(method==='west'?rootOf(s):s.setup.app);}
function selectedState(context,s,method){return context.workspaceState.get(scope(s,method),{selected:[],extras:[]});}
function entries(s,record){
  const manifest=s.manifest.projects.map(project=>({...project,kind:'workspace'}));
  const local=(s.localModules||[]).map(module=>({...module,kind:'local'}));
  const candidates=s.manifest.root ? [...manifest,...record.extras,...local] : [...record.extras,...local,...manifest];
  const all=[],names=new Set(),locations=new Set();
  for(const entry of candidates){
    const dir=path.resolve(rootOf(s),entry.path||entry.name);
    const key=process.platform==='win32'?dir.toLowerCase():dir;
    if(names.has(entry.name)||locations.has(key))continue;
    names.add(entry.name);locations.add(key);all.push(entry);
  }
  return all;
}

/** This is Zephyr's module list for a generated image, including modules supplied by the application itself. */
async function resolvedModules(s){
  if(!s.setup || !hasCurrentBuild(s))return [];
  const build=s.target.buildDir||s.build;
  if(!build)return [];
  const kconfig=s.target.cache?.get('KCONFIG_BINARY_DIR') || path.join(build.fsPath,'Kconfig');
  const [contents,moduleKconfig]=await Promise.all([readText(vscode.Uri.joinPath(build,'zephyr_modules.txt')),
    readText(vscode.Uri.file(path.resolve(build.fsPath,kconfig,'Kconfig.modules')))]);
  // In this branch Zephyr rewrites Kconfig.modules but can leave an older zephyr_modules.txt behind.
  if(moduleKconfig.trim()==='# No west and no Zephyr modules')return [];
  const modules=[];
  for(const line of contents.split(/\r?\n/)){
    const match=/^"([^"]+)":"([^"]+)":"[^"]*"$/.exec(line);
    if(match)modules.push({name:match[1],path:path.resolve(s.target.zephyrBase||s.environment?.ZEPHYR_BASE||build.fsPath,match[2]),evidence:'zephyr_modules.txt'});
  }
  return modules;
}
function managedDirectory(root,relative){
  if(typeof relative!=='string'||!relative||path.isAbsolute(relative)||relative.split(/[\\/]/).some(v=>v==='..'||v.startsWith('.')))throw Error('检出目录必须在当前工程内。');
  const dir=path.resolve(root,relative);
  if(dir===path.resolve(root))throw Error('请选择模块子目录。');
  return dir;
}
async function verifyParent(root,dir){
  let parent=dir;
  while(!await stat(parent))parent=path.dirname(parent);
  const resolved=path.relative(await fs.realpath(root),await fs.realpath(parent));
  if(resolved==='..'||resolved.startsWith('..'+path.sep)||path.isAbsolute(resolved))throw Error('检出路径指向工作区以外的位置。');
}
async function checkout(s,entry){
  const root=rootOf(s);
  const dir=entry.kind==='local'?entry.path:path.resolve(root,entry.checkout||entry.path||entry.name);
  if(entry.kind==='local') {
    try {if(await localModule(dir))return {status:'本地已识别'};}catch{}
    return {status:'待本机验证'};
  }
  if(!await stat(dir))return {status:'未下载'};
  if(!vscode.workspace.isTrusted||!await stat(path.join(dir,'.git')))return {status:'待本机验证'};
  try{
    const head=await git(s,dir,['rev-parse','HEAD']);
    const ref=entry.revision||'HEAD';
    const required=sha(ref)?ref:ref==='HEAD'?undefined:await git(s,dir,['rev-parse','--verify','--end-of-options',ref+'^{commit}']).catch(()=>undefined);
    const exists=required&&(head===required||await git(s,dir,['cat-file','-e',required+'^{commit}']).then(()=>true,()=>false));
    return {head,required,objects:[head,...(exists?[required]:[])],status:required?(required===head?'已同步':'版本不同'):'已下载 · 要求待核对'};
  }catch{return {status:'待本机验证'};}
}
async function rows(context,s,method){
  if(!s.folder)return [];
  const configured=await resolvedModules(s);
  const record=selectedState(context,s,method);
  const all=entries({...s,localModules:[...(s.localModules||[]),...configured]},record),result=[];
  for(let i=0;i<all.length;i+=6)result.push(...await Promise.all(all.slice(i,i+6).map(async entry=>{
    const state=await checkout(s,entry);
    const applied=configured.find(module=>module.name===entry.name);
    state.configured=Boolean(applied && await sameCheckout(applied.path,path.resolve(rootOf(s),entry.path||entry.name)));
    return [entry.name,({workspace:'工作区清单',local:'本地模块',official:'Zephyr 官方仓库',git:'个人仓库'})[entry.kind],
      entry.revision||'本地检出',state.status,record.selected.includes(entry.name),entry,state];
  })));
  return result;
}
async function resolve(s,entry,mode,branch){
  if(!repositoryURL(entry.url))throw Error('当前模块没有可用的远端地址。');
  const ref=mode==='latest'?(branch?'refs/heads/'+branch:'HEAD'):entry.revision;
  if(sha(ref))return {sha:ref,ref};
  if(!ref||ref.startsWith('-')||/[\s*?\[\]~^:]/.test(ref))throw Error('无效的目标版本。');
  const refs=ref==='HEAD'||ref.startsWith('refs/')?[ref]:['refs/heads/'+ref,'refs/tags/'+ref,'refs/tags/'+ref+'^{}'];
  const out=await git(s,rootOf(s),['ls-remote','--',entry.url,...refs]);
  const matches=out.split(/\r?\n/).filter(Boolean).map(line=>line.split(/\s+/));
  const target=matches.find(m=>m[1]?.endsWith('^{}'))||matches[0];
  if(!target||!sha(target[0]))throw Error('远端没有返回所选提交。');
  return {sha:target[0],ref};
}
async function sync(s,entry,target,network){
  if(!sha(target)||entry.kind==='local'||!repositoryURL(entry.url))throw Error('无效的同步目标。');
  const root=rootOf(s),dir=managedDirectory(root,entry.checkout||entry.path||entry.name);
  await verifyParent(root,dir);
  const existing=await stat(dir);
  if(!existing&&!network)throw Error('离线时无法下载此模块。');
  if(existing&&!await stat(path.join(dir,'.git')))throw Error('目标目录已有其他文件。');
  if(existing){
    const origin=await git(s,dir,['remote','get-url','origin']).catch(()=>'');
    const normalize=url=>url.replace(/^git@([^:]+):/,'https://$1/').replace(/^ssh:\/\/git@/,'https://').replace(/(?:\.git)?\/?$/,'');
    if(normalize(origin)!==normalize(entry.url))throw Error('该检出目录的 origin 与模块来源不同，请核对仓库。');
    if(await git(s,dir,['rev-parse','HEAD']).catch(()=>'')===target)return;
  }
  let temp;
  try{
    let work=dir;
    if(!existing){
      await fs.mkdir(path.dirname(dir),{recursive:true});
      work=temp=await fs.mkdtemp(path.join(path.dirname(dir),'.zephyr-download-'));
      await git(s,work,['init','--quiet']);
      await git(s,work,['remote','add','origin',entry.url]);
    }else if(await git(s,work,['status','--porcelain']))throw Error('工作树有未提交的修改，请先处理。');
    if(!await git(s,work,['cat-file','-e',target+'^{commit}']).then(()=>true,()=>false)){
      if(!network)throw Error('本机没有目标提交。');
      await git(s,work,['fetch','--no-tags','--',entry.url,target]);
    }
    await git(s,work,['checkout','--detach',target]);
    if(temp){await fs.rename(temp,dir);temp=undefined;}
  }finally{if(temp)await fs.rm(temp,{recursive:true,force:true});}
}
async function operate(context,s,method,request){
  if(!s.folder||!vscode.workspace.isTrusted)throw Error('请先打开并信任工程目录。');
  const {op,value}=request, record=selectedState(context,s,method),all=entries(s,record);
  const find=name=>{const entry=all.find(e=>e.name===name);if(!entry)throw Error('模块已变更，请刷新。');return entry;};
  if(op==='folder'){
    const {pickDirectory,inputDirectory}=require('./fileDialogs');
    const options={defaultUri:s.folder.uri,title:vscode.l10n.t('Select module directory')};
    const dir=value===true?await inputDirectory({...options,baseUri:s.folder.uri}):await pickDirectory(options);
    return dir?.fsPath;
  }
  if(op==='inspect')return metadata(path.resolve(s.folder.uri.fsPath,value));
  if(op==='resolve')return resolve(s,find(value.name),value.mode,value.branch);
  if(op==='apply'){
    return require('./moduleSync').syncBatch(value.rows,async row=>{
      const entry=find(row.name);
      const {head}=await checkout(s,entry);
      if(entry.revision!==row.ref||(head!==row.head&&head!==row.target))throw Error('模块状态已变化，请重新预览同步。');
      await sync(s,entry,row.target,value.network===true);
    });
  }
  if(op==='select'){
    if(!all.some(entry=>entry.name===value.name) && value.checked){
      const applied=(await resolvedModules(s)).find(module=>module.name===value.name);
      if(!applied)throw Error('模块已变更，请刷新。');
      record.extras.push({...applied,kind:'local'});
    }
    record.selected=record.selected.filter(n=>n!==value.name);
    if(value.checked)record.selected.push(value.name);
  }else if(op==='add'){
    const {name,path:location,kind,revision,url,checkout:checkoutDir,subdir}=value;
    if(typeof location!=='string'||/[;"\r\n]/.test(location))throw Error('模块路径包含不可用的字符。');
    let imported;
    if(kind==='local'){
      imported=await localModule(path.resolve(s.folder.uri.fsPath,location));
      if(!imported || imported.name!==name)throw Error('模块名称已变更。');
    }else{
      if(!/^[\w.-]+$/.test(name)||['.','..'].includes(name))throw Error('无效的模块名。');
      if(!['git','official'].includes(kind)||!repositoryURL(url)||!revision)throw Error('无效的模块来源。');
      const dir=managedDirectory(rootOf(s),checkoutDir||location);
      managedDirectory(rootOf(s),location);
      if(all.some(e=>path.relative(dir,path.resolve(rootOf(s),e.checkout||e.path||e.name))===''))throw Error('此目录已由其他模块使用。');
    }
    const existing=all.find(entry=>entry.name===name);
    const detached=existing?.kind==='workspace' && !s.manifest.root && imported;
    if(existing && !detached && !(imported && await sameCheckout(imported.path,path.resolve(rootOf(s),existing.path||existing.name))))
      throw Error('该模块名已由其他目录使用。');
    if(!existing || detached || (existing.kind==='local'&&!record.extras.some(entry=>entry.name===name)))
      record.extras.push({name,path:imported?.path||location,kind,revision,url,checkout:checkoutDir,subdir});
    if(!record.selected.includes(name))record.selected.push(name);
  }else throw Error('未知模块操作。');
  await context.workspaceState.update(scope(s,method),record);
}
module.exports={rows,operate,selectedState,entries,rootOf,scope,localModule,resolvedModules};
