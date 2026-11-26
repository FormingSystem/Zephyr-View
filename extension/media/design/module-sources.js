'use strict';

const sourceNames = {manifest:'本工作区的 west 模块', official:'在线模块', git:'个人在线模块', local:'本地模块'};
let sourceCandidates=[], sourceTab='', sourceGeneration=0, onlineInspection=false;
let moduleScope, onlineResults, pendingModuleFocus, selectedExpanded;

function currentModules() {
  if (model.method === 'west') return workspaceState()?.mods || [];
  model.localModules ??= {};
  return model.localModules[appKey()] ??= [];
}

function moduleFlag() {
  const paths = currentModules().filter(m => m[4] && m[5]?.path &&
    (model.method === 'CMake' || m[5].kind !== 'workspace')).map(m => m[5].path);
  if (!paths.length) return '';
  const key = model.method === 'west' ? 'EXTRA_ZEPHYR_MODULES' : 'ZEPHYR_MODULES';
  const resolved = paths.map(p => /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(p) ? p : '<工程根目录>/'+p);
  return '-D'+key+'="'+resolved.join(';')+'"';
}

function moduleLabel(label) {
  const labels={'工作区清单':'Workspace manifest','未下载':'Not downloaded','本地模块':'Local module','Zephyr 官方仓库':'Zephyr repository','个人仓库':'Personal repository','待本机验证':'Unverified','已下载 · 要求待核对':'Downloaded · requirement unverified','本地已识别':'Local module verified','本地检出':'Local checkout'};
  return tr(label,labels[label]||label);
}
function moduleRow([name,reason,revision,status,selected,meta,checkout]) {
    const local = meta?.kind === 'local';
    const displayPath = ZephyrPathDisplay.path(meta?.path);
    const source = meta?.kind==='manifest' && meta.label ? sourceNames.manifest+' · '+ZephyrPathDisplay.path(meta.label) : reason;
    const details = [source, displayPath, meta?.url].filter(Boolean).join(' · ');
    const displayRev=shortCommit(revision), different=checkout?.head&&checkout.head!==checkout.required;
    const statusLabel=local && checkout?.configured ? tr('已纳入当前构建','In current build') :
      ({'已同步':tr('符合工程要求','Matches requirement'),'版本不同':tr('与工程要求不同','Differs from requirement'),'临时版本':checkout?.required?tr('临时版本 · 偏离工程要求','Temporary revision · differs from requirement'):tr('临时版本 · 要求待核对','Temporary revision · requirement unverified')})[status]||status;
    const revTitle=tr('工程要求：','Required: ')+revision+(checkout?.head?tr(' · 本地：',' · Local: ')+checkout.head:'');
    const action = local ? tr('查看','Inspect') : status === '未下载' ? tr('下载','Download') : tr('同步','Sync');
    return '<div class="cell"><input type="checkbox" data-select="'+esc(name)+'" aria-label="'+tr('选择 ','Select ')+esc(name)+'" '+(selected?'checked':'')+'><div title="'+esc(details)+'"><strong class="mono">'+esc(name)+'</strong><small>'+esc(moduleLabel(source))+(displayPath?' · '+esc(displayPath):'')+'<span class="mobile-version"> · '+esc(moduleLabel(displayRev))+'</span></small></div><small class="mono" title="'+esc(revTitle)+'">'+esc(moduleLabel(displayRev))+(different?'<small>'+tr('本地 ','Local ')+esc(shortCommit(checkout.head))+'</small>':'')+'</small>'+badge(moduleLabel(statusLabel),['版本不同','临时版本'].includes(status)?'warn':['未下载','待本机验证'].includes(status)?'neutral':'')+b(action,(local?'origininfo:':name==='chosen'?'syncsingle:':'sync:')+name,'plain')+'</div>';

}

function renderModulePage(main) {
  const previous = moduleScope;
  const focus = moduleControlFocus(main) ?? (document.activeElement===document.body ? pendingModuleFocus : undefined);
  pendingModuleFocus=undefined;
  main.innerHTML=modulesPage();
  if (moduleScope === previous) restoreModuleFocus(focus);
}

