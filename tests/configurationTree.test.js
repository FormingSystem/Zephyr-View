'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const {configurationTreeModel,configurationMapFitScale,configurationSearchResults}=require('../design/configuration-tree');
const pathDisplay=require('../design/pathDisplay');
const en=(_cn,text)=>text;
const child=(node,id)=>node.children.find(item=>item.id===id);

test('fit uses the expanded tree extent on either axis without enlarging a small tree',()=>{
  assert.equal(configurationMapFitScale(832,432,250,104),1);
  assert.equal(configurationMapFitScale(832,432,1600,320),.5);
  assert.equal(configurationMapFitScale(832,432,300,20000),.02);
  assert.equal(configurationMapFitScale(1,1,0,0),1);
});

test('board revisions and qualifiers retain the complete target selection',()=>{
  const tree=configurationTreeModel({board:'my_board@1.0/soc/cpu'},en);
  const board=child(tree,'board');
  assert.equal(board.detail,'my_board@1.0/soc/cpu');
  assert.deepEqual(board.children.map(node=>node.detail),['my_board','1.0','soc/cpu']);
  assert.ok(board.children.every(node=>node.action.target==='board'));
});
test('keeps deep Kconfig paths and shared symbols identifiable in each menu',()=>{
  const serial={name:'CONFIG_SERIAL',prompt:'Enable serial',value:'n',menuPaths:[['Drivers','I/O'],['Console']]};
  const uart={name:'CONFIG_UART',prompt:'UART driver',value:'y',menuPath:['Drivers','I/O']};
  const root=child(configurationTreeModel({symbols:{items:[serial,uart]}},en),'kconfig');
  const first=root.children[0].children[0].children,second=root.children[1].children;
  assert.deepEqual(first.map(entry=>entry.action.item.name),['CONFIG_SERIAL','CONFIG_UART']);
  assert.equal(second[0].action.item,serial);
  assert.notEqual(first[0].id,second[0].id);
});
test('uses absolute DTS paths and parent relations even when names repeat or a parent follows its child',()=>{
  const records=[
    {path:'/a/timer',parent:'/a',name:'timer'},{path:'/b/timer',parent:'/b',name:'timer'},
    {path:'/a',parent:'/',name:'a'},{path:'/b',parent:'/',name:'b'},{path:'/',parent:null,name:'/'}
  ];
  const tree=configurationTreeModel({devicetree:{boardFile:'/board.dts',catalog:{nodes:records}}},en);
  const device=child(tree,'device'),root=child(device,'device:hardware').children[0];
  assert.equal(root.children.length,2);
  assert.deepEqual(root.children.map(group=>group.children[0].action.record.path),['/a/timer','/b/timer']);
  assert.equal(child(device,'device:sources').children[0].action.kind,'source');
});
test('unknown module selection and absent hardware records remain unknown',()=>{
  const state={trusted:false,projects:[{name:'hal',revision:'abc'}]};
  const tree=configurationTreeModel(state,en);
  assert.equal(child(tree,'device').children.length,0);
  assert.match(child(tree,'device').detail,/Trust/);
  assert.equal(child(tree,'modules').children[0].detail,'abc');
  state.selectedModules=[];
  assert.match(child(configurationTreeModel(state,en),'modules').children[0].detail,/Unselected/);
});

test('DTS nodes expand to their children and their own properties, independently of catalog order',()=>{
  const baud={name:'current-speed',type:'num',value:'<0x1c200>',scalar:115200};
  const label={name:'label',type:'string',value:'"UART"',scalar:'UART'};
  const nodes=[{path:'/bus/port',properties:[baud,label]},{path:'/'},{path:'/bus',properties:[label]},
    {path:'/unused/port',properties:[baud]},{path:'/unused'},{path:'/empty'}];
  const hardware=child(child(configurationTreeModel({devicetree:{catalog:{nodes}}},en),'device'),'device:hardware');
  const root=hardware.children[0],bus=child(root,'hardware:/bus');
  const port=child(bus,'hardware:/bus/port'),fields=child(bus,'properties:/bus');
  assert.equal(port.label,'port');
  assert.deepEqual(port.children.map(property=>property.label),['current-speed','label']);
  assert.equal(port.children[0].action.property,baud);
  assert.equal(port.children[0].action.record,nodes[0]);
  assert.equal(fields.children[0].action.record.path,'/bus');
  assert.deepEqual(child(root,'hardware:/empty').children,[]);

  const index=new Map();
  function visit(entry){index.set(entry.id,{entry});entry.children.forEach(visit);}
  visit(root);
  const hits=term=>configurationSearchResults(index,term,pathDisplay);
  assert.deepEqual(hits('/bus/port:current-speed'),[port.children[0]]);
  assert.deepEqual(hits('/bus/port'),[port]);
  assert.deepEqual(hits('current-speed').map(hit=>hit.action.record.path),['/bus/port','/unused/port']);
  assert.notEqual(hits('current-speed')[0].id,hits('current-speed')[1].id);
});

test('map labels share one path style while file and module actions keep their original targets',()=>{
  const app=String.raw`C:\Development\hello_world`,build=String.raw`C:\Build/hello_world`;
  const boardFile=String.raw`C:\Zephyr\boards\my_board.dts`;
  const project={name:'my_driver',path:String.raw`\\server\drivers\my_driver`};
  const tree=configurationTreeModel({app,build,projects:[project],devicetree:{boardFile}},en);
  assert.equal(child(tree,'target:app').detail,'C:/Development/hello_world');
  assert.equal(child(child(tree,'build'),'target:build').detail,'C:/Build/hello_world');
  const module=child(tree,'modules').children[0];
  assert.equal(module.detail,'//server/drivers/my_driver');
  assert.equal(module.action.project,project);
  const source=child(child(tree,'device'),'device:sources').children[0];
  assert.equal(source.label,'my_board.dts');
  assert.equal(source.action.path,boardFile);
});
