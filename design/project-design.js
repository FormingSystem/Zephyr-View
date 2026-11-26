'use strict';
const workflowNames=['工程设置','测试'];
const exampleAppId=()=>JSON.stringify([model.activeWs||'',appKey()]);
const exampleArguments=()=>model.argumentsByApplication?.[exampleAppId()]||'';
function parseExampleDefinition(line){
  const match=/^\s*(?:-D)?([A-Za-z_]\w*)(?::(\w+))?\s*=(.*)$/.exec(line);
  if(!match)throw new Error('请每行填写一个 NAME=value 或 NAME:TYPE=value。');
  const [,name,type,value]=match;
  if(name==='BOARD' && !model.projectBoard && value!==model.board)throw new Error('如需使用参数中的 BOARD，请在开发板列表选择「使用工程设置」。');
  return {name,type:type||'UNINITIALIZED',value,source:'用户参数',argument:'-D'+name+(type?':'+type:'')+'='+value};
}
function userExampleDefinitions(text){
  return text.split(/\r?\n/).filter(line=>line.trim()).map(parseExampleDefinition).filter(d=>model.projectBoard || d.name!=='BOARD');
}
function exampleBuildInputs(){
  let definitions=[];
  const issues=[];
  try{definitions=demo_target_compiler_inputs(userExampleDefinitions(exampleArguments()));}
  catch(error){issues.push({message:error.message,action:'projargs',label:'编辑附加参数'});}
  for (const [kind,files] of Object.entries(demo_file_choices())) {
    const variable=demo_input_variables[kind];
    definitions=definitions.filter(entry=>entry.name!==variable);
    const value=files.map(file=>ZephyrPathDisplay.relative(file,appKey())).join(';');
    definitions.push({...parseExampleDefinition(variable+'='+value),source:'手动选择'});
  }
  const roots=demo_board_roots(),existing=definitions.find(row=>row.name==='BOARD_ROOT');
  if(roots.length){
    const value=[...new Set([...(existing?.value.split(';')||[]),...roots])].join(';');
    if(existing){existing.value=value;existing.argument='-DBOARD_ROOT='+value;}
    else definitions.push({...parseExampleDefinition('BOARD_ROOT='+value),source:'工作区开发板目录'});
  }
  const flag=moduleFlag();
  if(flag){
    const entry=parseExampleDefinition(flag);
    if(!definitions.some(d=>d.name===entry.name)){
      definitions.push({...entry,value:entry.value.replace(/^"(.*)"$/,'$1'),source:'所选模块'});
    }
  }
  const generator=model.method==='CMake'&&!exampleCache()?'Ninja':'';
  const inputs=[
    {name:'BOARD',value:model.board,source:model.projectBoard?'工程设置':model.method==='west'?'west -b':'CMake -DBOARD'},
    {name:'APPLICATION_SOURCE_DIR',value:appKey(),type:'PATH',source:model.method==='west'?'west 应用目录':'CMake -S'},
    {name:'CMAKE_CACHEFILE_DIR',value:dir(),type:'INTERNAL',source:model.method==='west'?'west -d':'CMake -B'},
    ...(generator?[{name:'CMAKE_GENERATOR',value:generator,type:'INTERNAL',source:'CMake -G'}]:[]),
    ...definitions
  ];
  if(exampleCache()&&!matchingExampleCache())issues.push({message:'此构建目录的缓存属于其他目标。',action:'projdir',label:'选择构建目录'});
  return {definitions,generator,issues,inputs:new Map(inputs.map(row=>[row.name,row]))};
}
function exampleCache(){
  return model.exampleCaches?.[JSON.stringify([model.activeWs||'',dir()])];
}
function matchingExampleCache(){
  const cache=exampleCache();
  return cache?.app===appKey()&&cache.board===model.board?cache:undefined;
}
function exampleDevicetree(plan) {
  const generatedFile=dir()+'/zephyr/zephyr.dts';
  // Only the stock sample has a captured board / overlay combination in the prototype.
  if(appKey()!=='samples/hello_world'||model.board!=='mps2/an386'||
     plan.definitions.some(entry=>entry.source==='用户参数'))return {generatedFile};
  const overlays=Object.hasOwn(model.demoFiles?.[appKey()]||{},'app.overlay')?[appKey()+'/app.overlay']:[];
  return {boardFile:'boards/arm/mps2/mps2_an386.dts',overlays,generatedFile};
}
function currentExampleDevicetree(){
  const configured=model.configured && matchingExampleCache()?.devicetree;
  if(configured)return {...configured,boardSource:'configured'};
  if(model.board==='mps2/an386')return {boardFile:'boards/arm/mps2/mps2_an386.dts',boardSource:'detected'};
  return {};
}
function captureExampleCache(){
  const values=Object.assign(Object.create(null),matchingExampleCache()?.values);
  const plan=exampleBuildInputs();
  for(const input of plan.inputs.values())values[input.name]={value:input.value,type:input.type||'STRING'};
  // The fixture represents a successful Ninja configuration of the sample application.
  values.CMAKE_GENERATOR??={value:'Ninja',type:'INTERNAL'};
  const compilers=demo_compiler_catalog();
  const candidate=compilers.options.find(item=>item.selected)||compilers.options.find(item=>item.id===compilers.recommendedId);
  if(candidate)values.CMAKE_C_COMPILER={value:candidate.path,type:'FILEPATH'};
  for(const input of exampleEnvironment()){
    if(!plan.inputs.has(input.name))values[input.name]={value:input.value,type:'STRING'};
  }
  const key=JSON.stringify([model.activeWs||'',dir()]);
  (model.exampleCaches??={})[key]={app:appKey(),board:model.board,values,devicetree:exampleDevicetree(plan)};
}
function exampleVariableRow(name,input,cache,absent='本次未传入'){
  const line=(label,{value,type})=>'<div class="variable-reading"><small>'+esc(label)+'</small><code class="environment-value">'+esc(value===''?'（空字符串）':ZephyrPathDisplay.variable(name,value,type))+'</code></div>';
  const source=input?line('本次传入 · '+input.source,input):'<small>'+esc(absent)+'</small>';
  const recorded=cache?line('CMakeCache.txt · '+cache.type,cache):'<small>缓存未记录</small>';
  return '<div class="environment-field"><strong>'+esc(name)+'</strong>'+source+recorded+'</div>';
}
function exampleVariableDetails(title,rows,render){
  if(!rows.length)return '';
  return '<details class="variable-details"><summary>'+esc(title)+' ('+rows.length+')</summary>'+rows.map(row=>'<div>'+render(row)+'</div>').join('')+'</details>';
}
function exampleBuildVariables(plan) {
  const cache=matchingExampleCache();
  const inputs=new Map(exampleEnvironment().map(row=>[row.name,{...row,source:'env'}]));
  for(const [name,row] of plan.inputs)inputs.set(name,row);
  const names=[...new Set(['BOARD','CMAKE_GENERATOR',...inputs.keys(),...Object.keys(cache?.values||{})])];
  const rows=names.map(name=>({name,planned:inputs.get(name),configured:cache?.values[name]&&{...cache.values[name],source:name}}));
  return build_variables({rows,status:cache?'current':exampleCache()?'conflict':'absent'});
}
function projectActions(){
 const selected=model.flow==='test'?1:0,actions=groupTabs(workflowNames,selected,'projtab');
 const view=[
 '<div class="controlbar">'+b('导入本地应用','projimport')+b('从示例新建','projnew')+b('工程工具覆盖','projecttools')+'</div>',
 row('测试根目录','tests / samples')+row('平台',model.board)+'<div class="controlbar">'+b('预览测试矩阵','projtest')+'</div>'
 ][selected];
 return panel('工程操作',wrap(view+(model.lastTask?'<small>最近任务 · '+esc(model.lastTask)+'</small>':'')),actions);
}
function projectAction(a,v){if(a==='projtab')model.flow=['build','test'][Number(v)];
 else if(a==='projimport'||a==='projnew'){return show(a==='projnew'?'从示例新建应用':'导入应用','<p>'+(a==='projnew'?'选择模板并指定独立的应用目录。':'选择包含 CMakeLists.txt 的应用目录。')+'</p>'+(a==='projnew'?'<label>模板<select id="apptemplate"><option>hello_world</option><option>synchronization</option></select></label>':'')+locationInput('appsource','应用目录','applications/my_app')+b(a==='projnew'?'创建示例副本':'采用此应用','projapply:'+a,'primary'))}
 else if(a==='projapply'){if(Object.keys(draft).length){notify('请先处理当前配置草稿');return}const source=$('#appsource').value.trim().replaceAll('\\','/').replace(/\/+$/,'');if(!source)return;model.source=source;model.app=source.split('/').pop();model.bin='';model.image='';model.prefs={};model.lastTask=v==='projnew'?'创建示例副本 · '+$('#apptemplate').value:'导入已有应用';$('#dialog').close();invalidate()}
 else if(a==='projdir'||a==='projargs'){return show(a==='projdir'?'构建目录 · -B':'附加 CMake 参数','<label>'+(a==='projdir'?'目标目录':'每行一个参数，保留用户输入')+'<textarea class="input" id="projvalue" rows="3">'+esc(a==='projdir'?ZephyrPathDisplay.path(dir()):exampleArguments())+'</textarea></label>'+b('应用','projvalue:'+a,'primary'))}
 else if(a==='projvalue'){
   const field=$('#projvalue'),value=field.value.trim();field.setCustomValidity('');
   if(v==='projdir')model.bin=value;
   else {
     try{userExampleDefinitions(value);}catch(error){field.setCustomValidity(error.message);field.reportValidity();return;}
     (model.argumentsByApplication??={})[exampleAppId()]=value;
   }
   $('#dialog').close();invalidate();
 }
 else if(a==='projtest'){return show('测试计划 · Twister','<pre class="terminal">'+esc('twister -T tests -p '+model.board)+'</pre>')}
 else return false;
 commitDemo();return true}


