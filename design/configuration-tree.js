'use strict';

/** Build the navigable hierarchy from one application / board / build snapshot. */
function configurationTreeModel(state, translate=tr) {
  const leaf=(id,label,detail='',action)=>({id,label,detail,action,children:[]});
  const branch=(id,label,detail,children,action)=>({...leaf(id,label,detail,action),children});
  const pathDisplay=globalThis.ZephyrPathDisplay ?? require('./pathDisplay');
  const displayPath=pathDisplay.path;
  const fileName=file=>file && displayPath(file).split('/').pop() || '—';
  const source=(path,role)=>leaf('source:'+path,fileName(path),role,{kind:'source',path});
  const t=translate,tree=state.devicetree||{};
  function file_group(kind,label) {
    const group=state.configurationFiles?.[kind];
    return group ? [leaf('inputs:'+kind,label,group.files.map(fileName).join(' · ') || group.variable,
      {kind:'inputGroup',group:kind})] : [];
  }
  function catalogStatus(source){
    if(source==='restricted'||state.trusted===false)return t('信任工作区后可读取','Trust the workspace to inspect');
    if(source==='unavailable')return t('当前构建缺少可用记录','Unavailable in this build');
    return t('配置当前目标后可读取','Configure the target to inspect');
  }
  function kconfigBranch() {
    const root=branch('kconfig',t('Kconfig 软件配置','Kconfig'),t('软件选项','Software options'),[],{kind:'kconfig'});
    root.children.push(...file_group('kconfig',t('应用配置文件','Application configuration files')));
    const branches=new Map(),symbols=state.symbols?.items||[];
    for(const item of symbols){
      const paths=item.menuPaths?.length?item.menuPaths:[item.menuPath||item.menu?.split(' › ')||[]];
      for(const path of paths){
        let parent=root;
        for(const [index,part] of path.entries()){
          const id='menu:'+JSON.stringify(path.slice(0,index+1));
          if(!branches.has(id)){
            const group=branch(id,part,'',[]);branches.set(id,group);parent.children.push(group);
          }
          parent=branches.get(id);
        }
        parent.children.push(leaf('symbol:'+JSON.stringify([parent.id,item.name]),item.name,
          [item.prompt,item.value].filter(value=>value!==undefined).join(' · '),{kind:'symbol',item}));
      }
    }
    root.detail=symbols.length?t('可选符号 ','Available symbols · ')+symbols.length:catalogStatus(state.symbols?.source);
    return root;
  }
  function deviceBranch() {
    const sources=[];
    if(tree.boardFile)sources.push(source(tree.boardFile,t('板级 DTS','Board DTS')));
    for(const file of tree.overlays||[])sources.push(source(file,t('已应用覆盖','Applied overlay')));
    if(tree.generatedFile)sources.push(source(tree.generatedFile,t('最终设备树','Merged devicetree')));
    const records=tree.catalog?.nodes||[],roots=hardwareHierarchy(records);
    const content=[...file_group('dts',t('板级设备树','Board devicetree')),
      ...file_group('overlay',t('应用覆盖文件','Application overlays'))];
    if(sources.length)content.push(branch('device:sources',t('设备树来源','Devicetree sources'),String(sources.length),sources));
    if(roots.length)content.push(branch('device:hardware',t('硬件节点','Hardware nodes'),String(records.length),roots));
    return branch('device',t('设备树','Devicetree'),records.length?t('硬件节点 ','Hardware nodes · ')+records.length:
      catalogStatus(tree.catalog?.source),content,{kind:'device'});
  }
  function hardwareHierarchy(records) {
    const nodes=new Map(),roots=[];
    for(const record of records){
      const label=record.name||record.path.split('/').pop()||'/';
      nodes.set(record.path,branch('hardware:'+record.path,label,record.labels?.join(', ')||record.status,[],{kind:'hardware',record}));
    }
    for(const [path,node] of nodes){
      const parent=path!=='/' && nodes.get(path.slice(0,path.lastIndexOf('/'))||'/');
      (parent?parent.children:roots).push(node);
    }
    for(const node of nodes.values()){
      const {record}=node.action;
      const properties=(record.properties||[]).map(property=>leaf(
        'property:'+JSON.stringify([record.path,property.name]),property.name,property.value||property.type,
        {kind:'property',record,property}));
      if(!properties.length)continue;
      if(node.children.length)node.children.push(branch('properties:'+record.path,t('属性','Properties'),String(properties.length),properties));
      else node.children=properties;
    }
    return roots;
  }
  const target=(kind,title,value)=>leaf('target:'+kind,title,pathDisplay.directory(value,state.folder,t('当前目录','Current directory'))||'—',{kind:'target',target:kind});
  const [identifier,...qualifiers]=(state.board||'').split('/');
  const [boardName,revision]=identifier.split('@'),selectBoard={kind:'target',target:'board'};
  const boardParts=[leaf('board:name',t('板名','Board name'),boardName||'—',selectBoard)];
  if(revision)boardParts.push(leaf('board:revision',t('硬件修订版','Board revision'),revision,selectBoard));
  if(qualifiers.length)boardParts.push(leaf('board:qualifiers',t('目标限定符','Board qualifiers'),qualifiers.join('/'),selectBoard));
  const board=branch('board',t('开发板与 CPU','Board and CPU'),state.board||'BOARD',boardParts,selectBoard);
  const modules=(state.projects||[]).map(project=>{
    const chosen=state.selectedModules?.includes(project.name);
    const detail=[chosen===undefined?'':chosen?t('已勾选','Selected'):t('未勾选','Unselected'),project.revision||displayPath(project.path)].filter(Boolean).join(' · ');
    return leaf('module:'+project.name,project.name,detail,{kind:'module',project});
  });
  const manifestLabel=state.manifestScope==='partial'?t('导入清单未解析','Unresolved manifest imports'):
    state.manifest?fileName(state.manifest):t('工作区清单','Workspace manifest');
  const modulesBranch=branch('modules',t('west 模块','west modules'),manifestLabel,
    modules,{kind:'modules'});
  const build=branch('build',t('构建上下文','Build context'),state.method,
    [leaf('build:method',t('构建方式','Build method'),state.method,{kind:'method'}),
      target('build',t('构建目录','Build directory'),state.build),
      leaf('build:args',t('附加 CMake 参数','CMake definitions'),'-D',{kind:'arguments'})],{kind:'build'});
  return branch('project',fileName(state.app||state.folder),t('工程配置','Project configuration'),
    [target('app',t('应用目录','Application'),state.app),board,kconfigBranch(),deviceBranch(),modulesBranch,build],{kind:'target',target:'app'});
}

