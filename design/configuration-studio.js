'use strict';

const studioWindow=new URLSearchParams(location.search).get('view')==='configuration';
let openingStudioView;
const demoWorkspace=new ConfigurationWorkspace({
  exitFullscreen(){if(document.fullscreenElement)document.exitFullscreen();},
  toggleWindow() {
    if(document.fullscreenElement)return document.exitFullscreen();
    document.documentElement.requestFullscreen().catch(()=>notify('画布已展开。按 F11 可切换浏览器全屏。'));
  },
  moveWindow(action) {
    if(action==='attach'&&window.opener&&!window.opener.closed){
      window.opener.postMessage({type:'zephyr-design-return',model,draft,view:demoStudioSnapshot()},location.origin==='null'?'*':location.origin);
      window.opener.focus();
      window.close();
    } else if(action==='attach'){
      const url=new URL(location.href);url.searchParams.delete('view');location.replace(url);
    } else openStudioWindow();
  }
});
function demoStudioSnapshot(){
  return {map:designTree.snapshot(),node,pane:demoWorkspace.pane};
}
function restoreDemoStudio(view){
  if(!view)return;
  designTree.restoreView(view.map);
  node=view.node==='device'?'device':'kconfig';
  demoWorkspace.setWindow(studioWindow,view.pane);
}
document.addEventListener('fullscreenchange',()=>{
  if(document.fullscreenElement||!demoWorkspace.expanded||demoWorkspace.detached)return;
  demoWorkspace.expanded=false;
  demoWorkspace.pane='';
  demoWorkspace.update();
  document.querySelector('[data-canvas-action="expand"]')?.focus({preventScroll:true});
});
function openStudioWindow(){
  if(detached&&!detached.closed){detached.focus();return;}
  openingStudioView=demoStudioSnapshot();
  const url=new URL(location.href);url.searchParams.set('view','configuration');url.hash='graph';
  detached=window.open(url,'zephyr-config-studio','popup,width='+screen.availWidth+',height='+screen.availHeight);
  if(!detached){openingStudioView=undefined;notify('浏览器阻止了新窗口，可直接使用全屏配置。');}
}
const symbolTypes={CONFIG_PRINTK:'bool',CONFIG_LOG:'bool',CONFIG_SERIAL:'bool',CONFIG_GPIO:'bool',CONFIG_MAIN_STACK_SIZE:'int',CONFIG_BT_DEVICE_NAME:'string'};
let activeSymbol='CONFIG_PRINTK',symbolSearch='';
const studioTarget=()=>JSON.stringify([appKey(),model.board]);
const symbolDraft=name=>name==='CONFIG_PRINTK'?'kconfig':name;
function studioState(){
  model.configTargets??={};
  const key=studioTarget();
  if(model.loadedTarget!==key){
    const previous=model.configTargets[model.loadedTarget];
    if(previous)previous.CONFIG_PRINTK=model.conf;
    const next=model.configTargets[key]??={CONFIG_PRINTK:'y'};
    model.conf=next.CONFIG_PRINTK;model.loadedTarget=key;
  }
  return model.configTargets[key];
}
const savedSymbol=name=>name==='CONFIG_PRINTK'?(model.conf==='移除显式赋值'?undefined:model.conf):studioState()[name];
function symbolNames(){
  return [...new Set([...Object.keys(symbolTypes),...Object.keys(studioState()),...Object.keys(draft),activeSymbol])].filter(k=>k.startsWith('CONFIG_'));
}
function symbolButtons(){
  return symbolNames().filter(k=>fuzzy(k.toLowerCase(),symbolSearch.toLowerCase())).map(k=>
    '<button data-act="symbol:'+esc(k)+'" aria-pressed="'+(k===activeSymbol)+'">'+esc(k)+(draft[symbolDraft(k)]!==undefined?' •':'')+'</button>').join('')||'<small>没有匹配的符号。</small>';
}
function kconfigEditor(){
  const k=activeSymbol,val=draft[symbolDraft(k)]??savedSymbol(k),type=symbolTypes[k]||'value';
  const input=type==='bool'?'<select id="newval">'+['y','n','移除显式赋值'].map(v=>'<option'+(v===val?' selected':'')+'>'+v+'</option>').join('')+'</select>':
    '<input id="newval" class="input" value="'+esc(val??'')+'" placeholder="'+(type==='int'?'整数':'Kconfig 赋值')+'">';
  return fragmentFileActions('kconfig')+demoFilesList('kconfig')+'<div class="symbol-tools"><input id="symbol-search" class="input" type="search" aria-label="搜索 Kconfig" placeholder="搜索 Kconfig 符号" value="'+esc(symbolSearch)+'">'+b('添加符号','newsymbol')+'</div>'+
    '<div id="symbols" class="symbol-list">'+symbolButtons()+'</div><strong class="mono">'+esc(k)+'</strong><small>prj.conf · 当前显式值：'+esc(savedSymbol(k)??'未设置')+'</small>'+
    '<label>草稿值'+input+'</label><div class="actions">'+b('加入草稿','studioedit')+b('移除赋值','studioremove','plain')+b('读入 .conf','studioload','plain')+'<input hidden id="studio-fragment" type="file" accept=".conf,.config,text/plain"></div>';
}
function deviceEditor(){
  const existing=model.demoFiles?.[appKey()]?.['app.overlay'];
  const uartValue=['okay','disabled'].find(value=>existing===uartExampleOverlay(value));
  const example=model.board==='mps2/an386'&&(existing===undefined||uartValue)?
    '<label>UART0 · status（开发板示例）<select id="uart-example-status"><option>okay</option><option'+
    (uartValue==='disabled'?' selected':'')+'>disabled</option></select></label>'+b('预览 app.overlay 草稿','fragmentuart'):'';
  return devicetreeSources(model.board,currentExampleDevicetree())+
    '<details class="overlay-editor"><summary>编辑应用覆盖（可选）</summary>'+fragmentFileActions('device')+
    demoFilesList('device')+example+'</details>';
}
const uartExampleOverlay=value=>'&uart0 {\n\tstatus = "'+value+'";\n};\n';
function showDevicetreeExample(path){
  const tree=currentExampleDevicetree();
  if(!path||![tree.boardFile,...(tree.overlays||[]),tree.generatedFile].includes(path))return;
  const overlay=(tree.overlays||[]).includes(path);
  const text=overlay?model.demoFiles?.[appKey()]?.[path.split('/').pop()]:undefined;
  const description=path===tree.boardFile?'Zephyr 根据 BOARD 选择此开发板文件。':
    path===tree.generatedFile?'Zephyr 将开发板、包含文件和覆盖合并到这份设备树。':'此覆盖在示例配置时生效。';
  show('设备树来源 · 示例',row('文件',ZephyrPathDisplay.path(path))+'<p>'+description+'</p>'+
    (text===undefined?'<small>安装版可只读打开当前工程的实际文件。</small>':'<pre>'+esc(text)+'</pre>'));
}
function changeList(){
  return Object.entries(draft).map(([key,value])=>{
    const label=key==='kconfig'?'CONFIG_PRINTK':key;
    const old=key==='app.overlay'?model.demoFiles?.[appKey()]?.[key]:savedSymbol(label);
    return '<div class="diff"><div>− '+esc(label+' = '+(old??'未设置'))+'</div><span>+ '+esc(label+' = '+value)+'</span></div>';
  }).join('');
}
function studioPage(){
  const total=Object.keys(draft).length;
  demoWorkspace.setWindow(studioWindow);
  const diagram=panel('工程配置图',designTree.markup(designTreeState()),'<small class="map-help">单击展开，双击或 Enter 编辑。拖动空白处平移，Ctrl + 滚轮缩放。</small>');
  const editor=node==='device'?deviceEditor():kconfigEditor();
  const review=panel('配置草稿',wrap('<div class="map-draft-actions">'+b('另存副本…','studiocopy')+
    b('覆盖工程原配置','save','primary','',!total)+(total?b('放弃修改','discard','plain'):'')+'</div>'+changeList()),
    '<small>'+(total?'有未保存的草稿':'已同步')+'</small>');
  return configurationTreeHeader(model.app,model.board,methodName(),demoWorkspace.controls())+
    demoWorkspace.layout(diagram,review,panel('配置检查器',wrap('<div class="studio-editor">'+editor+'</div>'),demoWorkspace.fragmentKind(node)));
}
document.addEventListener('change',event=>{
  if(event.target.id!=='studio-fragment-kind')return;
  node=event.target.value;render();$('#studio-fragment-kind')?.focus();
});
function stageSymbol(remove){
  const value=remove?'移除显式赋值':$('#newval').value.trim();
  if(!value||(!remove&&symbolTypes[activeSymbol]==='int'&&!/^-?\d+$/.test(value)))return notify('请填写有效的配置值');
  const key=symbolDraft(activeSymbol);
  if(value===savedSymbol(activeSymbol)||remove&&savedSymbol(activeSymbol)===undefined)delete draft[key];
  else draft[key]=value;
  commitDemo();
}
function saveStudio(){
  const target=studioState();
  for(const [k,v] of Object.entries(draft)){
    if(k==='app.overlay')setDemoFile(appKey(),k,v);
    else if(k==='kconfig')target.CONFIG_PRINTK=model.conf=v;
    else if(v==='移除显式赋值')delete target[k];
    else target[k]=v;
  }
  draft={};invalidate();notify('已保存到当前演示工程，请重新配置。');commitDemo();
}
function studioAction(action,value){
  if(action==='studiocopy')return copyDemoFragment(value);
  if(action==='studioboard')return $('#board-cache').click();
  if(action==='studioload')return $('#studio-fragment').click();
  if(action==='symbol'){activeSymbol=value;node='kconfig';return render();}
  if(action==='newsymbol')return show('添加 Kconfig 符号',inputField('symbol-name','符号名称','CONFIG_')+b('编辑赋值','symbolcreate','primary')+'<small id="source-message" role="status"></small>');
  if(action==='symbolcreate'){
    const k=inputValue('#symbol-name').toUpperCase();
    if(!/^CONFIG_[A-Z0-9_]+$/.test(k))return sourceMessage('请输入 CONFIG_ 开头的符号名称。');
    activeSymbol=k;symbolSearch='';$('#dialog').close();return render();
  }
  if(action==='studioedit'||action==='studioremove')return stageSymbol(action==='studioremove');
}
document.addEventListener('input',e=>{if(e.target.id==='symbol-search'){symbolSearch=e.target.value;$('#symbols').innerHTML=symbolButtons();}});


