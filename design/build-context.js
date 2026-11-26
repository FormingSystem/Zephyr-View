'use strict';
const tr=(cn,en)=>document.documentElement.lang.startsWith('zh')?cn:en;
const paths={locate:'M12 2v4m0 12v4M2 12h4m12 0h4 M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0z M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',fit:'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5 M7 8h10v8H7z',workspace:'M2 6h8l2 3h10v11H2z',build:'M3 5h18v13H3z M8 22h8 M9 9l3 3-3 3',graph:'M3 9h5v5H3z M16 3h5v5h-5z M16 16h5v5h-5z M8 12h4V5h4 M12 12v6h4',modules:'m12 2 9 5v10l-9 5-9-5V7z M3 7l9 5 9-5 M12 12v10',tools:'M3 6h18 M3 12h18 M3 18h18 M8 3v6 M16 9v6 M9 15v6',theme:'M12 3a9 9 0 100 18 9 9 0 000-18z M12 3v18',play:'m7 4 12 8-12 8z',file:'M5 2h9l5 5v15H5z M14 2v6h5 M8 13h8 M8 16h6',folder:'M2 6h8l2 3h10v11H2z',external:'M13 3h8v8 M21 3l-11 11 M10 5H4v15h15v-6',refresh:'M20 9a8 8 0 10.1 6 M20 4v5h-5'};
const ico=k=>'<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="'+paths[k]+'"/></svg>';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const b=(label,a,kind='',icon='',disabled=false)=>'<button data-act="'+esc(a)+'" class="'+kind+'"'+(disabled?' disabled':'')+'>'+(icon?ico(icon):'')+esc(label)+'</button>';
const badge=(s,c='')=>'<span class="badge '+c+'">'+esc(s)+'</span>';
const panel=(t,body,side='',foot='')=>'<section class="panel"><div class="ph"><h2>'+t+'</h2>'+side+'</div>'+body+(foot?'<div class="sectionfoot">'+foot+'</div>':'')+'</section>';
const wrap=s=>'<div class="body">'+s+'</div>';
const row=(label,value,a,action='更改')=>'<div class="row"><span>'+label+'</span><code>'+esc(value)+'</code>'+(a?b(action,a,'plain'):'')+'</div>';
function targetFields(rowsHtml) {
  return '<div class="target-fields">'+rowsHtml+'</div>';
}

function targetFieldRow(label, value, display, buttonsHtml) {
  const parts=label.match(/^(.*?)(\s*·\s*-[SB])$/);
  const caption=parts?esc(parts[1])+' <span class="target-flag">'+esc(parts[2].trim())+'</span>':esc(label);
  return '<div class="target-field"><span class="target-label">'+caption+'</span>'+
    '<code title="'+esc(ZephyrPathDisplay.path(value)||'')+'">'+esc(ZephyrPathDisplay.path(display)||'—')+'</code>'+
    '<span class="target-controls">'+buttonsHtml+'</span></div>';
}

function boardFileStatus(board, tree) {
  if (tree.boardFile) return tree.boardSource === 'detected'
    ? tr('按板目标识别','Detected from board') : tr('构建已确认','Confirmed by build');
  if (!board) return tr('选择开发板后自动识别。','Choose a board to detect its devicetree.');
  switch (tree.detectionStatus) {
    case 'ambiguous': return tr('找到多个匹配，配置后查看实际来源。','Several files match. Configure to confirm the source.');
    case 'notFound': return tr('在当前板目录中未找到匹配的 DTS。','No matching DTS found in the current board directories.');
    case 'unavailable': return tr('板定义暂不可用，请检查工作区的 Zephyr 源码或板目录。','Board definitions are unavailable. Check the Zephyr source and board directories.');
    default: return tr('运行配置以确认此目标的 DTS。','Configure to confirm the DTS for this target.');
  }
}
function devicetreeLink(path, display = path) {
  return '<button class="plain dts-file" data-devicetree-path="'+esc(path)+'" title="'+esc(ZephyrPathDisplay.path(path))+'">'+
    ico('file')+'<code>'+esc(ZephyrPathDisplay.path(display))+'</code></button>';
}
function boardDevicetreeRow(board, tree = {}) {
  const file = tree.boardFile;
  const status = esc(boardFileStatus(board, tree));
  const shortPath = ZephyrPathDisplay.path(file)?.match(/(?:^|\/)(boards\/.*)$/)?.[1] || file;
  const details = (tree.generatedFile || tree.overlays?.length) ?
    '<details class="target-tree-details"><summary>'+tr('覆盖文件与合并结果','Overlays and merged output')+'</summary>'+
    '<dl class="devicetree-sources">'+devicetreeBuildOutputs(tree)+'</dl></details>' : '';
  return '<div class="target-field target-tree"><span class="target-label">'+tr('板级设备树','Board devicetree')+
    '</span><div class="target-tree-value">'+(file?devicetreeLink(file,shortPath):'')+'<small>'+status+'</small>'+details+'</div></div>';
}
function devicetreeSourceRow(label, path, note) {
  const value = (path ? devicetreeLink(path) : '') + (note ? '<small>'+esc(note)+'</small>' : '');
  return '<div><dt>'+esc(label)+'</dt><dd>'+value+'</dd></div>';
}
function devicetreeSources(board, tree = {}) {
  const base=devicetreeSourceRow(tr('基础 DTS · BOARD','Board DTS · BOARD'),tree.boardFile,boardFileStatus(board,tree));
  return '<dl class="devicetree-sources">'+base+devicetreeBuildOutputs(tree)+'</dl>';
}
function devicetreeBuildOutputs({overlays,generatedFile}) {
  const overlay = tr('生效的覆盖文件','Applied overlays');
  const applied = overlays?.length ? overlays.map((path,i)=>devicetreeSourceRow(overlay+' '+(i+1),path)).join('') :
    devicetreeSourceRow(overlay, null, overlays ? tr('本次配置未使用覆盖文件。','This configuration uses no overlays.') :
      tr('可选。实际使用的文件以 Zephyr 配置记录为准。','Optional. Zephyr’s configuration record identifies the files used.'));
  const merged = devicetreeSourceRow(tr('最终设备树','Merged devicetree'), generatedFile, generatedFile ? '' :
    tr('配置成功后可查看 zephyr.dts。','Configure successfully to inspect zephyr.dts.'));
  return applied+merged;
}

