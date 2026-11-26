'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {example,generate} = require('../extension/media/threadStudio/programModel');
const {exportProgram,preview_program,inspectProgram,updateProgram,designFile,step_source_line} = require('../extension/visualProgramFiles');
const {FirmwareLog} = require('../extension/firmwareLog');

async function sandbox(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'Zephyr visual 工程 '));
  t.after(()=>fs.rm(dir,{recursive:true,force:true,maxRetries:4,retryDelay:100}));
  return dir;
}

test('export can be reopened; regeneration preserves custom hooks, project files and C source line mappings',async t=>{
  const dir = await sandbox(t), graph = example();
  const root = await exportProgram(dir,graph);
  const design = path.join(root,designFile), main = path.join(root,'src','main.c');
  assert.deepEqual(JSON.parse(await fs.readFile(design,'utf8')),graph);
  assert.ok((await fs.readFile(main,'utf8')).startsWith(generate(graph)['src/main.c']));
  await assert.rejects(()=>exportProgram(dir,graph),{code:'EEXIST'});
  await fs.appendFile(path.join(root,'src','user_hooks.c'),'/* driver */\n');
  await fs.appendFile(path.join(root,'prj.conf'),'CONFIG_GPIO=y\n');
  graph.threads[0].initialValue = 123;
  const plan = await inspectProgram(design,graph);
  assert.ok(plan.changed);
  await updateProgram(design,graph,plan);
  assert.equal((await inspectProgram(design,graph)).changed,false);
  assert.ok((await fs.readFile(path.join(root,'src','user_hooks.c'),'utf8')).endsWith('/* driver */\n'));
  assert.ok((await fs.readFile(path.join(root,'prj.conf'),'utf8')).endsWith('CONFIG_GPIO=y\n'));
  await fs.appendFile(main,'/* local edit */\n');
  await assert.rejects(()=>updateProgram(design,graph,plan),{code:'SOURCE_EDITED'});
  assert.ok((await fs.readFile(main,'utf8')).endsWith('/* local edit */\n'));
});

test('source navigation uses the actual project buffer and the generation that produced the recording',()=>{
  const graph=example();
  for (const protocol of [1,2]) {
    const source=generate(graph,protocol)['src/main.c'];
    const line=step_source_line(graph,source.replaceAll('\n','\r\n'),'process',protocol);
    assert.match(source.split('\n')[line-1],/zv_fn_scale/);
    assert.equal(step_source_line(graph,'/* hand edit */\n'+source,'process',protocol),undefined);
    assert.equal(step_source_line(graph,source,'process',protocol===1?2:1),undefined);
  }
});

test('source review is read-only and preserves the actual divergent source for comparison',async t=>{
  const dir=await sandbox(t), graph=example(), root=await exportProgram(dir,graph);
  const doc=path.join(root,designFile), source=path.join(root,'src','main.c');
  const original=await fs.readFile(source,'utf8');
  graph.threads[0].initialValue=91;
  const proposal=await preview_program(doc,graph);
  assert.equal(proposal.original,original);
  assert.notEqual(proposal.next,original);
  assert.equal(await fs.readFile(source,'utf8'),original);
  const hand_edit=original+'/* external change */\n';
  await fs.writeFile(source,hand_edit);
  const review=await preview_program(doc,graph);
  assert.ok(review.edited);
  assert.equal(review.original,hand_edit);
  await assert.rejects(()=>updateProgram(doc,graph,proposal),{code:'SOURCE_EDITED'});
  assert.equal(await fs.readFile(source,'utf8'),hand_edit);
});

test('regeneration refuses unrelated source and a replaced source directory',async t=>{
  const dir = await sandbox(t), graph = example(), root = await exportProgram(dir,graph);
  const design=path.join(root,designFile), src=path.join(root,'src'), other=path.join(dir,'other');
  await fs.writeFile(path.join(src,'main.c'),'int main(void) {}\n');
  await assert.rejects(()=>inspectProgram(design,graph),{code:'NOT_GENERATED_PROJECT'});
  await fs.rename(src,other);
  await fs.symlink(other,src,process.platform==='win32'?'junction':'dir');
  await assert.rejects(()=>inspectProgram(design,graph),{code:'NOT_GENERATED_PROJECT'});
});

test('following a selected file delivers increments, handles rotation and Windows UTF-16 logs',async t=>{
  const dir=await sandbox(t), file=path.join(dir,'console.log'), input=[];
  const tail=new FirmwareLog((text,options)=>input.push({text,...options}),error=>{throw error;});
  t.after(()=>tail.stop());
  await fs.writeFile(file,'first\n');
  await tail.start(file,0);
  await fs.appendFile(file,'second\n');
  await tail.poll();
  assert.deepEqual(input,[{text:'first\n',reset:true,gap:false},{text:'second\n',reset:false,gap:false}]);
  await fs.rename(file,file+'.old');
  await fs.writeFile(file,Buffer.from('\ufeff第三行\n','utf16le'));
  await tail.poll();
  assert.equal(input.at(-1).text,'\ufeff第三行\n');
  assert.equal(input.at(-1).reset,true);
  tail.stop();
  await tail.poll();
  assert.equal(input.length,3);
});
