'use strict';
const names={build:'构建',workspace:'工作区',graph:'工程配置',modules:'模块'};
const initial={app:'hello_world',board:'mps2/an386',method:'west',conf:'y',configured:true,built:false,modules:[
 ['cmsis_6','构建记录 · 示例','1c1840af7a7e757d6e2fec3ddb0e5ce0dfcc93c8','已同步',true],['cmsis','工作区清单','512cc7e895e8491696b61f7ba8066b4a182569b8','未下载',false],['mbedtls','工作区清单','c43f34b93797e81fd0257c30004dcd0ae332ae51','版本不同',false],['lvgl','工作区清单','d1fe35d350a1503db2ec7fd4dfff8e0cc26eea7e','已同步',false]]};
function route(key){return Object.hasOwn(names,key)?key:'workspace';}
let model=structuredClone(initial),page=route(location.hash.slice(1)),node='kconfig',draft={},query='',detached,timer;
initDemo();
const $=s=>document.querySelector(s),dir=()=>model.bin||'build/'+model.board.replaceAll('/','_');
captureExampleCache();


function buildRequirements(plan){
 const west=model.method==='west',issues=[...plan.issues];
 const generator=matchingExampleCache()?.values.CMAKE_GENERATOR?.value||plan.generator||'Ninja';
 const tools=['CMake',...(/^Ninja/i.test(generator)?['Ninja']:[]),...(west?['west']:[])];
 for(const name of tools){
   if(!settingsFor(name).ok)issues.push({message:'尚未找到 '+name+' 可执行文件。',action:'tool:'+name,label:'配置 '+name});
 }
 if(west&&!workspaceState())issues.push({message:'west build 需要含 .west/config 的工作区。',action:'wsopen',label:'打开已有工作区'});
 if(!model.app&&!model.source)issues.push({message:'尚未选择包含 CMakeLists.txt 的 Zephyr 应用。',action:'app',label:'选择应用'});
 if(!model.board&&!model.projectBoard)issues.push({message:'尚未选择开发板与 CPU。',action:'board',label:'选择目标'});
 const missingModules=currentModules().filter(m=>m[4]&&m[3]==='未下载').map(m=>m[0]);
 if(missingModules.length)issues.push({message:'所选模块尚未下载：'+missingModules.join('、'),action:'page:modules',label:'管理模块'});
 const build=[...issues];
 if(!model.configured||!matchingExampleCache())build.push({message:'当前目标需要先配置构建目录。',action:'configure',label:'配置'});
 return {configure:issues,build};
}