const narrowEditor=matchMedia('(max-width: 980px)');
const debugSide={open:undefined,phase:'idle',step:0,frame:0,source:false,closed:new Set(),target:null};
const sideShown=()=>debugSide.open??!narrowEditor.matches;
function sideGroup(id,title,body){
  return '<details data-section="'+id+'" '+(debugSide.closed.has(id)?'':'open')+'><summary>'+title+'</summary><div class="side-body">'+body+'</div></details>';
}
function sideLine(label,value){
  return '<div class="side-line"><small>'+esc(label)+'</small><span title="'+esc(value)+'">'+esc(value)+'</span></div>';
}
function debuggerControls(){
  const phase=debugSide.phase;
  if(phase==='idle')return b('启动调试演示','side:start','primary','play');
  return b(phase==='paused'?'继续':'暂停','side:resume')+(phase==='paused'?b('单步','side:step'):'')+b('停止','side:stop','plain');
}
function renderDebugSide(){
  const el=$('#debug-side'),shown=!studioWindow&&sideShown();
  $('#sidebar-toggle').setAttribute('aria-expanded',String(shown));
  document.body.classList.toggle('side-visible',shown);
  el.hidden=!shown;
  if(!shown)return;
  const t=debugSide.target||{app:model.app,board:model.board,build:dir(),runner:model.prefs.runner||'待构建元数据确认'};
  const paused=debugSide.phase==='paused',running=debugSide.phase==='running';
  const stack=paused?'<small>主线程 · 已暂停</small>'+b('main　main.c:'+String(4+debugSide.step),'side:mainframe','stack-frame')+b('bg_thread_main　init.c:2','side:caller','stack-frame'):'<small>'+(running?'暂停后可查看栈帧。':'启动后显示线程和栈帧。')+'</small>';
  el.innerHTML='<div class="side-title">运行和调试</div><div class="side-controls">'+debuggerControls()+'</div>'+
    sideGroup('target','Zephyr 调试目标',sideLine('应用',ZephyrPathDisplay.directory(t.app))+sideLine('开发板',t.board)+sideLine('构建目录',ZephyrPathDisplay.directory(t.build))+sideLine('调试运行器',t.runner)+
      '<div class="side-links">'+b('工程配置','side:config','plain')+b('启动配置','side:launch','plain')+'</div>')+
    sideGroup('variables','变量',paused?(debugSide.frame===0?sideLine('counter',debugSide.step===2?'1':debugSide.step===1?'0':'尚未初始化'):'<small>当前栈帧无示例局部变量。</small>'):'<small>暂停时显示局部变量。</small>')+
    sideGroup('watch','监视',paused&&debugSide.frame===0?sideLine('counter',debugSide.step===2?'1':debugSide.step===1?'0':'尚未初始化'):'<small>暂停后可查看表达式。</small>')+sideGroup('stack','调用堆栈',stack)+sideGroup('break','断点','<small>示例 · src/main.c:4</small>')+
    '<small class="side-foot">设计预览 · 调试数据为示例</small>';
}
function debugSource(){
  const caller=debugSide.frame===1, filename=caller?'init.c':'src/main.c';
  const code=caller?['void bg_thread_main(void) {','    main();','}']:['#include <zephyr/kernel.h>','','int main(void) {','    int counter = 0;','    ++counter;','    return counter;','}'];
  const current=caller?2:4+debugSide.step;
  return heading(debugSide.target?.app||model.app,filename,'调试演示源文件',b('返回工作台','side:editor'))+
    '<div class="side-code">'+code.map((line,i)=>'<div class="'+(debugSide.phase==='paused'&&i+1===current?'active-line':'')+'"><span>'+String(i+1)+'</span><code>'+esc(line)+'</code></div>').join('')+'</div>';
}
function sidebarAction(action){
  if(action==='toggle')debugSide.open=!sideShown();
  else if(action==='start'){
    debugSide.phase='paused';debugSide.frame=0;debugSide.step=0;debugSide.source=true;
    debugSide.target={app:model.app,board:model.board,build:dir(),runner:model.prefs.runner||'示例调试适配器'};
  }else if(action==='stop'){debugSide.phase='idle';debugSide.source=false;debugSide.target=null;}
  else if(action==='resume')debugSide.phase=debugSide.phase==='paused'?'running':'paused';
  else if(action==='step'){debugSide.step=(debugSide.step+1)%3;debugSide.frame=0;debugSide.source=true;}
  else if(action==='editor')debugSide.source=false;
  else if(action==='config'){if(narrowEditor.matches)debugSide.open=false;return go('graph');}
  else if(action==='launch')return show('启动配置','<code>.vscode/launch.json</code><p>在 VS Code 中从当前工作区选择启动配置。硬件连接和调试会话由该配置的调试适配器提供。</p>');
  else if(action==='mainframe'||action==='caller'){debugSide.frame=action==='caller'?1:0;debugSide.source=true;if(narrowEditor.matches)debugSide.open=false;}
  render();
}
document.addEventListener('toggle',e=>{if(!e.target.matches?.('#debug-side details')||!e.target.isConnected)return;
  if(e.target.open)debugSide.closed.delete(e.target.dataset.section);else debugSide.closed.add(e.target.dataset.section);
},true);
narrowEditor.addEventListener('change',()=>render());