document.addEventListener('change',async event=>{
  if(event.target.id!=='studio-fragment')return;
  const file=event.target.files[0], target=studioTarget();
  if(!file)return;
  try{
    if(file.size>1048576)throw Error('配置片段过大');
    const values={};
    for(const line of (await file.text()).split(/\r?\n/)){
      const set=/^\s*(CONFIG_[A-Z0-9_]+)\s*=\s*(.+?)\s*$/.exec(line);
      const unset=/^\s*#\s*(CONFIG_[A-Z0-9_]+) is not set\s*$/.exec(line);
      if(set)values[set[1]]=set[2];
      else if(unset)values[unset[1]]='n';
    }
    if(target!==studioTarget())throw Error('工程目标已变化，请重新选择配置片段');
    const keys=Object.keys(values);if(!keys.length)throw Error('文件没有可读取的 CONFIG_ 赋值');
    for(const [name,value] of Object.entries(values)){
      if(value===savedSymbol(name))delete draft[symbolDraft(name)];
      else draft[symbolDraft(name)]=value;
    }
    activeSymbol=keys[0];symbolSearch='';commitDemo();notify('已读入 '+file.name+' 的 '+keys.length+' 项赋值');
  }catch(error){notify(error.message);}
});



document.addEventListener('change',async event=>{
  if(event.target.id!=='board-cache')return;
  const file=event.target.files[0], target=studioTarget();
  if(!file)return;
  try{
    if(file.size>4*1048576)throw Error('缓存文件过大。');
    const content=await file.text();
    const board=/^(?:CACHED_BOARD|BOARD):(?:STRING|INTERNAL|UNINITIALIZED)=([^\r\n]+)$/m.exec(content.replace(/\r\n/g,'\n'))?.[1]?.trim();
    if(!board||!/^[\w.@+/-]+$/.test(board))throw Error('文件中未找到有效的 BOARD 缓存项。');
    if(target!==studioTarget())throw Error('应用或开发板已改变，请重新读取。');
    model.knownBoards=[...new Set([...(model.knownBoards||[]),board])];
    pick('board');const search=$('.target-picker input');if(search){search.value=board;search.dispatchEvent(new Event('input',{bubbles:true}));}
  }catch(error){notify(error.message);}
});

