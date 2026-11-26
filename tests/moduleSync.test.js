'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const {syncBatch}=require('../extension/moduleSync');

test('a failed checkout keeps the preview and retries just the failed and unattempted rows',async()=>{
  let failed=false, pending;
  const attempted=[];
  const element={remove(){},setAttribute(){},querySelectorAll:()=>[]};
  const dialog={open:true,close(){this.open=false;}};
  const body={...element,querySelectorAll:()=>[]};
  const document={body,addEventListener(){},querySelector:key=>key==='#dialog'?dialog:key==='#dialog-body'?body:element};
  const api={getState:()=>({}),postMessage(message){
    pending=syncBatch(message.value.rows,async row=>{
      attempted.push(row.name);
      if(row.name==='b'&&!failed){failed=true;throw Error('checkout busy');}
    }).then(value=>listeners.forEach(fn=>fn({data:{reply:message.request,value}})));
  }};
  const listeners=[];
  const context=vm.createContext({document,window:{addEventListener:(_,fn)=>listeners.push(fn)},acquireVsCodeApi:()=>api,
    tr:(_,en)=>en,ico:()=>'',esc:v=>v,b:label=>label,setTimeout:()=>0,clearTimeout(){},
    matchMedia:()=>({addEventListener(){}}),MutationObserver:class {observe(){}},workbench_appearance:class {receive(){}}});
  const run=source=>vm.runInContext(source,context);
  for(const file of ['design/module-sources.js','extension/media/nativeModules.js']){
    run(fs.readFileSync(path.join(__dirname,'..',file),'utf8'));
  }
  run("syncPlan={network:true,rows:['a','b','c'].map(name=>({name,ref:'main',state:{objects:[]},target:'1'.repeat(40)}))}");
  await run('applySyncPlan()');
  await pending;
  assert.equal(dialog.open,true);
  assert.deepEqual(attempted,['a','b']);
  assert.match(body.innerHTML,/Sync complete/);
  assert.match(body.innerHTML,/checkout busy/);
  assert.match(body.innerHTML,/Pending retry/);
  assert.match(body.innerHTML,/Retry unfinished（2）/);
  await run('applySyncPlan()');
  assert.deepEqual(attempted,['a','b','b','c']);
  assert.equal(dialog.open,false);
});