// Browsers only disclose a chosen entry's name. Native VS Code owns full filesystem paths.
async function chooseBrowserEntry(directory,accept='') {
  if(directory && typeof window.showDirectoryPicker==='function'){
    try {return await window.showDirectoryPicker({mode:'read'});}
    catch(error){if(error.name!=='AbortError')notify('浏览器未允许选择目录，可改用「输入路径」。');}
    return;
  }
  const input=document.createElement('input');
  input.type='file';input.accept=accept;
  if(directory)input.webkitdirectory=true;
  return new Promise(resolve=>{
    input.oncancel=()=>resolve();
    input.onchange=()=>{
      const file=input.files[0];
      resolve(directory&&file?{name:file.webkitRelativePath.split('/')[0]}:file);
    };
    input.click();
  });
}
function locationInput(id,label,value='',file=false){
  return inputField(id,label,ZephyrPathDisplay.path(value),'绝对路径或工作区相对路径')+
    b(file?'浏览文件…':'浏览目录…','pathfield:'+id+':'+(file?'file':'directory'),'plain');
}
async function fillLocation(id,kind){
  const input=document.getElementById(id);
  if(!input)return;
  const entry=await chooseBrowserEntry(kind==='directory');
  if(!entry||!input.isConnected)return;
  input.value=entry.name;
  input.dispatchEvent(new Event('input',{bubbles:true}));
  input.focus();
  notify('浏览器返回所选名称。演示中可补全路径；相对目录从工作区解析。');
}
function directoryButtons(kind){
  return b('浏览目录…','pathbrowse:'+kind)+
    b(kind==='app'?'搜索应用':'已知目录',kind==='app'?'app':'projdir','plain')+
    b('输入路径','pathtype:'+kind,'plain');
}
function directoryActions(kind){
  return '<div class="actions">'+directoryButtons(kind)+'</div>';
}
function buildTargetRow(kind,label,value){
  const buttons=kind==='board'?b('选择目标','board','plain'):directoryButtons(kind);
  return targetFieldRow(label,value,value,buttons);
}
async function chooseTargetPath(kind,browse){
  const target=studioTarget(),entry=browse&&await chooseBrowserEntry(true);
  if((browse&&!entry)||target!==studioTarget())return;
  show(kind==='app'?'应用目录':'构建目录',inputField('target-location','目录',ZephyrPathDisplay.path(browse?entry.name:kind==='app'?appKey():dir()))+
    '<small>'+ (browse?'浏览器只提供名称，可补全其工作区相对路径或绝对路径。':'相对路径从当前工作区解析，也可输入绝对路径。')+
    '</small>'+b('应用到示例','pathaccept:'+kind,'primary'));
}
function applyTargetPath(kind){
  const value=inputValue('#target-location').replaceAll('\\','/');
  if(!value)return;
  if(kind==='app'){
    if(Object.keys(draft).length)return notify('请先处理当前目标的草稿。');
    model.source=value;model.app=value.split('/').filter(Boolean).pop()||value;
  }else model.bin=value;
  invalidate();$('#dialog').close();commitDemo();
}

function pathActions(action,value,kind){
  if(action==='pathfield')return fillLocation(value,kind);
  if(action==='pathbrowse'||action==='pathtype')return chooseTargetPath(value,action==='pathbrowse');
  if(action==='pathaccept')return applyTargetPath(value);
}