function fragmentFileActions(kind){
  return '<div class="actions">'+b('打开已有文件…','fragmentopen:'+kind)+b('新建文件…','fragmentnew:'+kind)+'</div>';
}
const fragmentSuffix=kind=>kind==='kconfig'?'.conf':'.overlay';
function fragmentDialog(kind,file,initial,reuse=false){
  const files=model.demoFiles?.[appKey()]||{};
  const content=reuse&&Object.hasOwn(files,file)?files[file]:initial;
  show('编辑文件草稿',inputField('fragment-name','工程文件名',file)+
    '<label>文件草稿<textarea id="fragment-text" rows="8">'+esc(content)+'</textarea></label>'+
    '<small>仅保存到演示工程。安装版通过系统保存窗口选择文件位置。</small>'+
    b('核对草稿','fragmentreview:'+kind,'primary'));
}
async function openFragment(kind){
  const target=studioTarget();
  const file=await chooseBrowserEntry(false,fragmentSuffix(kind));
  if(!file||target!==studioTarget())return;
  if(file.size>2*1024*1024)return notify('文件超过 2 MiB，无法预览。');
  if(!file.name.endsWith(fragmentSuffix(kind)))return notify('请选择 '+fragmentSuffix(kind)+' 文件。');
  try{const text=await file.text();if(target===studioTarget())fragmentDialog(kind,file.name,text);}
  catch{notify('无法读取所选文件。');}
}
let fragmentReview;
function reviewFragment(kind){
  const file=inputValue('#fragment-name'),text=$('#fragment-text').value;
  if(!file||!file.endsWith(fragmentSuffix(kind))||/[\\/]/.test(file)||file.startsWith('.'))return notify('请输入带 '+fragmentSuffix(kind)+' 后缀的文件名。');
  fragmentReview={target:studioTarget(),app:appKey(),kind,file,text};
  show('保存到演示工程',wrap('<strong>'+esc(file)+'</strong><pre>'+esc(text)+'</pre>')+
    '<small>此操作保留演示副本。磁盘文件和构建参数不受影响。</small>'+
    b('返回编辑','fragmentback')+b('保存到演示工程','fragmentsave','primary'));
}
function saveDemoFile(){
  if(!fragmentReview||fragmentReview.target!==studioTarget())return notify('工程目标已变化，请重新选择文件。');
  const {app,file,text}=fragmentReview;
  setDemoFile(app,file,text);fragmentReview=undefined;$('#dialog').close();invalidate();commitDemo();notify('已保存到演示工程，请重新配置。');
}
function setDemoFile(app,file,text){
  model.demoFiles??=Object.create(null);
  if(!Object.hasOwn(model.demoFiles,app))Object.defineProperty(model.demoFiles,app,{value:Object.create(null),enumerable:true,writable:true});
  model.demoFiles[app][file]=text;
}
function fragmentActions(action,value,kind){
  if(action==='fragmentuart')return fragmentDialog('device','app.overlay',uartExampleOverlay($('#uart-example-status').value));
  if(action==='fragmentopen')return openFragment(value);
  if(action==='fragmentnew')return fragmentDialog(value,value==='device'?'app.overlay':'custom.conf','',true);
  if(action==='fragmentreview')return reviewFragment(value);
  if(action==='fragmentback'&&fragmentReview)return fragmentDialog(fragmentReview.kind,fragmentReview.file,fragmentReview.text);
  if(action==='fragmentsave')return saveDemoFile();
  if(action==='fragmentview')return fragmentDialog(kind,decodeURIComponent(value),'',true);
}
function demoFilesList(kind){
  const files=Object.keys(model.demoFiles?.[appKey()]||{}).filter(file=>file.endsWith(fragmentSuffix(kind)));
  return files.map(file=>b(file,'fragmentview:'+encodeURIComponent(file)+':'+kind,'plain')).join('');
}