function modulesPage() {
  const scope = globalThis.zephyrModules?.scope() ?? JSON.stringify([model.method,model.activeWs,appKey()]);
  if (scope !== moduleScope) {
    selectedExpanded=undefined;
    moduleLists.selected.reset();
    moduleLists.available.reset();
    onlineResults = undefined;
    if (moduleScope !== undefined) query='';
    moduleScope = scope;
  }
  const modules=currentModules(), chosen=modules.filter(m=>m[4]);
  const west=model.method==='west',available= !west || !!workspaceState();
  const context=west?(workspaceState()?.name||tr('未关联工作区','No linked workspace')):ZephyrPathDisplay.path(appKey());
  const title='<div class="module-context"><h1>'+tr('模块','Modules')+'</h1><span title="'+esc(context)+'">'+esc(context)+'</span>'+
    b(model.env.offline?tr('默认离线','Offline by default'):tr('默认允许联网','Network enabled'),'policy','plain')+'</div>';
  if(!available)return title+panel(tr('先关联 west 工作区','Link a west workspace'),wrap(b(tr('打开工作区','Open workspace'),'page:workspace')+b(tr('改用 CMake','Use CMake'),'method:CMake')));
  sourceGeneration++;resetRecognition();onlineInspection=false;
  const toolbar='<div class="module-search"><input class="input" id="filter" type="search" aria-label="'+tr('搜索模块或输入地址','Search modules or enter a location')+'" placeholder="'+tr("搜索工作区模块，或粘贴仓库链接、本地路径","Search modules or paste a repository URL or local path")+'" value="'+esc(sourceKind(query)==='local'?ZephyrPathDisplay.path(query):query)+'">'+
    b(tr('在线搜索','Search online'),'originlookup')+b(tr('选择目录','Select directory'),'originfolder')+(globalThis.zephyrModules?b(tr('输入目录…','Enter folder…'),'modulepath'):'')+'<input hidden id="module-folder" type="file" webkitdirectory multiple></div>';
  return title+'<div class="stack module-sections">'+selectedModulePanel(chosen)+
    panel(tr('待选模块','Available modules'),toolbar+'<div id="import-preview"></div><small id="source-message" role="status"></small><div id="candidates">'+localResults()+'</div>'+sourceGuide())+'</div>';
}

function showSelectedModules() {
  return selectedExpanded ?? !matchMedia('(max-height: 620px)').matches;
}

function selectedModulePanel(chosen) {
  const visible=showSelectedModules(), name=tr('已选模块 · ','Selected modules · ')+chosen.length;
  const heading=chosen.length?'<button type="button" data-module-selected-toggle aria-controls="module-selected-body" aria-expanded="'+
    visible+'"><span aria-hidden="true"></span>'+name+'</button>':name;
  const rows=moduleLists.selected.render(chosen.map(row=>({name:row[0],row})),entry=>moduleRow(entry.row),tr('尚未选择模块。','No modules selected.'));
  return panel(heading,'<div id="module-selected-body"'+(visible?'':' hidden')+'>'+rows+'</div>',
    b(tr('同步所选','Sync selected'),'sync:chosen','primary','refresh',!chosen.some(m=>m[5]?.kind!=='local')));
}

function applyModuleExpansion() {
  const body=document.getElementById('module-selected-body');
  if (!body) return;
  const visible=showSelectedModules();
  body.hidden=!visible;
  document.querySelector('[data-module-selected-toggle]')?.setAttribute('aria-expanded',String(visible));
}

document.addEventListener('click',event=>{
  if (!event.target.closest('[data-module-selected-toggle]')) return;
  selectedExpanded=!showSelectedModules();
  applyModuleExpansion();
});
matchMedia('(max-height: 620px)').addEventListener('change',applyModuleExpansion);