function configurationMapFitScale(width,height,treeWidth,treeHeight) {
  const inset=16;
  const ratio=(available,extent)=>Math.max(1,available-2*inset)/Math.max(1,extent);
  return Math.min(1,ratio(width,treeWidth),ratio(height,treeHeight));
}

function configurationSearchResults(index,term,pathDisplay) {
  const matches=[],pathTerm=pathDisplay.path(term);
  for(const {entry} of index.values()){
    const action=entry.action,record=action?.record;
    const file=action?.path||action?.project?.path||(['app','build'].includes(action?.target)?entry.detail:'');
    const fields=[entry.label,entry.detail];
    if(action?.kind==='hardware')fields.push(record.path,...(record.labels||[]),...(record.aliases||[]),...(record.compatible||[]));
    if(action?.kind==='property'&&term.includes(':'))fields.push(record.path+':'+entry.label);
    const fileMatches=file&&pathDisplay.path(file).toLowerCase().includes(pathTerm);
    if(fileMatches||fields.some(value=>value&&String(value).toLowerCase().includes(term)))matches.push(entry);
    if(matches.length===40)break;
  }
  return matches;
}

/** Size the scrollable sheet to the drawn tree while leaving a fixed panning margin around it. */
class ConfigurationMapViewport {
  constructor(stage, view, start, onMove) {
    this.stage=stage;
    this.content=stage.querySelector('.map-content');
    this.tree=this.content.firstElementChild;
    this.readout=stage.previousElementSibling.querySelector('[data-act="map:reset"]');
    this.view=view;
    this.onMove=onMove;
    this.resize();
    if(!view.fitted)stage.scrollTo(...start);
    const editor=stage.nextElementSibling;
    this.observer=new ResizeObserver(entries=>{
      if(!stage.isConnected)return this.disconnect();
      if(entries.some(entry=>entry.target!==editor))this.resize();
      else this.onMove();
    });
    this.observer.observe(stage);
    this.observer.observe(this.tree);
    this.observer.observe(editor);
    this.onOuterScroll=event=>{
      if(!editor.hidden && (event.target===document||event.target.contains?.(stage)) && event.target!==stage)this.onMove();
    };
    window.addEventListener('scroll',this.onOuterScroll,true);
  }

