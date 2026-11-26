'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {pathToFileURL}=require('node:url');
const exec=require('node:util').promisify(require('node:child_process').execFile);

function exercise() {
  const check=(ok,message)=>{if(!ok)throw Error(message);};
  const action=(root,name)=>root.querySelector('[data-action="'+name+'"]').click();
  function write(control,value) {
    control.value=value;
    control.dispatchEvent(new Event(control.tagName==='SELECT'?'change':'input',{bubbles:true}));
  }
  const dialog=()=>document.querySelector('dialog[open]');
  const field=name=>document.querySelector('[data-field="'+name+'"]');
  const member_input=(name,i)=>dialog().querySelectorAll('[data-field="'+name+'"]')[i];
  const editor=ZephyrProgramView.mount(document.querySelector('main'),{
    language:'en',graph:ZephyrProgramModel.starter(),onChange:()=>{}});
  action(document,'addType');
  write(member_input('typeName',0),'Mode');action(dialog(),'addMember');
  write(member_input('memberName',1),'ready');write(member_input('memberValue',1),'42');
  action(dialog(),'saveType');
  const type=editor.graph.types[0],ready=type.members[1];
  check(type.name==='Mode' && ready.value===42,'created enum in the graph');
  editor.selectStep('initialize');
  write(field('operandType'),type.id); write(field('operandMember'),ready.id);
  action(document,'updateStep');
  check(editor.graph.mainSteps[0].value.member===ready.id,'linked a member from the inspector');
  check(!document.querySelector('.vp-graph').hidden,'typed instruction is rendered');
  action(document,'editType');
  check(dialog().querySelector('[data-action=deleteType]').disabled,'used type cannot be deleted');
  check(dialog().querySelectorAll('[data-action=removeMember]')[1].disabled,'used member cannot be deleted');
  write(member_input('typeName',0),'Signal');write(member_input('memberName',1),'active');
  action(dialog(),'saveType');
  check(ZephyrProgramModel.generate(editor.graph)['src/main.c'].includes('value = ZV_MEMBER_Signal_active;'),'regenerated linked symbol');
  action(document,'editType');
  write(member_input('typeName',0),'unsigned');action(dialog(),'saveType');
  check(dialog().querySelector('[role=alert]').textContent && editor.graph.types[0].name==='Signal','invalid draft is isolated');
  action(dialog(),'cancelType');
  // An incomplete text edit may temporarily remove the type or the member alone.
  for (const keep_type of [true,false]) {
    const broken=structuredClone(editor.graph);
    const ref=broken.mainSteps[0].value;
    if (keep_type) broken.types[0].members=broken.types[0].members.filter(member=>member.id!==ref.member);
    else broken.types=[];
    editor.setGraph(broken);editor.selectStep('initialize');
    check(field('operandType').value==='$missing','missing symbol is shown explicitly');
    action(document,'updateStep');
    check(editor.graph.mainSteps[0].value.member===ref.member,'a missing reference cannot become 1 implicitly');
    write(field('operandType'),'');write(field('operand'),'0');action(document,'updateStep');
    check(editor.graph.mainSteps[0].value===0,'an explicit numeric replacement repairs the draft');
    editor.setGraph(broken);
  }
  editor.dispose();
}

const chrome=process.env.ZEPHYR_TEST_CHROME;
test('custom types can be composed, referenced and renamed in the visual editor',
  {skip:!chrome && 'Set ZEPHYR_TEST_CHROME to use Chromium'},async t=>{
    const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'zv-enum-ui-'));
    t.after(()=>fs.rm(temporary,{recursive:true,force:true,maxRetries:4,retryDelay:100}));
    const dir=path.resolve(__dirname,'../design/review');
    const html=await fs.readFile(path.join(dir,'visual-program.html'),'utf8');
    const base='<base href="'+pathToFileURL(dir+path.sep).href+'">';
    const probe='<script>addEventListener("DOMContentLoaded",()=>{try{('+exercise.toString()+')(); document.body.dataset.result="pass";}catch(e){document.body.dataset.result=e.stack;}})</script>';
    const page=path.join(temporary,'index.html');
    await fs.writeFile(page,html.replace('<head>','<head>'+base).replace('<script defer src="visual-program.js"></script>',probe));
    const {stdout}=await exec(chrome,['--headless','--disable-gpu','--disable-extensions','--no-first-run',
      '--user-data-dir='+path.join(temporary,'profile'),'--virtual-time-budget=2500','--dump-dom',pathToFileURL(page).href],
      {windowsHide:true,timeout:30000,maxBuffer:2*1024*1024});
    assert.equal(stdout.match(/<body[^>]*data-result="([^"]*)"/)?.[1],'pass');
  });
