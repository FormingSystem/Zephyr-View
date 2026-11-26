'use strict';
const host=acquireVsCodeApi();
const $=s=>document.querySelector(s);
let page='',query='',model={method:'west',env:{offline:true}},workspace,live,sequence=0;
const appKey=()=>live?.app||live?.folder||'独立应用';
const workspaceState=()=>workspace;
const initial={modules:[]};
const pendingRequests=new Map();
const stored=()=>host.getState()||{};
const persist=data=>host.setState({...stored(),...data});
function send(action,id){host.postMessage({action,id,version:live?.version});}
function rpc(op,value){
  const request=++sequence;
  return new Promise((resolve,reject)=>{pendingRequests.set(request,{resolve,reject});host.postMessage({action:'module',request,op,value,scope:live?.moduleScope});});
}
window.addEventListener('message',({data})=>{
  if(!pendingRequests.has(data?.reply))return;
  const task=pendingRequests.get(data.reply);pendingRequests.delete(data.reply);
  if(data.error)task.reject(Error(data.error));else task.resolve(data.value);
});
function show(title,body){
  $('#dialog-title').textContent=title;$('#dialog-body').innerHTML=body;
  if(!$('#dialog').open)$('#dialog').showModal();
}
let toast;
function notify(message){clearTimeout(toast);$('#notice').textContent=message;toast=setTimeout(()=>$('#notice').textContent='',4500);}
function render(){
  if(page!=='modules')return;
  const main=$('#main');
  renderModulePage(main);
  const notices = discovery_diagnostics(live?.discoveryIssues);
  if (notices) (main.querySelector('.module-sections') || main.firstElementChild)?.insertAdjacentHTML('beforebegin', notices);
  if(live?.manifestScope==='partial'){
    const note=document.createElement('p');
    note.textContent=tr('导入清单未解析，仅显示直接声明和手动添加的模块。','Manifest imports are unresolved. Only direct and manually added modules are shown.');
    main.insertBefore(note,main.querySelector('.module-sections'));
  }
}
const zephyrModules=globalThis.zephyrModules={
  scope:()=>JSON.stringify([live?.folder,live?.moduleScope]),
  inspect:dir=>rpc('inspect',dir),
  resolve:p=>rpc('resolve',{name:p.name,mode:p.mode,branch:p.branch}),
  async folder(typed=false){
    const dir=await rpc('folder',typed);if(!dir)return;
    query=dir;$('#filter').value=ZephyrPathDisplay.path(dir);previewSource('local',dir);
  },
  async add(entry){await rpc('add',entry);query='';notify(tr('已加入当前工程。','Added to project.'));},
  info(m){show(m[0],row('模块目录',ZephyrPathDisplay.path(m[5].path))+row('来源',m[1]));},
  async apply(plan){
    if(plan.applying)return;
    const rows=plan.rows.filter(p=>p.target!==p.state.head);
    plan.applying=true;plan.message='';showSyncPlan();
    try {
      const results=await rpc('apply',{network:plan.network,rows:rows.map(p=>({name:p.name,target:p.target,head:p.state.head,ref:p.ref}))});
      if(plan!==syncPlan||!$('#dialog').open)return;
      for(const [i,result] of results.entries()){
        const p=rows[i];
        p.outcome=result;
        if(result.status==='complete'){
          p.state.head=p.target;
          if(!p.state.objects.includes(p.target))p.state.objects.push(p.target);
        }
      }
      if(results.every(result=>result.status==='complete')){
        $('#dialog').close();notify(tr('模块同步完成。','Module sync complete.'));
      }
    }catch(e){plan.message=e.message;}
    finally{
      plan.applying=false;
      if(plan===syncPlan&&$('#dialog').open)showSyncPlan();
    }
  }
};
function displayModuleState(data){
  if(live && (live.moduleScope!==data.moduleScope || live.page!==data.page)){
    if($('#dialog').open)$('#dialog').close();
    resetRecognition();query='';
  }
  live=data;page=data.page;
  if(page!=='modules')return;
  const mods=data.moduleRows||[],root=data.root;
  workspace=root?{name:ZephyrPathDisplay.path(root).split('/').filter(Boolean).pop(),repo:root,manifest:data.manifest||'west.yml',mods}:undefined;
  model={method:data.method,env:{offline:stored().offline!==false},activeWs:root,localModules:{[appKey()]:mods}};
  render();
  if(!data.folder){
    $('#main').innerHTML=heading(document.title,'模块','打开工程后即可读取该工程的模块。','')+panel('工程',wrap(b('打开文件夹…','nativefolder')));
  }
}
async function moduleAction(action){
  const sep=action.indexOf(':'),kind=sep<0?action:action.slice(0,sep),value=sep<0?'':action.slice(sep+1);
  if(kind==='modulepath')return zephyrModules.folder(true);
  if(kind==='nativefolder')return send('folder');
  if(kind==='context')return modePicker();
  if(kind==='contextchoose'||kind==='method'){$('#dialog').close();return send('method',value);}
  if(kind==='page')return send('page',({tools:'workspace',graph:'configuration'})[value]||value);
  if(page!=='modules')return;
  if(kind==='policy'){
    show(tr('来源策略','Source policy'),b(tr('默认离线','Offline by default'),'network:off',model.env.offline?'primary':'')+b(tr('默认允许联网','Allow network by default'),'network:on',model.env.offline?'':'primary'));return;
  }
  if(kind==='network'){persist({offline:value!=='on'});model.env.offline=value!=='on';$('#dialog').close();return render();}
  if(kind.startsWith('origin'))return originAction(kind,value);
  if(kind==='sync'||kind==='syncsingle')return openSyncPlan(currentModules().filter(m=>m[5]?.kind!=='local'&&
    (kind==='sync'&&value==='chosen'?m[4]:m[0]===value)));
  if(kind.startsWith('syncplan'))return syncPlanAction(kind,Number(value));
}
document.addEventListener('click',event=>{
  const control=event.target.closest('[data-act]');
  if(control)moduleAction(control.dataset.act).catch(e=>notify(e.message));
});
document.addEventListener('change',event=>{
  const box=event.target;
  if(page==='modules'&&box.dataset.select){
    pendingModuleFocus=moduleControlFocus($('#main'));
    box.disabled=true;
    rpc('select',{name:box.dataset.select,checked:box.checked}).catch(e=>{
      box.checked=!box.checked;
      box.disabled=false;
      if (document.activeElement===document.body) restoreModuleFocus(pendingModuleFocus);
      pendingModuleFocus=undefined;
      notify(e.message);
    });
  }
});
const appearance = new workbench_appearance({
  document,
  button: $('#theme'),
  system_theme: () => document.body.matches('.vscode-dark, .vscode-high-contrast:not(.vscode-high-contrast-light)') ? 'dark' : 'light',
  system_label: tr('跟随 VS Code', 'Follow VS Code'),
  save: changes => host.postMessage({action:'appearance', changes})
});
appearance.receive({theme:stored().theme});
window.addEventListener('message', ({data}) => {
  if (data?.appearanceSettings) {
    const settings = data.appearanceSettings;
    appearance.receive({...settings, theme:settings.theme ?? stored().theme});
    if (settings.theme && stored().theme) persist({theme:undefined});
  }
});
new MutationObserver(() => appearance.refresh_theme()).observe(document.body, {attributes:true, attributeFilter:['class']});
document.querySelector('body > footer')?.remove();
document.querySelector('header nav').setAttribute('aria-label', tr('工作台', 'Workbench'));
$('#sidebar-toggle').remove();
$('#debug-side').remove();
$('#theme').innerHTML=ico('theme');