  disconnect(){
    this.observer.disconnect();
    window.removeEventListener('scroll',this.onOuterScroll,true);
  }

  resize() {
    if(this.view.fitted)return this.fit();
    this.setScale(this.view.scale);
    this.onMove();
  }

  fitScale() {
    return configurationMapFitScale(this.stage.clientWidth,this.stage.clientHeight,this.tree.offsetWidth,this.tree.offsetHeight);
  }

  setScale(scale) {
    this.view.scale=scale;
    this.tree.style.transform='scale('+scale+')';
    this.content.style.width=Math.ceil(this.tree.offsetWidth*scale)+'px';
    this.content.style.height=Math.ceil(this.tree.offsetHeight*scale)+'px';
    const percent=Math.round(scale*100);
    this.readout.textContent=percent?percent+'%':'<1%';
  }

  frame(element, horizontal=.5, vertical=.5) {
    const stage=this.stage, view=stage.getBoundingClientRect(), rect=element.getBoundingClientRect();
    stage.scrollBy(rect.left+rect.width/2-view.left-stage.clientLeft-stage.clientWidth*horizontal,
      rect.top+rect.height/2-view.top-stage.clientTop-stage.clientHeight*vertical);
    this.onMove();
  }

  fit() {
    this.view.fitted=true;
    this.setScale(this.fitScale());
    this.frame(this.tree);
  }

  locate(button) {
    this.view.fitted=false;
    if(this.view.scale<.75)this.setScale(1);
    this.frame(button);
  }

  zoomAt(scale,x=this.stage.clientWidth/2,y=this.stage.clientHeight/2) {
    // Keep the tree point at the pointer fixed across a zoom (including tiny overview scales).
    const stage=this.stage, origin=stage.getBoundingClientRect();
    const cursorX=origin.left+stage.clientLeft+x,cursorY=origin.top+stage.clientTop+y;
    const before=this.tree.getBoundingClientRect(),ratioX=(cursorX-before.left)/this.view.scale,
      ratioY=(cursorY-before.top)/this.view.scale;
    const min=Math.min(.5,this.fitScale());
    this.view.fitted=false;
    this.setScale(Math.max(min,Math.min(2.5,scale)));
    const after=this.tree.getBoundingClientRect();
    stage.scrollBy(after.left+ratioX*this.view.scale-cursorX,after.top+ratioY*this.view.scale-cursorY);
    this.onMove();
  }
}

function configurationMapTools(scale) {
  function control(action, label, content) {
    return '<button type="button" data-act="map:'+action+'" title="'+esc(label)+'" aria-label="'+esc(label)+'">'+content+'</button>';
  }
  return '<div class="tools" role="group" aria-label="'+tr('画布视图','Canvas view')+'">'+
    control('locate',tr('定位选中节点','Center selected node'),ico('locate'))+
    control('fit',tr('适应全图','Fit map to view'),ico('fit'))+
    control('out',tr('缩小','Zoom out'),'−')+
    control('reset',tr('还原为 100%','Reset zoom to 100%'),Math.round(scale*100)+'%')+
    control('in',tr('放大','Zoom in'),'+')+'</div>';
}