function runBuildAction(action){
 const requirements=buildRequirements(exampleBuildInputs());
 if(requirements[action].length){
   demo_build_view.target(demo_build_target()).action=action;render();
   $('#build-readiness').open=true;
   const control=$('#build-readiness summary');control?.focus();control?.scrollIntoView({block:'nearest'});
   return;
 }

 if(action==='configure'){captureExampleCache();model.configured=true;model.built=false;notify('示例配置完成');}
 else {model.built=true;notify('示例构建完成');}
 commitDemo();
}
function render() {
  capture_demo_build();
  studioState();
  document.body.classList.toggle('studio-window', studioWindow);
  renderContext();
  renderDebugSide();
  document.querySelector('nav').innerHTML=Object.entries(names).map(([key,label])=>
    '<button data-act="page:'+key+'"'+(key===page?' aria-current="page"':'')+'>'+
    ico(key==='workspace'?'folder':key)+esc(label)+'</button>').join('');
  const pages={build:buildPage,graph:studioPage,workspace:workspacePage};
  if (debugSide.source&&!studioWindow) $('#main').innerHTML=debugSource();
  else if (page==='modules') renderModulePage($('#main'));
  else $('#main').innerHTML=pages[page]();
  if(page==='build')restore_demo_build();
  if(page==='graph'){
    demoWorkspace.attach(Object.keys(draft).length);
    designTree.attach($('#main'));
  }else demoWorkspace.leave();
  $('#theme').innerHTML=ico('theme');
}
function notify(s){clearTimeout(timer);$('#notice').textContent=s;timer=setTimeout(()=>$('#notice').textContent='',2600)}
function publish(view){const peer=window.opener||detached;if(peer&&!peer.closed)peer.postMessage({type:'zephyr-design-state',model,draft,appearance:appearance.settings,view},'*')}
addEventListener('message',event=>{
  if(!event.source||(event.source!==window.opener&&event.source!==detached))return;
  if(event.origin!==location.origin&&!(location.protocol==='file:'&&['null','file://'].includes(event.origin)))return;
  const message=event.data;
  if(message?.type==='zephyr-design-open'){
    publish(openingStudioView||demoStudioSnapshot());
    openingStudioView=undefined;
    return;
  }
  if(!['zephyr-design-state','zephyr-design-return'].includes(message?.type))return;
  model=message.model;draft=message.draft;
  if(message.appearance)appearance.receive(message.appearance);
  restoreDemoStudio(message.view);
  if(message.type==='zephyr-design-return')go('graph');else render();
});
function show(title,body){$('#dialog-title').textContent=title;$('#dialog-body').innerHTML=body;if(!$('#dialog').open)$('#dialog').showModal()}
const designPicker=createTargetPicker({
  load(kind,request){
    const choices={board:[model.board,'mps2/an386','qemu_cortex_m3','nrf5340dk/nrf5340/cpuapp','nrf5340dk/nrf5340/cpunet',...(model.knownBoards||[])],app:[model.app,'hello_world','synchronization'],build:[dir(),'build/'+model.board.replaceAll('/','_'),'build']};
    designPicker.results({picker:request,items:[...new Set(choices[kind])]});
  },
  select(kind,value){
    if(kind==='build'){model.bin=value;invalidate();return commitDemo();}
    handle('pick:'+kind+':'+value);
  },
  boardChoice(value){
    if(value!==null)return handle('pick:board:'+value);
    if(Object.keys(draft).length)return notify('请先保存或放弃配置图草稿');
    model.projectBoard=true;
    invalidate();commitDemo();
  }
});
function pick(kind,button){
  const trigger=button||$('[data-act="'+(kind==='build'?'projdir':kind)+'"]');
  if(trigger)designPicker.show(kind,trigger);
}
function go(k){debugSide.source=false;clearTimeout(timer);$('#notice').textContent='';k=route(k);page=k;if(location.hash!=='#'+k)location.hash=k;render();window.scrollTo(0,0)}
function handle(action,button){const [a,v,x]=action.split(':');
 if(a==='flash')return flashPanel.action(v,demoFlashAction);
 if(a==='probe')return demoProbeAction(v,x);
 if(a==='demoFlash')return demoFlashConfirm(v);
 if(a==='setup')return demo_toolchain_action(v,x);
 if(a.startsWith('path'))return pathActions(a,v,x);
 if(a.startsWith('fragment'))return fragmentActions(a,v,x);
 if(a==='discoveryapply'||a==='discoverysave')return applyDiscovery(a==='discoverysave');
 if(a==='detach'||a.startsWith('studio')||['symbol','newsymbol','symbolcreate'].includes(a))return studioAction(a,v);
 if(a==='side')return sidebarAction(v);
 if(a==='page')return go(v);
 if(a.startsWith('context'))return contextAction(a,v);
 if(a.startsWith('origin'))return originAction(a,v);
 if(/^(env|profile$|policy$|projecttools$|tool$|prepare$|local$|known$|source$|inherit$)/.test(a))return envAction(a,v);
 if(a.startsWith('ws'))return wsAction(a,v);
 if(a==='build-apply')return apply_demo_arguments();
 if(a==='projdir')return pick('build',button);
 if(a.startsWith('proj'))return projectAction(a,v);
 if(a==='node'){node=v;return go('graph')}
 if(a==='app'||a==='board')return pick(a,button);
 if(a==='pick'){if(model[v]!==x&&Object.keys(draft).length){$('#dialog').close();notify('请先在配置图保存或放弃当前目标的草稿');return}$('#dialog').close();if(v==='board')model.projectBoard=false;if(model[v]!==x){model[v]=x;if(v==='app')model.source='';model.configured=false;model.built=false}}
 if(a==='method'&&v!==model.method){model.method=v;invalidate()}
 if(a==='configure'||a==='build')return runBuildAction(a);
 if(a==='discard')draft={};
 if(a==='save')return saveStudio();

 if(a==='sync'||a==='syncsingle')return openSyncPlan(currentModules().filter(m=>m[5]?.kind!=='local'&&(a==='sync'&&v==='chosen'?m[4]:m[0]===v)));
 if(a.startsWith('syncplan'))return syncPlanAction(a,Number(v));
 if(a==='result')return show(v,'<p class="subtle">'+esc(dir()+'/zephyr/'+v)+'</p><pre class="terminal">'+esc(v==='.config'?(model.conf==='移除显式赋值'?'由 Kconfig 在配置时求值':'CONFIG_PRINTK='+model.conf):'ELF · 示例构建产物')+'</pre>');
 publish();render()}
document.addEventListener('click',e=>{const source=e.target.closest('[data-devicetree-path]');if(source)return showDevicetreeExample(source.dataset.devicetreePath);
 const el=e.target.closest('[data-node]');if(el){if(el.dataset.node==='deviceBase')return showDevicetreeExample(currentExampleDevicetree().boardFile);
 node=el.dataset.node;render();$('[data-node="'+node+'"]')?.focus();return}const btn=e.target.closest('[data-act]');if(btn)handle(btn.dataset.act,btn)});
document.addEventListener('keydown',e=>{if(e.target.closest('[data-node]')&&['Enter',' '].includes(e.key)){e.preventDefault();e.target.closest('[data-node]').dispatchEvent(new MouseEvent('click',{bubbles:true}))}});
document.addEventListener('input',e=>{if(e.target.id==='choice-filter')for(const item of document.querySelectorAll('[data-act^="pick:"]'))item.hidden=!fuzzy(item.textContent,e.target.value.trim().toLowerCase())});
document.addEventListener('change',e=>{if(e.target.dataset.select){currentModules().find(m=>m[0]===e.target.dataset.select)[4]=e.target.checked;invalidate();publish();render()}});
const appearance_key = 'zephyr-workbench.appearance';
const color_scheme = matchMedia('(prefers-color-scheme: dark)');
const appearance = new workbench_appearance({
  document, button: $('#theme'), system_label: '跟随系统',
  system_theme: () => color_scheme.matches ? 'dark' : 'light',
  save: changes => {
    const next = {...appearance.settings, ...changes};
    try { localStorage.setItem(appearance_key, JSON.stringify(next)); } catch { /* The current window retains the preference. */ }
    publish();
  }
});
function restore_appearance() {
  try { appearance.receive(JSON.parse(localStorage.getItem(appearance_key)) || {}); }
  catch { appearance.receive(); }
}
restore_appearance();
color_scheme.addEventListener('change', () => appearance.refresh_theme());
addEventListener('storage', event => { if(event.key === appearance_key) restore_appearance(); });
addEventListener('hashchange',()=>{const next=route(location.hash.slice(1));if(next!==page){page=next;render()}});render();if(window.opener)window.opener.postMessage({type:'zephyr-design-open'},'*');













