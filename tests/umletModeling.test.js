'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const {open_canvas}=require('../extension/umletModeling');

function fixture(options={}) {
  const calls=[],folder={path:'/work'},uri={path:options.path ?? '/work/layout.uxf'};
  const vscode={extensions:{getExtension:id=>id==='theumletteam.umlet' && !options.missing},
    Uri:{joinPath:(base,name)=>({path:base.path+'/'+name})},
    commands:{executeCommand:async(...args)=>calls.push(args)},
    window:{
      showInformationMessage:async(_,action)=>options.details?action:undefined,
      showWarningMessage:async text=>calls.push(['warning',text]),
      showQuickPick:async choices=>choices[options.choice ?? 0],
      showSaveDialog:async()=>options.cancel?undefined:uri,
      showOpenDialog:async()=>options.cancel?undefined:[uri]
    },
    WorkspaceEdit:class {createFile(target,flags){this.target=target;this.flags=flags;}},
    workspace:{applyEdit:async edit=>{calls.push(['create',edit.target,edit.flags]);return !options.exists;}}
  };
  return {calls,uri,run:()=>open_canvas(vscode,folder,(_,en)=>en)};
}

test('new canvas creates an empty file without overwrite and opens the registered graphical editor',async()=>{
  const h=fixture();await h.run();
  assert.deepEqual(h.calls,[['create',h.uri,{overwrite:false}],['vscode.openWith',h.uri,'uxfCustoms.umletEditor']]);
});

test('an existing UXF opens with its provider without writing it',async()=>{
  const h=fixture({choice:1});await h.run();
  assert.deepEqual(h.calls,[['vscode.openWith',h.uri,'uxfCustoms.umletEditor']]);
});

test('a missing provider offers details and lets the user decline',async()=>{
  const declined=fixture({missing:true});await declined.run();assert.deepEqual(declined.calls,[]);
  const accepted=fixture({missing:true,details:true});await accepted.run();
  assert.deepEqual(accepted.calls,[['extension.open','theumletteam.umlet']]);
});

test('canceled picker, save or open leaves the project untouched',async()=>{
  for (const options of [{choice:4},{cancel:true},{choice:1,cancel:true}]) {
    const h=fixture(options);await h.run();assert.deepEqual(h.calls,[]);
  }
});

test('an existing save target and a PlantUML filename cannot become a new UXF canvas',async()=>{
  const wrong=fixture({path:'/work/design.puml'});await wrong.run();
  assert.deepEqual(wrong.calls.map(([action])=>action),['warning']);
  const existing=fixture({exists:true});await existing.run();
  assert.deepEqual(existing.calls.map(([action])=>action),['create','warning']);
});
