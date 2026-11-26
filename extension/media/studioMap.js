'use strict';

const studioArgumentDrafts=new Map();

function studioFileLabel(input,app){
  const relative=ZephyrPathDisplay.relative(input.file,app);
  const status=input.creating?tr('新建','New'):input.applied===true?tr('已应用','Applied'):
    input.applied===false?tr('未应用','Not applied'):tr('待确认','Unconfirmed');
  return relative+' · '+status;
}

function createStudioMap(adapter){
  const tree=createConfigurationTree(open,stored().studioMapView);
  let restoring;
  const name=path=>ZephyrPathDisplay.path(path).split('/').pop();
  const textOf=file=>adapter.draft(file.file)?.text??file.text;
  const option=(value,label,selected)=>'<option value="'+esc(value)+'"'+(selected?' selected':'')+'>'+esc(label)+'</option>';
  const label=(title,field)=>'<label>'+esc(title)+field+'</label>';
  const action=(text,attr,disabled=false)=>'<button type="button" '+attr+(disabled?' disabled':'')+'>'+esc(text)+'</button>';
  const input=(value,type='text')=>'<input class="input" data-map-value type="'+type+'" value="'+esc(value)+'">';
  function open(entry,button){
    const state=adapter.state(),a=entry.action,disabled=!state.trusted||state.busy||!state.folder;
    if(a.kind==='source')return send('devicetreeFile',a.path);
    if(a.kind==='inputGroup')return tree.editor(button,configuration_input_rows(state,[a.group]));
    if(a.kind==='symbol'||a.kind==='hardware')return fragment(entry,button,disabled,restoring?.file,restoring?.property);
    if(a.kind==='target'){
      const value=state[a.target]||'';
      const box=tree.editor(button,targetFields(targetField(a.target,entry.label,value,value,disabled)));
      if(!disabled)box.querySelector('[data-act="target:search:'+a.target+'"]')?.click();
      return;
    }
    if(a.kind==='method')return tree.editor(button,buildMethodRow(state.method,disabled));
    if(a.kind==='arguments'){
      const value=restoring?.value??studioArgumentDrafts.get(state.app)??state.argsText??'';
      const box=tree.editor(button,label(tr('每行一个 NAME=value','One NAME=value per line'),
        '<textarea data-map-args>'+esc(value)+'</textarea>')+action(tr('应用参数','Apply definitions'),'data-map-apply',disabled));
      const field=box.querySelector('textarea');field.oninput=()=>{
        studioArgumentDrafts.set(state.app,field.value);adapter.changed();
      };
      box.querySelector('[data-map-apply]').onclick=()=>send('arguments',field.value);
      return;
    }
    if(a.kind==='module'){
      const p=a.project,chosen=state.selectedModules?.includes(p.name);
      const box=tree.editor(button,row(tr('目录','Directory'),ZephyrPathDisplay.path(p.path)||'—')+row(tr('清单版本','Manifest revision'),p.revision||'—')+
        (chosen===undefined?'':action(chosen?tr('取消勾选','Deselect module'):tr('勾选模块','Select module'),'data-module-select',disabled)));
      const select=box.querySelector('[data-module-select]');
      if(select)select.onclick=async()=>{select.disabled=true;try{await rpc('select',{name:p.name,checked:!chosen});}
        catch(error){notify(error.message);select.disabled=false;}};
      return;
    }
    if(a.kind==='modules')return tree.editor(button,row(tr('工作区清单','Workspace manifest'),ZephyrPathDisplay.path(state.manifest)||'—')+b(tr('管理模块','Manage modules'),'page:modules'));
    if(a.kind==='build')return tree.editor(button,buildMethodRow(state.method,disabled)+targetFields(targetField('build','−B',state.build,state.build,disabled)));
    if(a.kind==='kconfig'||a.kind==='device')adapter.inspect(a.kind);
  }
  function fragment(entry,button,disabled,chosenFile,property='status'){
    const isSymbol=entry.action.kind==='symbol',kind=isSymbol?'kconfig':'device';
    const files=adapter.state().inputs.filter(f=>f.kind===kind);
    const target=files.find(f=>f.file===chosenFile)||adapter.preferred(kind)||files[0];
    if(target)adapter.chooseFile(target);
    const paths='<select data-map-file>'+files.map(f=>option(f.file,studioFileLabel(f,adapter.state().app),f.file===target?.file)).join('')+'</select>';
    const file=target?label(tr('草稿目标片段','Draft fragment'),paths):
      '<small>'+tr('请先创建应用配置片段。','Create an application fragment first.')+'</small>';
    const text=target?textOf(target):'';
    const controls=isSymbol?symbolControls(entry.action.item,text):hardwareControls(entry.action.record,text,property);
    const remove=isSymbol&&kconfigFields.assignments(text).some(v=>v.key===entry.action.item.name);
    const buttons='<div class="actions">'+action(tr('加入草稿','Stage change'),'data-map-stage',disabled||!target||controls.locked)+
      (remove?action(tr('移除显式赋值','Remove assignment'),'data-map-remove',disabled):'')+'</div>';
    const box=tree.editor(button,controls.html+file+buttons+'<small role="status" data-map-feedback></small>');
    const valueField=box.querySelector('[data-map-value]');
    if(restoring&&restoring.file===target?.file&&restoring.property===box.querySelector('[data-map-property]')?.value){
      const value=restoring.value;
      if(value!==undefined&&(valueField.tagName!=='SELECT'||[...valueField.options].some(o=>o.value===value)))valueField.value=value;
      if(restoring.details&&box.querySelector('details'))box.querySelector('details').open=true;
    }
    valueField?.addEventListener('input',adapter.changed);
    valueField?.addEventListener('change',adapter.changed);
    box.querySelector('[data-map-file]')?.addEventListener('change',e=>{
      const file=files.find(f=>f.file===e.target.value);
      if(file){fragment(entry,button,disabled,file.file,property);adapter.changed();}
    });
    box.querySelector('[data-map-property]')?.addEventListener('change',e=>{
      fragment(entry,button,disabled,target?.file,e.target.value);adapter.changed();
    });
    function stage(removeValue){
      const feedback=box.querySelector('[data-map-feedback]');
      try{
        const value=box.querySelector('[data-map-value]').value;
        const current=textOf(target);
        const output=isSymbol?kconfigFields.apply(current,entry.action.item.name,value,removeValue,adapter.state().symbols):
          property==='status'?deviceTreeDraft.status(current,entry.action.record,value):deviceTreeDraft.property(current,entry.action.record,property,value);
        adapter.stage(target,output);
        feedback.textContent=tr('已加入草稿 · ','Staged · ')+name(target.file);
      }catch(error){feedback.textContent=error.message;}
    }
    box.querySelector('[data-map-stage]').onclick=()=>stage(false);
    const rm=box.querySelector('[data-map-remove]');if(rm)rm.onclick=()=>stage(true);
  }
  function symbolControls(item,text){
    const entries=kconfigFields.assignments(text),current=entries.find(entry=>entry.key===item.name);
    const byName=new Map(adapter.state().symbols.items.map(symbol=>[symbol.name,symbol]));
    const field=kconfigFields.control(item,current,entries,byName).replace('id="field-value"','data-map-value');
    const meta=[item.menu,item.type,item.range?.join(' … '),tr('构建值','Configured value')+' = '+item.value].filter(Boolean).join(' · ');
    return {html:'<small>'+esc(meta)+'</small>'+label(item.prompt||item.name,field),locked:!item.choice&&item.allowed?.length<2};
  }
  function hardwareControls(record,text,property){
    const props=record.properties||[],edit=props.filter(p=>p.name!=='status'&&deviceTreeDraft.editableProperty(p));
    const prop=edit.find(p=>p.name===property);
    const status=deviceTreeDraft.stagedStatus(text,record)??record.status;
    const statusOptions=['okay','disabled','reserved','fail'];
    const field=prop?input(deviceTreeDraft.stagedProperty(text,record,property)??prop.scalar):
      '<select data-map-value>'+(!statusOptions.includes(status)?'<option selected disabled>'+esc(status??'—')+'</option>':'')+
      statusOptions.map(v=>option(v,v,v===status)).join('')+'</select>';
    const pick='<select data-map-property>'+['status',...edit.map(p=>p.name)].map(v=>option(v,v,v===property)).join('')+'</select>';
    const details=props.length?'<details><summary>'+tr('构建记录中的属性','Configured properties')+' ('+props.length+')</summary>'+
      props.map(p=>'<div class="map-property"><strong>'+esc(p.name)+'</strong> <code>'+esc(p.value??'')+'</code></div>').join('')+'</details>':'';
    const effective=prop?prop.scalar:record.status;
    return {html:'<small>'+esc(record.path)+'</small>'+label(tr('节点属性','Node property'),pick)+
      '<small>'+tr('构建生效值','Configured value')+' · <code>'+esc(effective??'—')+'</code></small>'+
      label(tr('草稿值','Draft value'),field)+details,locked:false};
  }
  function snapshot(){
    const view=tree.snapshot(),box=document.querySelector('.map-node-editor:not([hidden])');
    const field=box?.querySelector('[data-map-value],[data-map-args]');
    if(field)view.editor={id:box.dataset.editing,file:box.querySelector('[data-map-file]')?.value,
      property:box.querySelector('[data-map-property]')?.value,value:field.value,details:box.querySelector('details')?.open};
    return view;
  }
  function restoreEditor(view){
    if(!view?.editor||view.scope!==tree.snapshot().scope)return;
    restoring=view.editor;
    try {tree.reveal(restoring.id,true);}
    finally {restoring=undefined;}
  }
  return {...tree,snapshot,restoreEditor};
}