function inputField(id,title,value='',placeholder='') {
  return '<label>'+esc(title)+'<input class="input" id="'+id+'" value="'+esc(value)+'" placeholder="'+esc(placeholder)+'"></label>';
}
function usableUrl(value) {
  if (/^git@[\w.-]+:[\w./-]+$/.test(value)) return true;
  try {const u=new URL(value);return ['https:','http:','ssh:'].includes(u.protocol)&&!!u.hostname&&!u.password&&(!u.username||u.protocol==='ssh:');} catch {return false;}
}
function sourceMessage(text) {const el=$('#source-message');if(el)el.textContent=text;}
function availableModuleRow(entry) {
  if (entry.row) return moduleRow(entry.row);
  const candidate = sourceCandidates[entry.index];
  const origin = candidate.kind === 'manifest' ? 'west · ' : '';
  return '<div class="search-hit"><strong>'+esc(candidate.name)+'</strong><small>'+origin+esc(candidate.revision)+'</small>'+
    b(tr('选用','Select'),'originpick:'+entry.index)+'</div>';
}

function availableResults(rows, candidates, empty) {
  sourceCandidates = candidates;
  const entries = rows.map(row=>({name:row[0],row})).concat(candidates.map(({name},index)=>({name,index})));
  return moduleLists.available.render(entries,availableModuleRow,empty);
}

