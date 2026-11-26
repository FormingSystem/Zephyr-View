'use strict';

const designTree=createConfigurationTree(editDesignNode);
const exampleMenus={
  CONFIG_PRINTK:['OS Support','Logging'],CONFIG_LOG:['OS Support','Logging'],CONFIG_SERIAL:['Drivers','Serial'],
  CONFIG_GPIO:['Drivers','GPIO'],CONFIG_MAIN_STACK_SIZE:['General Kernel Options'],CONFIG_BT_DEVICE_NAME:['Bluetooth']
};
function designTreeState(){
  const tree={...currentExampleDevicetree()},items=symbolNames().map(key=>({name:key,prompt:key,
    type:symbolTypes[key]||'string',value:draft[symbolDraft(key)]??savedSymbol(key),menuPath:exampleMenus[key]||[]}));
  if(tree.boardFile==='boards/arm/mps2/mps2_an386.dts')tree.catalog={nodes:[
    {path:'/',parent:null,name:'/',labels:[],status:'okay'},
    {path:'/soc',parent:'/',name:'soc',labels:[],status:'okay'},
    {path:'/soc/uart@40004000',parent:'/soc',name:'uart@40004000',labels:['uart0'],status:'okay'}
  ]};
  return {app:appKey(),board:model.board,build:dir(),folder:model.activeWs,manifest:workspaceState()?.manifest,
    method:model.method,trusted:true,configurationFiles:demo_input_groups(),symbols:{items},devicetree:tree,
    selectedModules:currentModules().filter(m=>m[4]).map(m=>m[0]),
    projects:currentModules().map(m=>({name:m[0],revision:m[2],path:m[5]?.path}))};
}
function editDesignNode(entry,button){
  const a=entry.action;
  if(a.kind==='inputGroup')return designTree.editor(button,configuration_input_rows(designTreeState(),[a.group]));
  if(a.kind==='target'){
    const fromCache=a.target==='board'?b('从 CMakeCache.txt 读取板目标','studioboard','plain')+'<input type="file" hidden id="board-cache" accept=".txt,text/plain">':'';
    const box=designTree.editor(button,b('选择…','design-pick')+fromCache);
    return designPicker.show(a.target,box.querySelector('button[data-act]'));
  }
  if(a.kind==='source')return showDevicetreeExample(a.path);
  if(a.kind==='method'||a.kind==='build')return designTree.editor(button,buildMethodRow(model.method));
  if(a.kind==='arguments')return projectAction('projargs');
  if(a.kind==='kconfig'||a.kind==='device'){node=a.kind;demoWorkspace.openPane('inspector');render();$('.studio-editor')?.scrollIntoView({block:'nearest'});return;}
  if(a.kind==='modules')return designTree.editor(button,b('管理模块','page:modules'));
  if(a.kind==='module'){
    const m=currentModules().find(m=>m[0]===a.project.name);
    return designTree.editor(button,row('目录',ZephyrPathDisplay.path(a.project.path)||'—')+row('清单版本',a.project.revision)+
      '<label><input type="checkbox" data-select="'+esc(m[0])+'" '+(m[4]?'checked':'')+'>勾选模块</label>');
  }
  if(a.kind==='hardware'){
    const record=a.record;
    const box=designTree.editor(button,'<code>'+esc(record.path)+'</code><label>status<select data-map-value><option>okay</option><option>disabled</option></select></label>'+
      '<button data-map-stage>加入 app.overlay 草稿</button>');
    box.querySelector('[data-map-stage]').onclick=()=>{
      const current=draft['app.overlay']??model.demoFiles?.[appKey()]?.['app.overlay']??'';
      draft['app.overlay']=current+(current&&!current.endsWith('\n')?'\n':'')+'&{'+record.path+'} {\n\tstatus = "'+
        box.querySelector('[data-map-value]').value+'";\n};\n';
      commitDemo();
    };
    return;
  }
  if(a.kind==='symbol'){
    const item=a.item;
    const control=item.type==='bool'?'<select data-map-value>'+['y','n'].map(v=>'<option'+(item.value===v?' selected':'')+'>'+v+'</option>').join('')+'</select>':
      '<input data-map-value value="'+esc(item.value??'')+'">';
    const box=designTree.editor(button,'<small>'+esc(item.menuPath.join(' › '))+'</small><label>草稿值'+control+'</label><button data-map-stage>加入草稿</button>');
    box.querySelector('[data-map-stage]').onclick=()=>{
      const value=box.querySelector('[data-map-value]').value;
      if(item.type==='int'&&!/^-?\d+$/.test(value))return notify('请输入有效整数');
      const key=symbolDraft(item.name);
      if(value===savedSymbol(item.name))delete draft[key];else draft[key]=value;
      activeSymbol=item.name;commitDemo();
    };
  }
}
function copyDemoFragment(kind){
  if(!kind)return show('另存副本',b('应用配置 · prj.conf','studiocopy:kconfig')+
    (draft['app.overlay']!==undefined||model.demoFiles?.[appKey()]?.['app.overlay']!==undefined?b('设备树覆盖 · app.overlay','studiocopy:device'):''));
  const overlay=kind==='device';
  const text=overlay?(draft['app.overlay']??model.demoFiles[appKey()]['app.overlay']):
    symbolNames().flatMap(k=>{
      const value=draft[symbolDraft(k)]??savedSymbol(k);
      if(value===undefined||value==='移除显式赋值')return [];
      return [k+'='+(symbolTypes[k]==='string'?JSON.stringify(value):value)];
    }).join('\n')+'\n';
  const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})),link=document.createElement('a');
  link.href=url;link.download=overlay?'app-copy.overlay':'prj-copy.conf';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);$('#dialog').close();
}
