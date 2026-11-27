'use strict';

const assert=require('node:assert/strict');
const {test}=require('node:test');
const {class_diagram_text}=require('../extension/plantumlClassDiagram');
const {export_class_diagram}=require('../extension/studioClassExport');

const diagram={
  nodes:[
    {id:'owner',kind:'struct',name:'device',members:[{name:'struct port ports[2]'}]},
    {id:'part',kind:'class',name:'port',conditional:true,members:[{name:'signal (*notify)(void)',conditional:true}]}
  ],
  edges:[
    {from:'owner',to:'part',kind:'composition',label:'ports'},
    {from:'owner',to:'owner',kind:'association',label:'next'},
    {from:'part',to:'owner',kind:'inheritance',label:'public',conditional:true}
  ]
};
const uri=path=>({path,toString:()=> 'file://'+path});
const source=uri('/firmware/device.h');
const english=(_zh,en)=>en;
function host() {
  const written=[],notices=[],commands=[], target=uri('/design/device.puml');
  const window={
    showSaveDialog:async()=>target,showWarningMessage:async message=>notices.push(message),
    showInformationMessage:async(_message,...options)=>options.at(-1),
    showTextDocument:async document=>{window.activeTextEditor={document};}
  };
  const vscode={window,Uri:{joinPath:()=>target},extensions:{getExtension:()=>undefined},
    workspace:{textDocuments:[],fs:{writeFile:async(file,bytes)=>written.push([file,bytes])},
      openTextDocument:async file=>({uri:file})},
    commands:{executeCommand:async command=>commands.push(command)}};
  return {vscode,written,notices,commands,target};
}

test('PlantUML gives diamonds and inheritance triangles their respective directions',()=>{
  const text=class_diagram_text(diagram);
  assert.match(text,/T1 \*-- T2 : ports/);
  assert.match(text,/T1 --> T1 : next/);
  assert.match(text,/T2 --\|> T1 : public \[conditional\]/);
  assert.match(text,/class "port" as T2 <<class>> <<conditional>>/);
});
test('source spelling stays on one line and cannot introduce PlantUML directives',()=>{
  const name='x"\n!include other\n@enduml\n[[remote]]';
  const text=class_diagram_text({nodes:[{id:'id',kind:'class',name,members:[{name}]}],edges:[]});
  assert.equal(text.split('\n').filter(line=>/^@enduml/.test(line)).length,1);
  assert.doesNotMatch(text,/!include|\[\[remote/);
  assert.match(text,/<U\+0022>/);
});
test('export is local by default, optional preview uses the installed extension command',async()=>{
  for(const installed of [false,true]) {
    const h=host();
    h.vscode.extensions.getExtension=id=>installed && id==='jebbs.plantuml' ? {} : undefined;
    await export_class_diagram(h.vscode,source,()=>diagram,english);
    assert.equal(h.written[0][1].toString(),class_diagram_text(diagram));
    assert.deepEqual(h.commands,installed?['plantuml.preview']:[]);
  }
});
test('export rejects stale sources, dirty target documents, cancellation and source file destinations',async()=>{
  for(const scenario of ['changed','dirty','cancel','source']) {
    const h=host();
    let current=diagram;
    h.vscode.window.showSaveDialog=async()=>{
      if(scenario==='changed') current=undefined;
      if(scenario==='dirty') h.vscode.workspace.textDocuments.push({uri:h.target,isDirty:true});
      return scenario==='cancel' ? undefined : scenario==='source' ? source : h.target;
    };
    await export_class_diagram(h.vscode,source,()=>current,english);
    assert.equal(h.written.length,0);
    assert.equal(h.notices.length,scenario==='cancel'?0:1);
  }
});
