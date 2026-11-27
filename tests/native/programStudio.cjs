'use strict';

const assert=require('node:assert/strict');
const path=require('node:path');
const vscode=require('vscode');

const wait=ms=>new Promise(done=>setTimeout(done,ms));
async function until(read,detail,timeout=18000){
  const end=Date.now()+timeout;
  while(Date.now()<end){const result=read();if(result)return result;await wait(70);}
  throw Error(detail);
}

async function verify_window(uri) {
  const groups=()=>vscode.window.tabGroups.all;
  const studio=()=>groups().find(group=>group.tabs.some(tab=>tab.input instanceof vscode.TabInputCustom && tab.input.uri.toString()===uri.toString()));
  await vscode.commands.executeCommand('vscode.openWith',uri,'zephyrWorkbench.visualProgram',{preview:false});
  const home=await until(studio,'Design did not open');
  await vscode.commands.executeCommand('zephyrWorkbench.openProgrammingStudio');
  const floating=await until(()=>{const g=studio();return g!==home && g;},'Design did not move to an auxiliary editor window');
  const count=groups().length;
  await vscode.commands.executeCommand('zephyrWorkbench.openProgrammingStudio');
  await wait(200);
  assert.equal(studio(),floating,'The studio should reveal the same floating group');
  assert.equal(groups().length,count,'Opening the studio twice should reuse the same window');
  await vscode.window.tabGroups.close(floating.tabs.filter(t=>t.input?.uri?.toString()===uri.toString()));
}

async function verify_adapter(extension,folder) {
  const fs=require('node:fs/promises');
  const {ThreadDebug}=require(path.join(extension.extensionPath,'threadDebug'));
  const {ProgramDebugControls}=require(path.join(extension.extensionPath,'programDebugControls'));
  const file=path.join(folder.uri.fsPath,'studio-debug-fixture.js');
  await fs.writeFile(file,"const input = 1;\nlet value = input + 2;\ndebugger;\nvalue += 1;\nsetInterval(() => value++, 250);\n");
  const runtime=new ThreadDebug(vscode.debug);
  let state,located;
  const name='Studio adapter acceptance';
  const controls=new ProgramDebugControls({runtime,folder,send:s=>{state=s;},showFrame:frame=>{located=frame;},
    report:message=>console.log('Adapter:',message),launch:scope=>vscode.debug.startDebugging(scope,{
      type:'pwa-node',request:'launch',name,program:file,console:'internalConsole',skipFiles:['<node_internals>/**']
    })});
  try {
    assert.equal(await controls.handle({op:'start'}),true);
    const stopped=await until(()=>runtime.matching(folder).find(r=>r.phase==='stopped'),'Expected a real adapter to stop in the Node test application',30000);
    if(runtime.current(folder)!==stopped)await controls.handle({op:'session',id:stopped.session.id,token:state.token});
    await until(()=>state?.frame?.path===file && state.frame.line===3,'Expected the debugger statement frame');
    await controls.handle({op:'frame',token:state.token});
    assert.equal(located.line,3);
    await controls.handle({op:'next',token:state.token});
    await until(()=>state?.frame?.path===file && state.frame.line===4,'Single step did not advance to the next source line');
    await controls.handle({op:'continue',token:state.token});
    await until(()=>state.phase==='running','Continue did not resume the test session');
    await controls.handle({op:'pause',token:state.token});
    await until(()=>state.phase==='stopped','Pause did not suspend the test session');
    await controls.handle({op:'stop',token:state.token});
    await until(()=>!runtime.matching(folder).length,'Stop did not finish the test session');
  } finally {
    controls.dispose();
    for(const record of runtime.matching(folder)) await vscode.debug.stopDebugging(record.session);
    runtime.dispose();
  }
}

module.exports={verify_window,verify_adapter};