function buildMethodRow(method, disabled=false) {
  const label=tr('构建方式','Build method');
  const choices=['west','CMake'].map(value=>'<button type="button" data-act="method:'+value+
    '" aria-pressed="'+(value===method)+'"'+(disabled?' disabled':'')+'>'+value+'</button>').join('');
  return '<div class="build-method"><strong>'+label+'</strong><div class="tabs" role="group" aria-label="'+
    label+'">'+choices+'</div></div>';
}

function buildMethodHint(method) {
  return method==='west' ?
    tr('west 使用工作区中的 Zephyr 构建命令，调用 CMake 配置应用与开发板。',
       'west uses the workspace’s Zephyr build command to configure the application and board with CMake.') :
    tr('使用本机工具链配置并构建所选应用，支持离线使用。',
       'Configure and build the application with a local toolchain, including offline.');
}

function buildStatusLine(method, configureCount, buildCount) {
  const stage=(ready,pending,count)=>count?pending+' ('+count+')':ready;
  const configure=stage(tr('可配置','Ready to configure'),tr('配置待补','Configure prerequisites'),configureCount);
  const build=stage(tr('可构建','Ready to build'),tr('构建待补','Build prerequisites'),buildCount);
  return '<span class="build-status-line" role="status"><strong>'+esc(method)+'</strong><span>'+configure+
    '</span><span>'+build+'</span></span>';
}

const file=(name,sub,a,action='查看')=>'<div class="listrow"><span class="fileicon">'+ico('file')+'</span><div><strong class="mono">'+esc(name)+'</strong><small>'+esc(sub)+'</small></div>'+b(action,a,'plain')+'</div>';
const heading=(crumb,title,sub,buttons)=>'<div class="crumb">'+ico('folder')+esc(crumb)+'</div><div class="titleline"><div><h1>'+esc(title)+'</h1><p class="subtitle">'+esc(sub)+'</p></div><div class="actions">'+buttons+'</div></div>';