function localResults(){
  const term=query.trim().toLowerCase();
  if (onlineResults?.term === term) {
    return availableResults([],onlineResults.items,tr('没有匹配的在线模块。','No matching online modules.'));
  }
  const current=currentModules(), items=current.filter(m=>!m[4]&&fuzzy(m[0],term));
  const w=workspaceState(), known=new Set(current.map(m=>m[0]));
  const candidates=model.method==='CMake'&&w?w.mods.filter(m=>(!m[5]||m[5].kind==='workspace')&&!known.has(m[0])&&fuzzy(m[0],term)).map(m=>({
    name:m[0],revision:m[2],url:m[5]?.url||(!m[5]?'https://github.com/zephyrproject-rtos/'+m[0]+'.git':''),path:m[5]?.path||fixturePath(m[0]),status:m[3],kind:'manifest',label:w.repo+'/'+w.manifest
  })):[];
  return availableResults(items,candidates,tr('工作区没有匹配的模块。','No matching modules in this workspace.'));
}
function sourceGuide(){
  if(!document.documentElement.lang.startsWith('zh'))return '<details class="module-guide"><summary>Getting started</summary><ol><li>Select manifest modules here or search the Zephyr organization online. Paste a GitHub or Gitee repository, branch or module file URL to inspect another source.</li><li>For local modules select the repository root. The declared name comes from <code>zephyr/module.yml</code> or <code>zephyr/module.yaml</code>.</li><li>Legacy modules need both <code>zephyr/CMakeLists.txt</code> and <code>zephyr/Kconfig</code>. An existing checkout can be used offline.</li></ol></details>';

  return '<details class="module-guide"><summary>'+tr('新手指导','Getting started')+'</summary><ol>'+
    '<li>工作区已有的模块可直接选择，版本取自当前 west 清单。在线模块按名称搜索 Zephyr 官方组织；个人仓库可以粘贴 GitHub 或 Gitee 的仓库首页、分支目录或模块描述文件链接，也可以用 HTTPS、SSH 克隆地址。链接中的分支或标签会自动识别。</li>'+
    '<li>使用本地模块时，请选仓库根目录，例如 <code>my_driver/</code>。扩展会读其中的 <code>zephyr/module.yml</code> 或 <code>zephyr/module.yaml</code>，优先采用文件声明的 <code>name</code>。</li>'+
    '<li>旧式模块需要同时有 <code>zephyr/CMakeLists.txt</code> 和 <code>zephyr/Kconfig</code>。识别失败时，检查目录层级、所选版本、仓库权限。离线时使用已有检出目录。</li></ol></details>';
}
function sourceKind(value){
  if(/^(?:https?:\/\/|ssh:\/\/|git@|(?:github|gitee)\.com\/)/i.test(value))return 'git';
  if(/^(?:[a-z]:[\\/]|\\\\|\/|~[\\/]|\.{1,2}[\\/])/i.test(value))return 'local';
  if(/^[^:/\\]+[\\/][^\\/]/.test(value))return 'local';
  return '';
}
function clearImport(){
  sourceGeneration++;resetRecognition();sourceTab='';onlineInspection=false;
  $('#import-preview').replaceChildren();sourceMessage('');
}
function previewSource(kind,value,entry={},networkAllowed=false){
  clearImport();sourceTab=kind;onlineInspection=networkAllowed;
  const local=kind==='local';
  const input=(id,v)=>'<input id="'+id+'" type="hidden" value="'+esc(v)+'">';
  const fields=local?input('origin-path',value):input('origin-url',value)+
    inputField('origin-rev',tr('目标版本','Target revision'),entry.revision||'',tr('采用链接版本或 HEAD','Link revision or HEAD'))+
    inputField('origin-path',tr('本地检出目录','Checkout directory'),ZephyrPathDisplay.path(entry.path)||'',tr('按仓库名生成','From repository name'));
  const status=local?'本地模块':kind==='official'?'Zephyr 官方仓库':'个人仓库';
  $('#import-preview').innerHTML='<div class="module-confirm"><div class="import-source"><small>'+status+'</small><code>'+esc(local?ZephyrPathDisplay.path(value):value)+'</code></div>'+fields+
    '<strong id="identity-result" aria-live="polite"></strong><div class="actions">'+(!local&&model.env.offline&&!onlineInspection?b(tr('联网识别','Identify online'),'originonline'):'')+
    b(tr('添加模块','Add module'),'originadd','primary','',true)+b(tr('取消','Cancel'),'origincancel','plain')+'</div></div>';
  $('#candidates').innerHTML='';
  if(value)detectSource();
}
function processAddress(value,allowNetwork=false){
  const kind=sourceKind(value);
  if(!kind)return false;
  let official=false;
  if(kind==='git'){
    try{const repo=repositoryLink(value);official=repo.platform==='GitHub'&&repo.slug?.toLowerCase().startsWith('zephyrproject-rtos/');}
    catch(e){sourceMessage(e.message);return true;}
  }
  previewSource(official?'official':kind,value,{},allowNetwork);return true;
}
function fixturePath(name) {return ['cmsis','cmsis_6'].includes(name)?'modules/hal/'+name:'modules/'+({mbedtls:'crypto',lvgl:'lib/gui'}[name]||'lib')+'/'+name;}
function manifestProjects(text,fileName) {
  const manifest=jsyaml.load(text,{schema:jsyaml.FAILSAFE_SCHEMA})?.manifest;
  if(!manifest || !Array.isArray(manifest.projects))throw Error('清单缺少 manifest.projects。');
  if(manifest.self?.import||manifest.projects.some(p=>p?.import))throw Error('此清单包含 import。请载入 west manifest --resolve 导出的有效清单。');
  const remotes=new Map((manifest.remotes||[]).map(r=>[r.name,r['url-base']]));
  return manifest.projects.map(p=>{
    if(typeof p?.name!=='string')throw Error('项目缺少名称。');
    const base=remotes.get(p.remote??manifest.defaults?.remote);
    return {name:p.name,path:p.path||p.name,revision:String(p.revision??manifest.defaults?.revision??'master'),
      url:p.url||(base?base.replace(/\/$/,'')+'/'+(p['repo-path']||p.name):''),label:fileName};
  });
}
async function readWorkspaceManifest(file){
  const w=workspaceState();
  if(!file||!w)return;
  try{
    if(file.size>4*1024*1024)throw Error('清单过大。');
    const entries=manifestProjects(await file.text(),file.name);
    if(w!==workspaceState()||page!=='workspace')return;
    const extras=w.mods.filter(m=>m[5]&&m[5].kind!=='workspace');
    const seen=new Set(extras.map(m=>m[0].toLowerCase()));
    const rows=entries.map(entry=>{
      if(!/^[\w.-]+$/.test(entry.name)||seen.has(entry.name.toLowerCase()))throw Error('无效或重复的项目名：'+entry.name);
      seen.add(entry.name.toLowerCase());
      const old=w.mods.find(m=>m[0]===entry.name);
      return [entry.name,'工作区清单',entry.revision,old?.[2]===entry.revision&&old[5]?.path===entry.path?old[3]:'待本机验证',old?.[4]||false,{...entry,kind:'workspace'}];
    });
    w.mods=[...rows,...extras];w.last='已读入 '+file.name+' · '+rows.length+' 项';w.importedManifest=file.name;
    invalidate();commitDemo();notify(w.last);
  }catch(e){notify(e.message);}
}
async function searchOfficial(){
  const term=$('#filter').value.trim();
  clearImport();
  onlineResults=undefined;
  moduleLists.available.reset();
  if(!term){sourceMessage(tr('请输入模块名称。','Enter a module name.'));$('#filter').focus();return;}
  if(processAddress(term,true))return;
  const container=$('#candidates'),request=sourceGeneration;
  container.replaceChildren();sourceMessage(tr('正在搜索 Zephyr 官方仓库…','Searching Zephyr repositories…'));
  try{
    const url=new URL('https://api.github.com/search/repositories');
    url.searchParams.set('q','org:zephyrproject-rtos '+term.replace(/[^\w.-]/g,' ')+' in:name');
    const r=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw Error(String(r.status));
    const data=await r.json();if(sourceGeneration!==request||!container.isConnected)return;
    const items=data.items.filter(r=>r.owner.login.toLowerCase()==='zephyrproject-rtos').map(r=>({name:r.name,url:r.clone_url,revision:r.default_branch,kind:'official'}));
    onlineResults={term:term.toLowerCase(),items};
    sourceMessage(tr('在线搜索 · Zephyr 官方仓库 · '+items.length+' 项','Online · Zephyr repositories · '+items.length));
    container.innerHTML=localResults();
  }catch(e){if(request===sourceGeneration&&container.isConnected)sourceMessage(tr('在线搜索失败：','Online search failed: ')+e.message);}
}
function chooseCandidate(entry){
  if(!entry)return;
  if(entry.kind==='manifest')return registerModule(entry);
  previewSource('official',entry.url,entry,true);
}
function registerModule(entry) {
  if(globalThis.zephyrModules)return zephyrModules.add(entry);
  const items=currentModules(), name=entry.name, path=entry.path;
  if(!/^[\w.-]+$/.test(name)||['.','..'].includes(name)||!path||/[;"\r\n]/.test(path))return sourceMessage('请核对模块名称与目录，目录不能包含引号、分号或换行。');
  if(entry.kind!=='local'&&!entry.revision)return sourceMessage('请指定目标 revision。');
  const existing=items.find(m=>m[0].toLowerCase()===name.toLowerCase());
  if(existing){
    if(entry.kind!=='manifest'||existing[2]!==entry.revision||entry.label!==(workspaceState()?.repo+'/'+workspaceState()?.manifest)||existing[5]&&existing[5].kind!=='workspace')
      return sourceMessage('当前列表已有同名项目，请核对其来源和版本。');
    existing[4]=true;
  }else items.push([name,sourceNames[entry.kind]+(entry.label?' · '+entry.label:''),entry.revision||'本地检出',entry.kind==='local'?(entry.evidence?'本地已识别':'待本机验证'):entry.status||'未下载',true,entry]);
  query='';invalidate();commitDemo();notify('已加入当前模块列表');
}
function originAction(action,value) {
  if(action==='originlookup')return searchOfficial();
  if(action==='originpick')return chooseCandidate(sourceCandidates[Number(value)]);
  if(action==='originfolder')return globalThis.zephyrModules?zephyrModules.folder():$('#module-folder').click();
  if(action==='origincancel'){query='';return render();}
  if(action==='originonline'){onlineInspection=true;$('[data-act="originonline"]').remove();return detectSource();}
  if(action==='origininfo'){
    const m=currentModules().find(m=>m[0]===value);
    if(globalThis.zephyrModules)return zephyrModules.info(m);
    $('#filter').value=ZephyrPathDisplay.path(m[5].path);query=m[5].path;previewSource('local',m[5].path);
    const apply=$('[data-act="originadd"]');apply.dataset.act='originverify:'+value;apply.textContent='确认识别结果';apply.disabled=false;return;
  }
  if(action==='originverify'){
    const m=currentModules().find(m=>m[0]===value);
    if(!recognized||recognized.key!==sourceKey()||m[5].path!==inputValue('#origin-path')||recognized.name!==m[0])return sourceMessage('请选择与引用路径对应的模块目录。');
    m[3]='本地已识别';query='';invalidate();return commitDemo();
  }
  if(action==='originadd'){
    if(!recognized||recognized.key!==sourceKey())return sourceMessage('请先识别该来源。');
    const {name,evidence,sha,revision,url,subdir}=recognized;
    const checkout=inputValue('#origin-path'),path=subdir?checkout.replace(/[\\/]+$/,'')+'/'+subdir:checkout;
    return registerModule({name,evidence,sha,path,checkout,subdir,url,kind:sourceTab,revision:revision==='HEAD'?sha:revision||sha||''});

  }
}
document.addEventListener('change',e=>{if(e.target.id==='workspace-manifest-file')readWorkspaceManifest(e.target.files[0]);});
let addressTimer;
document.addEventListener('input',e=>{
  if(e.target.id!=='filter')return;
  query=e.target.value;onlineResults=undefined;moduleLists.available.reset();clearTimeout(addressTimer);clearImport();
  $('#candidates').innerHTML=localResults();
  const field=e.target,term=query.trim(),generation=sourceGeneration;
  if(sourceKind(term))addressTimer=setTimeout(()=>{
    if(field.isConnected&&sourceGeneration===generation)processAddress(term);
  },e.inputType==='insertFromPaste'?0:650);
});
document.addEventListener('keydown',e=>{
  if(e.target.id==='filter'&&e.key==='Enter'){
    e.preventDefault();clearTimeout(addressTimer);const term=e.target.value.trim();
    if(sourceKind(term))processAddress(term);
  }
});




let syncPlan;
const isSha=s=>/^[a-f\d]{40}$/i.test(s||'');
const shortCommit=s=>isSha(s)?s.slice(0,10):s;
function checkoutState(module){
  const [, ,revision,status,,meta,state]=module;
  const required=isSha(revision)?revision:state?.required||meta?.sha;
  const head=state?.head||(status==='已同步'?required:undefined);
  return {required,head,objects:state?.objects||(head?[head]:[])};
}
function openSyncPlan(modules,whole=false){
  if(!modules.length)return notify('没有需要同步的仓库。');
  syncPlan={workspace:model.activeWs,app:appKey(),method:model.method,whole,network:!model.env.offline,rows:modules.map(m=>{
    const state=checkoutState(m),meta=m[5];
    const url=meta?.url||(!meta&&initial.modules.some(i=>i[0]===m[0])?'https://github.com/zephyrproject-rtos/'+m[0]+'.git':'');
    return {name:m[0],ref:m[2],source:!meta||['workspace','manifest'].includes(meta.kind)?'west 清单':'添加模块时指定',
      url,state,status:m[3],mode:'project',branch:'',target:isSha(m[2])||model.env.offline?state.required:undefined,request:0};
  })};showSyncPlan();
}
function syncComparison(p){
  if(p.outcome?.status==='failed')return tr('同步失败 · ','Sync failed · ')+p.outcome.message;
  if(p.outcome?.status==='pending')return tr('待重试 · 本次尚未执行','Pending retry · not attempted');
  if(p.outcome?.status==='complete')return tr('同步完成','Sync complete');
  if(p.error)return p.error;
  if(p.busy)return tr('正在解析版本…','Resolving revision…');
  if(!p.target)return p.mode==='latest'?tr('待查询分支尖端','Check branch tip'):tr('待解析工程要求','Resolve project requirement');
  if(p.target===p.state.head)return tr('已在目标提交','Already at target commit');
  const temporary=p.mode==='latest'&&p.state.required!==p.target;
  const relation=temporary?(p.state.required?'将使用临时版本，工程要求保留':'与工程要求的关系待核对'):tr('将同步到此提交','Will sync to this commit');
  return !syncPlan.network&&!p.state.objects.includes(p.target)?relation+' · 离线缺少目标对象':relation;
}
const commitHtml=(sha,empty)=>sha?'<code title="'+esc(sha)+'">'+esc(shortCommit(sha))+'</code>':'<small>'+empty+'</small>';
function syncRow(p,i){
  const latest=p.mode==='latest';
  const branch=latest?'<label>'+tr('比较分支','Compare branch')+'<input class="input" data-sync-branch="'+i+'" placeholder="'+tr('远端默认分支','Remote default branch')+'" value="'+esc(p.branch)+'"></label>':'';
  const controls='<div class="sync-options"><label>'+tr('同步方式','Sync policy')+'<select data-sync-mode="'+i+'"><option value="project">'+tr('按工程要求','Project requirement')+'</option><option value="latest"'+(latest?' selected':'')+'>'+tr('按分支最新','Latest on branch')+'</option></select></label>'+branch+
    ((!isSha(p.ref)||latest)?b(tr('联网检查','Check remote'),'syncplancheck:'+i,'','',p.busy):'')+'</div>';
  return '<section class="sync-row"><div class="sync-name"><strong>'+esc(p.name)+'</strong><small>'+esc(p.source)+'</small></div>'+
    '<dl class="sync-refs"><div><dt>'+tr('工程要求','Project requirement')+'</dt><dd title="'+esc(p.ref)+'">'+esc(shortCommit(p.ref))+
    (!isSha(p.ref)&&p.state.required?' <small>已知提交</small> '+commitHtml(p.state.required,''):'')+'</dd></div><div><dt>'+tr('本地检出','Local checkout')+'</dt><dd>'+commitHtml(p.state.head,p.status==='未下载'?'未下载':tr('尚无提交记录','No checkout'))+'</dd></div><div><dt>'+tr('本次目标','Sync target')+'</dt><dd>'+commitHtml(p.target,tr('待确定','Pending'))+'</dd></div></dl>'+
    controls+'<small data-sync-status="'+i+'" role="status">'+esc(syncComparison(p))+(p.checked?' · '+esc(p.checked):'')+'</small></section>';
}
function canApplyPlan(){
  return !syncPlan.applying&&syncPlan.rows.every(p=>p.target&&!p.busy&&!p.error&&(syncPlan.network||p.state.objects.includes(p.target)))&&
    syncPlan.rows.some(p=>p.target!==p.state.head);
}
function syncButtonLabel(){
  if(syncPlan.applying)return tr('正在同步…','Syncing…');
  if(syncPlan.message||syncPlan.rows.some(p=>p.outcome&&p.outcome.status!=='complete'))return tr('重试未完成项','Retry unfinished');
  return globalThis.zephyrModules?tr('同步','Sync'):'模拟同步';
}
function showSyncPlan(){
  const rows=syncPlan.rows;
  show(tr('确认同步','Review sync'), '<div class="sync-list">'+rows.map(syncRow).join('')+'</div>'+
    '<label class="sync-network"><input type="checkbox" id="sync-network"'+(syncPlan.network?' checked':'')+'>'+tr('允许本次联网获取缺失版本','Allow network access to fetch missing commits')+'</label>'+
    '<small>'+tr('“分支最新”取检查时的提交。确认后按该提交'+(globalThis.zephyrModules?'同步':'模拟同步')+'，工程声明保留原值。','Branch latest uses the commit found at check time. Sync keeps the project requirement intact.')+'</small>'+
    (syncPlan.message?'<p role="alert">'+esc(syncPlan.message)+'</p>':'')+
    b(syncButtonLabel()+'（'+rows.filter(p=>p.target&&p.target!==p.state.head).length+'）','syncplanapply','primary','',!canApplyPlan()));
  if(syncPlan.applying)$('#dialog-body').querySelectorAll('input,select,button').forEach(control=>control.disabled=true);
}
async function resolveTarget(p){
  if(!p.url)throw Error('清单缺少仓库地址，无法查询。');
  if(globalThis.zephyrModules)return zephyrModules.resolve(p);
  const repo=repositoryLink(p.url),latest=p.mode==='latest';
  if(repo.slug&&/^https?:/.test(p.url)){
    try{
      let ref=latest?p.branch:p.ref;
      if(latest&&!ref)ref=(await providerJson(repo,''))?.default_branch;
      if(ref){
        const result=await providerJson(repo,(latest?'/branches/':'/commits/')+encodeURIComponent(ref));
        const sha=latest?result?.commit?.sha:result?.sha;
        if(isSha(sha))return {sha,ref};
      }
    }catch(error){if(location.hostname!=='127.0.0.1')throw error;}
  }
  if(location.hostname!=='127.0.0.1')throw Error('版本无法访问，可在本机预览中使用 Git 凭据检查。');
  const revision=latest?(p.branch?'refs/heads/'+p.branch:'HEAD'):p.ref;
  const r=await fetch('/inspect',{method:'POST',headers:{'Content-Type':'application/json','X-Zephyr-Preview':'inspect'},
    body:JSON.stringify({kind:'git',location:repo.url,revision})});
  const result=await r.json();
  if(!r.ok||!isSha(result.sha))throw Error(result.error||'远端版本不可用。');
  return {sha:result.sha,ref:latest?p.branch||'HEAD':p.ref};
}
async function checkSyncTarget(p){
  const active=syncPlan,request=++p.request;
  p.busy=true;p.error='';p.outcome=undefined;p.target=undefined;p.checked='';showSyncPlan();
  try{
    const {sha,ref}=await resolveTarget(p);
    if(active!==syncPlan||p.request!==request)return;
    p.target=sha;if(p.mode==='project')p.state.required=sha;
    p.checked=ref+' · '+new Date().toLocaleTimeString();
  }catch(error){if(p.request===request)p.error=error.message;}
  finally{if(active===syncPlan&&p.request===request&&$('#dialog').open){p.busy=false;showSyncPlan();}}
}
function applySyncPlan(){
  if(!canApplyPlan())return;
  if(globalThis.zephyrModules)return zephyrModules.apply(syncPlan);
  const {workspace,app,method,whole,rows}=syncPlan;
  const current=whole?workspaceState()?.mods||[]:currentModules();
  const targets=rows.map(p=>current.find(m=>m[0]===p.name));
  if(workspace!==model.activeWs||app!==appKey()||method!==model.method||rows.some((p,i)=>{
    const m=targets[i];return !m||m[2]!==p.ref||checkoutState(m).head!==p.state.head||m[3]!==p.status;
  })){ $('#dialog').close();return notify('工程或检出状态已改变，请重新预览同步。');}
  rows.forEach((p,i)=>{
    const m=targets[i],required=p.state.required;
    m[6]={head:p.target,required,objects:[...new Set([...p.state.objects,p.target])]};
    m[3]=p.mode==='latest'&&p.target!==required?'临时版本':'已同步';
  });
  if(whole)workspaceState().last='已按预览提交完成示例同步';
  $('#dialog').close();invalidate();commitDemo();notify('示例检出已更新，工程要求已保留。');
}
function syncPlanAction(action,index){
  if(action==='syncplancheck')return checkSyncTarget(syncPlan.rows[index]);
  if(action==='syncplanapply')return applySyncPlan();
}
document.addEventListener('change',e=>{
  if(!syncPlan)return;
  if(e.target.id==='sync-network'){syncPlan.network=e.target.checked;showSyncPlan();return;}
  if(e.target.dataset.syncMode===undefined)return;
  const p=syncPlan.rows[Number(e.target.dataset.syncMode)];
  p.mode=e.target.value;p.request++;p.busy=false;p.error='';p.checked='';p.outcome=undefined;
  p.target=p.mode==='project'&&(isSha(p.ref)||!syncPlan.network)?p.state.required:undefined;
  showSyncPlan();
});
document.addEventListener('input',e=>{
  if(e.target.dataset.syncBranch===undefined)return;
  const i=Number(e.target.dataset.syncBranch),p=syncPlan.rows[i];
  p.branch=e.target.value.trim();p.target=undefined;p.request++;p.error='';p.busy=false;p.checked='';p.outcome=undefined;
  $('[data-sync-status="'+i+'"]').textContent=syncComparison(p);
  $('[data-act="syncplancheck:'+i+'"]').disabled=false;$('[data-act="syncplanapply"]').disabled=true;
});
document.addEventListener('close',e=>{if(e.target.id==='dialog'&&!e.target.open)syncPlan=null;},true);





