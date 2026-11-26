'use strict';
const studioView=(()=>{
  let state,node='kconfig',scope='',selected={},requestedNode,reviewFile;
  const draftsByTarget=new Map((stored().studioDraftsV1||[]).map(([key,entries])=>[key,new Map(entries)]));
  let drafts,saveTimer,restoreView=stored().studioMapView,restoredSelection=stored().studioSelection;
  const baseName=value=>(value||'—').split(/[\\/]/).pop();
  const files=()=>state.inputs.filter(f=>f.kind===node);
  function preferred(kind){
    const items=state.inputs.filter(f=>f.kind===kind);
    return items.find(f=>f.file===selected[kind])||items.find(f=>f.applied)||items.find(f=>!f.creating)||items[0];
  }
  const active=()=>preferred(node);
  const workspace=new ConfigurationWorkspace({
    toggleWindow:()=>send('studioWindowFullscreen'),
    present:()=>send('studioPresentation',persistDrafts()),
    moveWindow:direction=>send(direction,persistDrafts()),
    contextChanged:schedulePersist
  });
  const tree=createStudioMap({state:()=>state,preferred,draft:file=>drafts.get(file),stage:stageText,inspect:selectNode,chooseFile,changed:checkpointEdit});
  function persistDrafts(){
    clearTimeout(saveTimer);
    const entries=[...draftsByTarget].filter(([,files])=>files.size).map(([key,files])=>[key,[...files]]);
    const snapshot={studioDraftsV1:entries,studioMapView:tree.snapshot(),studioSelection:{scope,node,selected,reviewFile,pane:workspace.pane},
      studioArguments:state?.app ? {app:state.app,text:studioArgumentDrafts.get(state.app)} : undefined};
    persist(snapshot);
    if(workspace.detached&&page==='configuration'&&snapshot.studioMapView.scope===scope){
      send('studioCheckpoint',{...snapshot,studioDraftsV1:entries.filter(([target])=>target===scope)});
    }
    return snapshot;
  }
  function receiveTransfer(transfer,scopeKey,app){
    if(transfer?.studioMapView?.scope!==scopeKey)return;
    if(transfer.studioArguments?.app===app&&app){
      if(typeof transfer.studioArguments.text==='string')studioArgumentDrafts.set(app,transfer.studioArguments.text);
      else studioArgumentDrafts.delete(app);
    }
    draftsByTarget.delete(scopeKey);
    for(const [key,files] of transfer.studioDraftsV1||[])draftsByTarget.set(key,new Map(files));
    drafts=draftsByTarget.get(scopeKey)||new Map();
    restoreView=transfer.studioMapView;tree.restoreView(restoreView);
    restoredSelection=transfer.studioSelection;scope='';
  }
  function schedulePersist(){
    clearTimeout(saveTimer);
    const target=scope;
    saveTimer=setTimeout(()=>{if(target===scope&&page==='configuration')persistDrafts();},200);
  }
  function checkpointEdit(){
    if(workspace.detached)persistDrafts();else schedulePersist();
  }
  function chooseFile(file){
    node=file.kind;
    selected[node]=reviewFile=file.file;
    $('#studio-fragment-kind').value=node;
    $('#studio-inspector').innerHTML=inspector();
    $('#studio-changes').innerHTML=changes();
  }
  function inspector(){
    const disabled=!state.folder||!state.trusted||state.busy;
    if(node==='device'){
      const sources=devicetreeSources(state.board,state.devicetree);
      const expanded=selected.device||drafts.has(active()?.file);
      return wrap(sources+'<details class="overlay-editor"'+(expanded?' open':'')+'><summary>'+
        tr('编辑应用覆盖（可选）','Edit application overlays (optional)')+'</summary>'+fragmentEditor(disabled)+'</details>');
    }
    return wrap(kconfigContext()+fragmentEditor(disabled)+kconfigTools(disabled));
  }
  function kconfigContext(){
    const source=state.symbols?.source;
    const hints={
      menu:tr('符号和可选值来自当前目标的 Zephyr Kconfig 菜单。保存片段并重新配置后，可在这里核对构建值。',
        'Symbols and choices come from this target’s Zephyr Kconfig menu. After saving the fragment, configure again to verify the effective values here.'),
      restricted:tr('信任工作区后可读取 Zephyr Kconfig 菜单。','Trust the workspace to load the Zephyr Kconfig menu.'),
      unavailable:tr('无法载入当前构建的 Zephyr Kconfig 菜单。此处仅列出片段已有的赋值。','The Zephyr menu could not be loaded for this build. Only existing fragment assignments are listed.')
    };
    return '<p class="subtle">'+(hints[source]||tr('先配置工程，即可按名称或提示搜索开发板与应用可用的符号。','Configure the project to search the symbols available for this application and board by name or prompt.'))+'</p>';
  }
  function kconfigTools(disabled){
    const usable=state.configured&&state.canBuild;
    return '<details class="kconfig-tools"><summary>'+tr('当前构建 · Zephyr 配置工具','Current build · Zephyr configuration tools')+'</summary>'+
      '<small>'+(usable?tr('直接更改构建目录下的 .config。','These tools edit .config in the build directory.'):
        tr('先配置工程。','Configure the project first.'))+'</small><div class="actions">'+
      b(tr('图形菜单 · guiconfig','Graphical menu · guiconfig'),'studio:guiconfig','plain','',disabled||!usable)+
      b(tr('终端菜单 · menuconfig','Terminal menu · menuconfig'),'studio:menuconfig','plain','',disabled||!usable)+'</div></details>';
  }
  function fields(){
    const f=active();
    const file=f||{kind:'kconfig',file:'',text:''};
    return fragmentFields.render(file,drafts.get(file.file)?.text??file.text,state.symbols,Boolean(f));
  }
  function fragmentEditor(disabled){
    const fileActions='<div class="actions">'+b(tr('打开文件…','Open file…'),'studio:openFile','','folder',disabled)+
      b(tr('新建文件…','New file…'),'studio:newFile','','file',disabled)+'</div>';
    const f=active();
    if(!f)return fileActions+'<p>'+(node==='device'?tr('仅在需要修改硬件配置时创建或打开应用的 .overlay 文件。','Open or create an application .overlay only when you need to change hardware settings.'):
      tr('打开或新建应用 .conf 文件，即可将选择保存到工程。','Open or create an application .conf file to save your choices to the project.'))+'</p>'+
      (node==='kconfig'?'<div id="fragment-form">'+fields()+'</div>':'');
    const draft=drafts.get(f.file),text=draft?.text??f.text;
    const choices=files().map(v=>'<option value="'+esc(v.file)+'" '+(v.file===f.file?'selected':'')+'>'+esc(studioFileLabel(v,state.app))+'</option>').join('');
    const hint=f.creating?tr('新文件将在保存到工程时创建。','The new file will be created when you save to the project.'):
      node==='device'?(f.applied===true?tr('上次配置已使用此覆盖文件。','The last configuration applied this overlay.'):
        f.applied===false?tr('上次配置未使用此覆盖文件。','The last configuration did not apply this overlay.'):
        tr('此文件可编辑；是否生效以配置记录为准。','Editable overlay. The build record determines whether it was applied.')):
      f.creating===false?tr('打开文件用于编辑。构建采用的片段由 Zephyr 配置决定。','Opened for editing. Zephyr configuration determines which fragments the build uses.'):'';
    return fileActions+'<label>'+tr('配置文件','Configuration file')+'<select id="studio-file">'+choices+'</select></label>'+(hint?'<small>'+hint+'</small>':'')+
      '<div id="fragment-form">'+fields()+'</div><details id="source-draft"'+(f.creating?' open':'')+'><summary>'+tr('文件草稿','File draft')+'</summary><textarea id="studio-text" spellcheck="false" aria-label="'+esc(baseName(f.file))+'">'+esc(text)+'</textarea></details>';
  }
  function controls(){
    return configurationTreeHeader(baseName(state.app),state.board,state.method,
      workspace.controls());
  }
  function reviewed(){
    return state.inputs.find(f=>f.file===reviewFile)||active()||state.inputs[0];
  }
  function changes(){
    const f=reviewed(),d=f&&drafts.get(f.file),stale=Boolean(d&&d.base!==f.base);
    const status=stale?tr('原文件已变化','Source changed'):d?tr('有未保存的草稿','Unsaved draft'):tr('已同步','No pending edits');
    const paths=state.inputs.map(item=>'<option value="'+esc(item.file)+'"'+(item===f?' selected':'')+'>'+esc(studioFileLabel(item,state.app))+
      (drafts.has(item.file)?' •':'')+'</option>').join('');
    const include=f&&!f.creating&&f.applied===false?((state.includedInputs||[]).includes(f.file)?
      '<small>'+tr('已加入 · 待重新配置','Included · configure to apply')+'</small>':
      b(tr('加入当前构建','Include in this target'),'studio:include','plain','',!state.trusted||state.busy)):'';
    const controls='<div class="map-draft-actions"><select id="studio-review" aria-label="'+tr('核对目标片段','Review fragment')+'">'+paths+'</select>'+
      b(tr('另存副本…','Save a copy…'),'studio:saveAs','','',!f||!state.trusted||state.busy||(!d&&f.creating))+
      b(f?.creating?tr('保存到工程','Save to project'):tr('覆盖工程原配置','Overwrite project file'),'studio:save','primary','',!d||stale||!state.trusted||state.busy)+
      (d?b(tr('放弃修改','Discard'),'studio:discard','plain'):'')+include+'</div>';
    const diff=d?'<details open><summary>'+tr('修改预览','Review changes')+'</summary><small>'+tr('原文件','Original')+'</small><pre>'+esc(d.original)+
      '</pre><small>'+tr('草稿','Draft')+'</small><pre>'+esc(d.text)+'</pre></details>':'';
    return panel(tr('配置草稿','Configuration drafts'),wrap(controls+diff),'<small role="status">'+status+'</small>');
  }
  function render(route){
    const previous=restoreView||tree.snapshot();
    restoreView=undefined;
    const hint='<small class="map-help">'+tr('单击展开，双击或 Enter 编辑。拖动空白处平移，Ctrl + 滚轮缩放。',
      'Click to expand, double-click or press Enter to edit. Drag the canvas to pan. Ctrl + wheel to zoom.')+'</small>';
    $('#main').innerHTML=controls()+workspace.layout(
      panel(tr('工程配置图','Configuration map'),tree.markup(state),hint),
      '<div id="studio-changes">'+changes()+'</div>',
      panel(tr('配置检查器','Inspector'),'<div id="studio-inspector">'+inspector()+'</div>',workspace.fragmentKind(node)));
    workspace.attach(drafts.size);
    tree.attach($('#main'));
    if(!route)tree.restoreEditor(previous);
  }
  function open(data){
    const next=JSON.stringify([data.folder,data.app,data.board,data.build]);
    if(data.studioRestore)receiveTransfer(data.studioRestore,next,data.app);
    workspace.setWindow(Boolean(data.studioDetached),data.studioRestore?.studioSelection?.pane,Boolean(data.studioPresentation));
    if(next!==scope){
      scope=next;selected={};reviewFile=undefined;node='kconfig';
      drafts=draftsByTarget.get(scope)||new Map();draftsByTarget.set(scope,drafts);
      if(restoredSelection?.scope===scope){
        selected=restoredSelection.selected||{};node=restoredSelection.node==='device'?'device':'kconfig';reviewFile=restoredSelection.reviewFile;restoredSelection=undefined;
      }
    }
    const route=['kconfig','device'].includes(data.inspector)?data.inspector:requestedNode;
    if(route){
      node=route;requestedNode=undefined;
      const hardware=route==='device'&&data.devicetree?.catalog?.nodes?.length;
      workspace.openPane(hardware?'':'inspector');
    }
    state=data;render(route);
    if(route)requestAnimationFrame(()=>tree.route(route));
  }
  function action(kind){
    if(kind==='openFile'||kind==='newFile')return send(kind==='newFile'?'studioNew':'studioOpen',node);
    const routes={menuconfig:'menuconfig',guiconfig:'guiconfig'};
    if(routes[kind])return send(routes[kind]);
    const f=reviewed(),draft=f&&drafts.get(f.file);
    if(kind==='include'&&f)return send('studioInclude',f.file);
    if(f&&(kind==='saveAs'||(kind==='save'&&draft))){
      return send(kind==='saveAs'?'studioSaveAs':'studioSave',{file:f.file,base:draft?draft.base:f.base,text:draft?draft.text:f.text});
    }
    if(kind==='discard'&&f){
      drafts.delete(f.file);
      checkpointEdit();
      if(f.creating&&!f.automatic)return send('studioDiscardNew',f.file);
    }
    render();
  }
  document.addEventListener('click',e=>{
    const source=e.target.closest('[data-devicetree-path]');if(source)return send('devicetreeFile',source.dataset.devicetreePath);
    if(page!=='configuration')return;
    const button=e.target.closest('[data-act^="studio:"]');if(button)return action(button.dataset.act.slice(7));
  });
  function selectNode(id){
    if(id!=='kconfig'&&id!=='device')return;
    node=id;reviewFile=active()?.file;workspace.openPane('inspector');render(true);
    requestAnimationFrame(()=>$('#studio-fragment-kind')?.focus());
  }
  document.addEventListener('change',e=>{if(e.target.id==='studio-fragment-kind')selectNode(e.target.value);});
  function updateFields(){
    $('#fragment-form').innerHTML=fields();
  }
  document.addEventListener('click',e=>{
    const item=e.target.closest('[data-act^="field:"]');if(!item)return;
    const f=active(),source=$('#studio-text');
    try{
      source.value=fragmentFields.apply(f,source.value,$('#field-name').value,$('#field-value').value,item.dataset.act==='field:remove',state.symbols);
      source.dispatchEvent(new Event('input',{bubbles:true}));
    }catch(error){notify(error.message);}
  });
  document.addEventListener('input',e=>{
    if(e.target.id==='field-search'){
      const value=e.target.value;fragmentFields.search(value);updateFields();$('#field-search').focus();return;
    }
    if(e.target.id!=='studio-text')return;
    stageText(active(),e.target.value,false);
  });
  function stageText(f,text,fromGraph=true){
    const d=drafts.get(f.file)||{base:f.base,original:f.text};
    d.text=text.replace(/\r?\n/g,d.original.includes('\r\n')?'\r\n':'\n');
    if(d.text===d.original&&!f.creating)drafts.delete(f.file);else drafts.set(f.file,d);
    workspace.showCount(drafts.size);
    reviewFile=f.file;
    checkpointEdit();
    if(active()?.file===f.file&&$('#studio-text')){
      if(fromGraph)$('#studio-text').value=d.text;
      updateFields();
    }
    $('#studio-changes').innerHTML=changes();
  }
  document.addEventListener('change',e=>{if(e.target.id==='field-name'){fragmentFields.choose(e.target.value);updateFields();}if(e.target.id==='studio-file'){selected[node]=reviewFile=e.target.value;render();checkpointEdit();}if(e.target.id==='studio-review'){reviewFile=e.target.value;$('#studio-changes').innerHTML=changes();checkpointEdit();}});
  window.addEventListener('message',({data})=>{
    if(data?.studioPicked&&(!data.studioScope||data.studioScope===scope)){
      const f=data.studioPicked;
      selected[f.kind]=reviewFile=f.file;node=f.kind;
      if(f.creating&&!drafts.has(f.file))drafts.set(f.file,{base:null,original:'',text:''});
      checkpointEdit();
    }
    if(data?.savedFile){
      const saved=data.savedScope?draftsByTarget.get(data.savedScope):drafts;
      const pending=saved?.get(data.savedFile);
      if(pending&&pending.base===data.savedBase&&pending.text===data.savedText){saved.delete(data.savedFile);checkpointEdit();}
    }});
  function flushDetached(){
    if(workspace.detached&&page==='configuration'&&state)persistDrafts();
  }
  function mapInteraction(event){
    if(workspace.detached&&event.target.closest?.('.config-map'))schedulePersist();
  }
  document.addEventListener('scroll',mapInteraction,{capture:true,passive:true});
  document.addEventListener('click',mapInteraction);
  document.addEventListener('keyup',mapInteraction);
  document.addEventListener('wheel',mapInteraction,{capture:true,passive:true});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&state&&page==='configuration')persistDrafts();});
  window.addEventListener('pagehide',flushDetached);
  window.addEventListener('blur',flushDetached);
  function showNode(id){requestedNode=id;send('page','configuration');}
  return {open,showKconfig(){showNode('kconfig');},showDevicetree(){showNode('device');},
    leave(){workspace.leave();}};
})();
