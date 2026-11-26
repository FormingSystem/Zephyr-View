'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function fixture() {
  const calls = [];
  const document = {documentElement:{toggleAttribute(){}}, querySelector:()=>null};
  const source = fs.readFileSync(require.resolve('../design/configuration-workspace'), 'utf8');
  const Workspace = vm.runInNewContext(source+'\nConfigurationWorkspace', {document, tr:(_, english)=>english, esc:String});
  const studio = new Workspace({
    present:()=>calls.push('present'), moveWindow:action=>calls.push(action), toggleWindow:()=>calls.push('fullscreen')
  });
  studio.main = {querySelectorAll:()=>[],querySelector:()=>({focus(){}})};
  const click = action=>studio.handleClick({target:{closest:()=>({dataset:{canvasAction:action}})}});
  const escape = (insideEditor=false)=>studio.handleEscape({
    key:'Escape', target:{isConnected:true,closest:()=>insideEditor}, preventDefault(){}
  });
  return {studio,calls,click,escape};
}

test('full-screen command opens a dedicated presentation and preserves the original editor layout', () => {
  const {studio,calls,click,escape} = fixture();
  click('expand');
  assert.deepEqual(calls, ['present']);
  assert.equal(studio.expanded, false);
  studio.setWindow(true, 'drafts', true);
  assert.match(studio.controls(), /Exit full-screen configuration/);
  escape(true);
  assert.equal(studio.pane, 'drafts');
  escape();
  assert.equal(studio.pane, '');
  assert.deepEqual(calls, ['present']);
  escape();
  assert.deepEqual(calls, ['present','attach']);
});

test('a resizable detached editor opens canvas-first and toggles its own window on request', () => {
  const {studio,calls,click,escape} = fixture();
  studio.setWindow(true);
  assert.equal(studio.expanded, true);
  assert.equal(studio.pane, '');
  studio.openPane('inspector');
  studio.setWindow(true);
  assert.equal(studio.pane, 'inspector');
  click('window');
  escape();
  escape();
  assert.deepEqual(calls, ['fullscreen']);
  assert.equal(studio.expanded, true);
  click('attach');
  assert.deepEqual(calls, ['fullscreen','attach']);
  studio.setWindow(false);
  assert.equal(studio.expanded, false);
});

test('the inspector switches between file fragment types and leaves target settings to graph nodes',()=>{
  const {studio}=fixture();
  const picker=studio.fragmentKind('device');
  assert.equal((picker.match(/<option /g)||[]).length,2);
  assert.match(picker,/<option value="device" selected>/);
  assert.match(picker,/<option value="kconfig">/);
});

test('module leaves edit selection in place and only the parent opens the module manager',async()=>{
  const source=fs.readFileSync(require.resolve('../extension/media/studioMap'),'utf8');
  const inspected=[],updates=[];
  const button={};
  let open,markup;
  const ctx={
    stored:()=>({}),tr:(_,en)=>en,esc:String,row:(k,v)=>k+' '+v,b:(label,id)=>label+' '+id,
    ZephyrPathDisplay:{path:String},rpc:(op,value)=>updates.push([op,value.name,value.checked]),
    createConfigurationTree(callback){open=callback;return {editor(_button,html){markup=html;return {querySelector:()=>button};}};}
  };
  const map=vm.runInNewContext(source+'\ncreateStudioMap',ctx);
  map({state:()=>({folder:'project',trusted:true,selectedModules:[],manifest:'west.yml'}),inspect:id=>inspected.push(id)});
  open({action:{kind:'module',project:{name:'hal',path:'modules/hal',revision:'main'}}},button);
  assert.match(markup,/modules\/hal/);
  assert.doesNotMatch(markup,/page:modules/);
  await button.onclick();
  assert.deepEqual(updates,[['select','hal',true]]);
  open({action:{kind:'modules'}},button);
  assert.match(markup,/page:modules/);
  for(const kind of ['kconfig','device'])open({action:{kind}},button);
  assert.deepEqual(inspected,['kconfig','device']);
});

test('a property opens its own value and stages only editable hardware into the chosen overlay',()=>{
  const source=fs.readFileSync(require.resolve('../extension/media/studioMap'),'utf8');
  const deviceTreeDraft=require('../extension/media/deviceTreeDraft');
  const property={name:'current-speed',type:'num',value:'<115200>',scalar:115200};
  const record={path:'/bus/uart',properties:[property],status:'okay'};
  const file={file:'app.overlay',kind:'device',text:'// existing overlay\n'};
  const state={folder:'project',trusted:true,inputs:[file]};
  const field={value:'9600',addEventListener(){}},stage={},feedback={};
  let open,markup,draft;
  const elements={'[data-map-value]':field,'[data-map-stage]':stage,'[data-map-feedback]':feedback};
  const context={
    stored:()=>({}),tr:(_,english)=>english,esc:String,deviceTreeDraft,
    ZephyrPathDisplay:{path:String,relative:String},
    createConfigurationTree(callback){
      open=callback;
      return {editor(_button,html){markup=html;return {querySelector:selector=>elements[selector]};}};
    }
  };
  vm.runInNewContext(source+'\ncreateStudioMap',context)({
    state:()=>state,draft:()=>undefined,preferred:()=>file,chooseFile(){},changed(){},
    stage(target,text){assert.equal(target,file);draft=text;}
  });
  const openProperty=(owner,prop)=>open({action:{kind:'property',record:owner,property:prop}},{});
  openProperty(record,property);
  assert.match(markup,/115200/);
  assert.doesNotMatch(markup,/data-map-property|data-map-stage disabled/);
  stage.onclick();
  assert.match(draft,/current-speed = <9600>;/);
  assert.equal(file.text,'// existing overlay\n');
  state.trusted=false;
  openProperty(record,property);
  assert.match(markup,/data-map-stage disabled/);
  for(const prop of [{name:'reg',type:'num',scalar:1,value:'<1>'},{name:'status',type:'path',value:'&uart0'}]){
    openProperty(prop.name==='status'?{path:'/aliases'}:record,prop);
    assert.match(markup,/Read-only/);
    assert.doesNotMatch(markup,/data-map-stage|data-map-value/);
  }
});