const methodName = () => model.method;
function renderContext() {
  const button=$('#build-context');
  button.textContent='构建 · '+methodName();
  button.title='当前构建入口：'+methodName()+' · '+(model.env.offline?'离线':'允许联网')+'。点击切换。';
  button.setAttribute('aria-label',button.title);
}
function modePicker() {
  show('当前构建入口',row('应用',ZephyrPathDisplay.path(appKey()))+
    '<div class="choice">'+['west','CMake'].map(m=>b((m===model.method?'✓ ':'')+(m==='west'?'west · 工作区构建':'CMake · 独立工程'),'contextchoose:'+m)).join('')+'</div><small>切换入口会使旧构建结果失效。是否允许联网由来源策略单独控制。</small>');
}
function contextAction(action,value) {
  if(action==='context')return modePicker();
  if(action==='contextchoose'){
    if(value!==model.method){model.method=value;invalidate();}
    $('#dialog').close();return commitDemo();
  }
  if(action==='contextsetup')return setupPreview();
  if(action==='contextapply')return applySetup();
}
function environmentField(name,value,source,controls='',status='',description=''){
  const note=[description,source].filter(Boolean).map(esc).join(' · ');
  return '<div class="environment-field"><div class="environment-caption"><strong>'+esc(name)+'</strong>'+status+
    '<small>'+note+'</small>'+controls+'</div><code class="environment-value">'+esc(ZephyrPathDisplay.variable(name,value))+'</code></div>';
}
function workspaceSection(id,title,actions,content){
  return '<section class="workspace-section" id="'+id+'" aria-labelledby="'+id+'-title"><div class="workspace-section-title"><h2 id="'+id+'-title">'+esc(title)+'</h2><div class="actions">'+actions+'</div></div>'+content+'</section>';
}
function environmentSections(groups,tools,variables,extra=''){
  return '<div class="envlayout">'+groups+tools+variables+extra+'</div>';
}
function setupPreview() {
  const west=model.method==='west', w=workspaceState(),offline=model.env.offline;
  const strategy=west?(offline?'使用已有本地清单与已缓存模块':'按清单 revision 获取模块'):'从本机源码、工具链和模块目录配置应用';
  let steps=west?['检查主机工具和 Python 环境',w?'复用 '+ZephyrPathDisplay.path(w.name)+' / '+ZephyrPathDisplay.path(w.repo+'/'+w.manifest):'west init -l <本地清单仓库>',
    offline?'检查本地 Git 对象和模块目录；缺失时列出缺项':'west update','west build -b '+model.board+' '+appKey()]:
    ['检查 CMake、Ninja、Python 和本地工具链','解析 ZEPHYR_BASE 与已选模块的绝对目录','cmake -S '+appKey()+' -B '+dir()+' -DBOARD='+model.board+' -G Ninja','cmake --build '+dir()];
  const options=west&&!w?locationInput('bootstrap-root','新建的示例工作区根目录','zephyr-workspace'):'';
  show(west?'west 一键搭建':'本地 CMake 工程搭建',row('应用',ZephyrPathDisplay.path(appKey()))+row('模块准备策略',strategy)+options+
    '<ol class="setup-steps">'+steps.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ol><small>演示仅准备当前入口。自定义路径和缺失组件将保留待验证状态。</small>'+
    b('应用示例方案','contextapply','primary')+'<small id="source-message" role="status"></small>');
}
function applySetup() {
  const west=model.method==='west',root=$('#bootstrap-root')?.value.trim();
  if(west&&!workspaceState()){
    if(!root||Object.hasOwn(model.workspaces,root)||['__proto__','constructor','prototype'].includes(root))return sourceMessage('请选择新的示例工作区目录。');
    model.workspaces[root]=workspaceFixture(root);
    model.activeWs=root;
  }
  for(const [key,,,source] of toolSpecs){
    if(!needed(key)||settingsFor(key).source)continue;
    if(key==='SDK'&&activeVariant()!=='zephyr')continue;
    settingRecord(key,{source,ok:true});
  }
  const pending=currentModules().filter(m=>m[4]&&m[3]!=='已同步');
  if(west&&!model.env.offline)pending.filter(m=>!m[5]).forEach(m=>m[3]='已同步');
  invalidate();model.env.report=methodName()+' · 示例方案已应用。'+(pending.some(m=>m[3]!=='已同步')?'部分模块仍待提供或验证。':'可检查环境并配置应用。');
  $('#dialog').close();commitDemo();notify(model.env.report);
}

