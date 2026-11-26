'use strict';
const targetPicker=createTargetPicker({
  load:(kind,request)=>send('targetList',{kind,request}),
  select:(kind,value)=>send('targetSelect',{kind,value}),
  boardChoice:value=>send('targetBoard',{kind:'board',value}),
  browse:kind=>kind==='board'?send('environment','ZEPHYR_BASE'):send('targetBrowse',{kind})
});
function targetControls(kind,disabled=false){
  const action=(label,route)=>b(label,'target:'+route+':'+kind,'','',disabled);
  if(kind==='board')return action(tr('选择目标','Select target'),'search');
  const app=kind==='app';
  return action(app?tr('选择应用目录…','Select application folder…'):tr('选择构建目录…','Select build folder…'),'browse')+
    action(app?tr('搜索应用','Search applications'):tr('查找构建目录','Find build folders'),'search')+
    action(tr('输入路径…','Enter path…'),'path');
}
function targetField(kind,label,value,display,disabled=false){
  return targetFieldRow(label,value,display,targetControls(kind,disabled));
}
document.addEventListener('click',e=>{
  const button=e.target.closest('[data-act^="target:"]');
  if(!button||button.disabled)return;
  const [,route,kind]=button.dataset.act.split(':');
  if(route==='search')targetPicker.show(kind,button);
  else {
    targetPicker.close();
    send('targetBrowse',{kind,typed:route==='path'});
  }
});
window.addEventListener('message',({data})=>targetPicker.results(data));

document.addEventListener('click',event=>{
  const button=event.target.closest('button[data-input-action],button[data-input-path]');
  if(!button || button.disabled)return;
  if(button.dataset.inputPath)return send('viewConfigurationInput',button.dataset.inputPath);
  send('chooseConfigurationInput',{kind:button.dataset.inputKind,action:button.dataset.inputAction});
});