function createConfigurationTree(onOpen,restoredView) {
  const title=()=>tr('工程配置图','Project configuration map');
  const expanded=new Set(),index=new Map();
  let root,scope,stage,viewport,selected='project', offset, drag;
  const view={scale:1,fitted:true};
  function setData(state) {
    const key=JSON.stringify([state.folder,state.app,state.board,state.build]);
    if(scope!==key){
      scope=key;expanded.clear();expanded.add('project');expanded.add('board');
      offset=undefined;view.scale=1;view.fitted=true;selected='project';
      if(restoredView?.scope===key){
        expanded.clear();for(const id of restoredView.expanded)expanded.add(id);
        offset=restoredView.offset;view.scale=restoredView.scale||1;view.fitted=Boolean(restoredView.fitted);
        selected=restoredView.selected;restoredView=undefined;
      }
    }
    root=configurationTreeModel(state);
    index.clear();
    function visit(entry,parent,depth){
      index.set(entry.id,{entry,parent,depth});
      for(const child of entry.children)visit(child,entry.id,depth+1);
    }
    visit(root,null,1);
    if(!index.has(selected))selected='project';
  }
  function nodeMarkup(entry){
    const {depth}=index.get(entry.id),hasChildren=entry.children.length>0,open=expanded.has(entry.id);
    const action=entry.action||{},active=selected===entry.id;
    const attributes=(action.kind==='symbol'?' data-tree-symbol="'+esc(action.item.name)+'"':'')+
      (action.kind==='hardware'?' data-tree-path="'+esc(action.record.path)+'"':'');
    const mark=hasChildren?(open?'−':'+'):'·';
    return '<li role="none"><button type="button" role="treeitem" class="map-node" data-tree-id="'+esc(entry.id)+'"'+attributes+
      ' aria-level="'+depth+'" aria-selected="'+active+'" tabindex="'+(active?'0':'-1')+'"'+
      (hasChildren?' aria-expanded="'+open+'"':'')+' title="'+esc([entry.label,entry.detail].filter(Boolean).join(' · '))+'">'+
      '<span class="map-node-mark" aria-hidden="true">'+mark+'</span><span class="map-node-label"><strong>'+esc(entry.label)+'</strong>'+
      (entry.detail?'<small>'+esc(entry.detail)+'</small>':'')+'</span></button>'+
      (hasChildren&&open?childrenHtml(entry):'')+'</li>';
  }
  function childrenHtml(entry){return '<ul class="map-children" role="group">'+entry.children.map(nodeMarkup).join('')+'</ul>';}
  function markup(state){
    setData(state);
    return '<div class="config-map"><div class="map-toolbar"><label><input class="input" type="search" data-map-search placeholder="'+
      tr('查找符号、硬件或模块…','Find a symbol, device or module…')+'" aria-label="'+tr('搜索配置节点','Search configuration nodes')+'"></label>'+
      '<div class="map-search-results" hidden></div>'+configurationMapTools(view.scale)+'</div>'+
      '<div class="config-map-stage" aria-label="'+title()+'"><div class="map-sheet"><div class="map-content"><ul class="map-root" role="tree" aria-label="'+title()+'">'+
      nodeMarkup(root)+'</ul></div></div></div><div class="map-node-editor" role="dialog" hidden></div></div>';
  }
  function buttonFor(id){return stage.querySelector('[data-tree-id="'+CSS.escape(id)+'"]');}
  function select(button,focus=false){
    const old=buttonFor(selected);
    if(old){old.tabIndex=-1;old.setAttribute('aria-selected','false');}
    selected=button.dataset.treeId;button.tabIndex=0;button.setAttribute('aria-selected','true');
    if(focus)button.focus({preventScroll:true});
  }
  function toggle(button,open=!expanded.has(button.dataset.treeId)){
    const id=button.dataset.treeId,entry=index.get(id)?.entry;
    if(!entry?.children.length||open===expanded.has(id))return;
    view.fitted=false;
    if(open&&!expanded.has(id)){expanded.add(id);button.insertAdjacentHTML('afterend',childrenHtml(entry));}
    if(!open&&expanded.delete(id))button.nextElementSibling?.remove();
    button.setAttribute('aria-expanded',String(open));button.querySelector('.map-node-mark').textContent=open?'−':'+';
  }
  function activate(button){
    select(button,true);
    if(view.scale<.5)viewport.locate(button);
    const entry=index.get(button.dataset.treeId).entry;
    if(entry.action)onOpen(entry,button);
    else toggle(button,true);
  }
  function reveal(id,edit,frame=false){
    const parents=[];let record=index.get(id);
    if(!record)return false;
    while(record?.parent){parents.unshift(record.parent);record=index.get(record.parent);}
    for(const parent of parents)toggle(buttonFor(parent),true);
    const button=buttonFor(id);select(button,true);
    view.fitted=false;
    viewport.setScale(view.scale<.75?1:view.scale);
    if(frame)viewport.frame(button,.38,.45);
    else button.scrollIntoView({block:'nearest',inline:'nearest'});
    if(edit)activate(button);
    return true;
  }
  function route(id){
    if(!stage||!index.has(id))return;
    if(id==='device'&&index.has('hardware:/')){
      reveal('hardware:/',false);
      const button=buttonFor('hardware:/');
      toggle(button,true);viewport.frame(button,.25,.25);
      return;
    }
    reveal(id,false);toggle(buttonFor(id),true);
    const search=stage.previousElementSibling.querySelector('[data-map-search]');
    search.focus({preventScroll:true});search.scrollIntoView({block:'nearest'});
  }
  function locateSelection(){
    const button=buttonFor(selected)||buttonFor('project');
    if(!button)return;
    select(button,true);
    viewport.locate(button);
  }
  function fitToView(){viewport?.fit();}
  function closeEditor(){
    const box=stage?.nextElementSibling;
    if(box){box.hidden=true;box.replaceChildren();}
  }
  function positionEditor(){
    const box=stage.nextElementSibling;
    if(box.hidden)return;
    const button=buttonFor(box.dataset.editing);
    if(!button)return;
    const host=stage.parentNode.getBoundingClientRect(),canvas=stage.getBoundingClientRect(),rect=button.getBoundingClientRect();
    const upper=Math.max(canvas.top,0)-host.top+4;
    const lower=Math.min(canvas.bottom,window.innerHeight)-host.top-4;
    if(lower<=upper)return;
    box.style.maxHeight=(lower-upper)+'px';
    const right = rect.right - host.left + 8, left = rect.left - host.left - box.offsetWidth - 8;
    const side = right + box.offsetWidth <= host.width - 4 ? right : left >= 4 ? left : undefined;
    const below = rect.bottom - host.top + 4, above = rect.top - host.top - box.offsetHeight - 4;
    const top = side !== undefined ? rect.top - host.top : below + box.offsetHeight <= lower ? below : above;
    box.style.left = Math.max(4,Math.min(side ?? rect.left-host.left,host.width-box.offsetWidth-4))+'px';
    box.style.top = Math.max(upper,Math.min(top,lower-box.offsetHeight))+'px';
  }
  function editor(button,html){
    const box=stage.nextElementSibling;
    box.dataset.editing=button.dataset.treeId;
    box.innerHTML='<div class="map-editor-title"><strong>'+esc(index.get(button.dataset.treeId).entry.label)+'</strong>'+
      '<button type="button" class="plain" data-map-close aria-label="'+tr('关闭','Close')+'">×</button></div>'+html;
    box.hidden=false;
    positionEditor();
    box.querySelector('[data-map-close]').onclick=()=>{closeEditor();button.focus();};
    box.onkeydown=event=>{if(event.key==='Escape'){closeEditor();button.focus();}};
    box.querySelector('select,input,textarea,button:not([data-map-close])')?.focus({preventScroll:true});
    return box;
  }
  function keyboard(event){
    const button=event.target.closest('[data-tree-id]');if(!button)return;
    const record=index.get(button.dataset.treeId),buttons=[...stage.querySelectorAll('[data-tree-id]')],pos=buttons.indexOf(button);
    const move=next=>{if(next){select(next,true);next.scrollIntoView({block:'nearest',inline:'nearest'});}};
    switch(event.key){
      case 'Enter':activate(button);break;
      case ' ':toggle(button);break;
      case 'ArrowRight':expanded.has(record.entry.id)?move(button.nextElementSibling?.querySelector('button')):toggle(button,true);break;
      case 'ArrowLeft':expanded.has(record.entry.id)?toggle(button,false):move(record.parent&&buttonFor(record.parent));break;
      case 'ArrowDown':move(buttons[pos+1]);break;
      case 'ArrowUp':move(buttons[pos-1]);break;
      case 'Home':move(buttons[0]);break;
      case 'End':move(buttons.at(-1));break;
      default:return;
    }
    event.preventDefault();
  }
  function bindSearch(box){
    const input=box.querySelector('[data-map-search]'),list=box.querySelector('.map-search-results');
    input.oninput=()=>{
      const term=input.value.trim().toLowerCase();list.hidden=!term;list.replaceChildren();if(!term)return;
      const matches=configurationSearchResults(index,term,ZephyrPathDisplay);
      list.innerHTML=matches.map(entry=>'<button type="button" data-map-result="'+esc(entry.id)+'"><strong>'+esc(entry.label)+
        '</strong><small>'+esc(entry.action?.kind==='property'?entry.action.record.path:entry.detail||'')+'</small></button>').join('')||'<small>'+tr('无匹配节点','No matching nodes')+'</small>';
    };
    list.onclick=e=>{const result=e.target.closest('[data-map-result]');if(result){list.hidden=true;reveal(result.dataset.mapResult,true,true);}};
    input.onkeydown=e=>{if(e.key==='Escape')list.hidden=true;if(e.key==='ArrowDown')list.querySelector('button')?.focus();
      if(e.key==='Enter'&&!list.hidden){e.preventDefault();list.querySelector('button')?.click();}};
    box.onfocusout=e=>{if(!box.contains(e.relatedTarget))list.hidden=true;};
  }
  function attach(parent){
    viewport?.disconnect();
    stage=parent.querySelector('.config-map-stage');if(!stage)return;
    bindSearch(stage.previousElementSibling);
    const sheetStyle=getComputedStyle(stage.firstElementChild);
    viewport=new ConfigurationMapViewport(stage,view,offset||[parseFloat(sheetStyle.paddingLeft)-18,parseFloat(sheetStyle.paddingTop)-16],positionEditor);
    stage.onscroll=()=>{offset=[stage.scrollLeft,stage.scrollTop];positionEditor();};
    stage.onclick=e=>{const button=e.target.closest('[data-tree-id]');closeEditor();if(!button)return;
      select(button);if(e.detail<=1&&button.hasAttribute('aria-expanded'))toggle(button);};
    stage.ondblclick=e=>{const button=e.target.closest('[data-tree-id]');if(button)activate(button);};
    stage.onkeydown=keyboard;
    stage.onpointerdown=e=>{if(e.button===0&&!e.target.closest('button')){view.fitted=false;
      if(e.target===stage&&(e.offsetX>=stage.clientWidth||e.offsetY>=stage.clientHeight))return;
      closeEditor();drag=[e.clientX,e.clientY,stage.scrollLeft,stage.scrollTop];
      stage.setPointerCapture(e.pointerId);stage.classList.add('panning');}};
    stage.onpointermove=e=>{if(drag)stage.scrollTo(drag[2]+drag[0]-e.clientX,drag[3]+drag[1]-e.clientY);};
    stage.onpointerup=stage.onpointercancel=stage.onlostpointercapture=()=>{drag=null;stage.classList.remove('panning');};
    stage.addEventListener('wheel',e=>{
      if(!e.ctrlKey){view.fitted=false;return;}
      e.preventDefault();e.stopPropagation();
      const rect=stage.getBoundingClientRect(),delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?stage.clientHeight:1);
      viewport.zoomAt(view.scale*Math.exp(-Math.max(-200,Math.min(200,delta))/500),e.clientX-rect.left,e.clientY-rect.top);
    },{passive:false});
    stage.previousElementSibling.querySelector('.tools').onclick=e=>{
      const action=e.target.closest('[data-act]')?.dataset.act;
      if(action==='map:locate')locateSelection();
      if(action==='map:fit')fitToView();
      if(action==='map:reset')viewport.zoomAt(1);
      if(action==='map:in')viewport.zoomAt(view.scale+.25);
      if(action==='map:out')viewport.zoomAt(view.scale-.25);
    };
  }
  const snapshot=()=>({scope,expanded:[...expanded],offset:stage?.isConnected?[stage.scrollLeft,stage.scrollTop]:offset,...view,selected});
  function restoreView(view){if(view?.scope){restoredView=view;scope=undefined;}}
  return {markup,attach,editor,closeEditor,reveal,route,snapshot,restoreView,fitToView,locateSelection};
}
function configurationTreeHeader(app,board,method,actions){
  return '<div class="map-page-header"><div><h1>'+tr('工程配置','Project configuration')+'</h1><small>'+
    esc([app,board,method].filter(Boolean).join(' · '))+'</small></div><div class="actions">'+actions+'</div></div>';
}
if(typeof module!=='undefined')module.exports={configurationTreeModel,configurationMapFitScale,configurationSearchResults};