function createTargetPicker(adapter){
  let serial=0,open;
  function close(focus=false){
    if(!open)return;
    open.box.remove();open.button.setAttribute('aria-expanded','false');
    if(focus)open.button.focus();
    open=undefined;
  }
  function update(){
    const {term,list,status,items,error,kind}=open;
    if(open.customBoard){
      const name=term.value.trim();
      open.customBoard.disabled=!name;
    }
    if(!items){status.textContent=error||tr('正在发现候选项…','Discovering choices…');return;}
    const display=value=>kind==='board'?value:ZephyrPathDisplay.path(value);
    const caption=value=>kind==='board'?value:ZephyrPathDisplay.directory(value,open.root);
    const q=display(term.value.trim()).toLowerCase();
    const matches=items.filter(v=>fuzzy(display(v).toLowerCase(),q) || fuzzy(caption(v).toLowerCase(),q));
    status.textContent=matches.length?tr('匹配 ','Matches · ')+matches.length:tr('没有匹配项','No matches');
    const displayed=matches.slice(0,open.limit);
    list.replaceChildren(...displayed.map(v=>{
      const path=display(v),label=caption(v);
      const b=document.createElement('button');b.type='button';b.title=path;
      b.textContent=kind==='board'||label!==path?label:path.split('/').pop()||path;
      if(kind!=='board' && path!=='.' && path!=='./'){const small=document.createElement('small');small.textContent=path;b.append(small);}
      b.onclick=()=>{close(true);adapter.select(kind,v);};return b;
    }));
    open.more.hidden=matches.length<=displayed.length;
    if(!open.more.hidden)status.textContent+=' · '+tr('已显示 ','Showing ')+displayed.length;
    if(open.restored){
      const saved=open.restored;
      open.restored=undefined;
      list.scrollTop=saved.scroll;
      if(saved.focus && open.box.contains(document.activeElement)){
        [...list.children].find(button=>button.title===saved.focus)?.focus({preventScroll:true});
      }
    }
  }
  function show(kind,button){
    if(open?.button===button){close(true);return;}
    close();
    const request=++serial,box=document.createElement('section');box.className='target-picker';
    const title={board:tr('搜索开发板、SoC、CPU，或输入完整 BOARD','Search boards, SoCs and CPUs, or enter a full BOARD target'),app:tr('应用名称或路径','Application name or path'),build:tr('构建目录','Build directory')}[kind];
    box.innerHTML='<div class="picker-bar"><input class="input" type="search" placeholder="'+esc(title)+'" aria-label="'+esc(title)+'"><button type="button" class="picker-close" aria-label="'+tr('关闭','Close')+'">×</button></div><small role="status"></small><div class="picker-results"></div>';
    const anchor=button.closest('.target-field,.studio-target,.row')||button;
    anchor.after(box);button.setAttribute('aria-expanded','true');
    open={request,box,button,kind,root:kind!=='board' && adapter.directoryRoot?.(),term:box.querySelector('input'),status:box.querySelector('[role=status]'),list:box.querySelector('.picker-results')};
    open.limit=100;open.more=document.createElement('button');open.more.type='button';open.more.hidden=true;
    open.more.textContent=tr('显示更多','Show more');
    open.more.onclick=()=>{
      const next=open.list.childElementCount;open.limit+=100;update();open.list.children[next]?.focus();
    };
    box.append(open.more);
    if(kind==='board' && adapter.boardChoice){
      const choose=value=>{close(true);adapter.boardChoice(value);};
      const custom=document.createElement('button');
      custom.type='button';
      custom.onclick=()=>choose(open.term.value.trim());
      custom.textContent=tr('使用此 BOARD','Use this BOARD');
      custom.title=tr('配置时由 Zephyr 解析别名、修订和限定目标','Zephyr resolves aliases, revisions and qualifiers during configure');
      open.customBoard=custom;
      const project=document.createElement('button');
      project.type='button';
      project.textContent=tr('使用工程设置','Use project settings');
      project.title=tr('沿用工程、环境或构建目录中的 BOARD','Use the BOARD from the project, environment or build directory');
      project.onclick=()=>choose(null);
      box.querySelector('.picker-bar').insertBefore(custom,box.querySelector('.picker-close'));
      box.append(project);
      if(adapter.boardRoot){
        const root=document.createElement('button');
        root.type='button';root.textContent=tr('添加板卡搜索目录…','Add board root…');
        root.onclick=adapter.boardRoot;
        box.append(root);
      }
    }
    const browse=document.createElement('button');browse.textContent=kind==='board'?tr('指定 Zephyr 源码目录…','Locate Zephyr source…'):tr('浏览本地目录…','Browse folders…');
    browse.onclick=()=>{adapter.browse(kind);};
    if(adapter.browse)box.append(browse);box.querySelector('.picker-close').onclick=()=>close(true);open.term.oninput=()=>{open.restored=undefined;open.limit=100;update();};
    box.onkeydown=e=>{
      if(e.key==='Escape'){e.preventDefault();close(true);return;}
      const nodes=[open.term,...open.list.children];
      if(open.customBoard && !open.customBoard.disabled)nodes.push(open.customBoard);
      const idx=nodes.indexOf(document.activeElement);
      if(idx<0)return;
      if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();nodes[Math.max(0,Math.min(nodes.length-1,idx+(e.key==='ArrowDown'?1:-1)))].focus();}
      if(e.key==='Enter'&&idx===0){e.preventDefault();nodes[1]?.click();}
    };
    update();open.term.focus();adapter.load(kind,request);
  }
  function results(data){
    if(!open||data?.picker!==open.request)return;
    open.items=data.items;open.error=data.error;update();
    open.box.querySelector('.discovery-diagnostics')?.remove();
    if(adapter.diagnostics && data.diagnostics?.length){
      open.status.insertAdjacentHTML('afterend',adapter.diagnostics(data.diagnostics));
    }
  }
  function snapshot(){
    if(!open)return;
    return {action:open.button.dataset.act,term:open.term.value,limit:open.limit,scroll:open.list.scrollTop,
      focus:open.list.contains(document.activeElement)?document.activeElement.title:undefined};
  }
  function restoreInput(saved){
    if(!open||saved.action!==open.button.dataset.act)return;
    open.term.value=saved.term;open.limit=saved.limit;open.restored=saved;update();
  }
  return {show,close,results,snapshot,restoreInput};
}
