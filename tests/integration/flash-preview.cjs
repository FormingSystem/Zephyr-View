'use strict';

// Inspect an existing firmware build with the current Zephyr shell. No device command is executed.
const assert=require('node:assert/strict');
const path=require('node:path');
const {uri,host,shell}=require('./adaptive-build-host.cjs');
const {plan}=require('../../extension/media/flashPlan');

async function inspect(root) {
  const environment=shell(),folder={uri:uri(environment.base)},build=uri(root);
  const target=await host.readTarget(folder,build);
  const s={folder,build,target,tools:environment.tools,manifest:{root:uri(environment.cwd)},
    setup:{cacheStatus:'current',app:target.app.fsPath,board:target.board}};
  const metadata=new host.FlashMetadata();
  const model=await metadata.describe(s,process.env);
  assert.ok(model && model.west,'Select a generated build and activate its Zephyr development shell.');
  assert.equal((await metadata.describe(s,process.env,true)).id,model.id);
  assert.ok(model.order.length);
  for (const name of model.order) {
    const result=plan(model,{domain:name,device:'PREVIEW-ONLY'});
    assert.ok(result.args,'Expected a flashable image: '+name+' ('+result.issue+')');
    const image=result.images[0];
    console.log(name,image.board,result.names[0],...image.files.map(entry=>path.basename(entry.file)));
  }
  const all=plan(model,{device:'PREVIEW-ONLY'});
  console.log('System order:',model.order.join(' -> '),'Preview:',all.args || all.issue);
}

if (!process.argv[2]) throw Error('Pass the path to an existing Zephyr build directory.');
inspect(process.argv[2]).catch(error=>{console.error(error);process.exitCode=1;});
