'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dir = '../extension/media/threadStudio/';
require(dir+'programFlow');
const {pipeline, sequence_index, sequence_page} = require(dir+'programDiagrams');
const {parse} = require(dir+'programTrace');
const graph = require('../extension/examples/visual-program/graph.json');
const console_text = fs.readFileSync(path.join(__dirname,'../extension/examples/visual-program/console.txt'),'utf8');

test('sequence lifelines follow recorded input and return, including nested calls and v1', () => {
  const capture = parse(console_text,graph), index = sequence_index(graph);
  const first = sequence_page(capture,index,0), last=sequence_page(capture,index,999);
  const process = first.events.filter(e=>e.stepId==='process');
  assert.deepEqual(process.map(e=>[e.from,e.to,e.phase,e.value]),[['relay','scale','enter',42],['scale','relay','return',84]]);
  assert.deepEqual(first.events.filter(e=>e.objectId==='samples').map(e=>[e.from,e.to]),[['sensor','samples'],['samples','relay']]);
  assert.equal(first.events[0].contextId,'$main');
  assert.equal(last.page,1);
  assert.equal(last.start,16);
  assert.equal(last.events.length,2);
  const legacy=parse(fs.readFileSync(path.join(__dirname,'fixtures/visual-program/v1-console.txt'),'utf8'),graph);
  assert.deepEqual(sequence_page(legacy,index,0).events.filter(e=>e.stepId==='process').map(e=>e.phase),['return']);
  const nested=structuredClone(graph);
  nested.functions[0].steps.push({id:'in_driver',op:'external',symbol:'scale'});
  const row={kind:'event',contextId:'relay',stepId:'in_driver',op:'external',phase:'enter',callee:'scale',value:84};
  const result=sequence_page({rows:[row]},sequence_index(nested),0).events[0];
  assert.deepEqual([result.from,result.to,result.contextId],['scale','@hook:scale','relay']);
});

test('loss and live-buffer offsets survive paging without fabricated edges', () => {
  const data={first:73,rows:[{kind:'gap',line:91},{kind:'loss',line:92,count:9}]};
  const page=sequence_page(data,sequence_index(graph),0);
  assert.equal(page.start,73); assert.deepEqual(page.lanes,[]);
  assert.equal(page.events[1].count,9);
});

test('pipeline retains feedback loops, shared stages, isolated actors and permit direction', () => {
  const g=structuredClone(graph);
  g.threads[0].steps.push({id:'feedback',op:'take',object:'ready'});
  g.functions[0].steps.push({id:'hook_step',op:'external',symbol:'measure'});
  g.threads.push({id:'idle', name:'idle',steps:[]});
  const {groups,isolated}=pipeline(g);
  const group=id=>groups.find(row=>row.id===id);
  assert.deepEqual(group('samples').inputs.map(a=>a.actor.id),['sensor']);
  assert.deepEqual(group('samples').outputs.map(a=>a.actor.id),['relay']);
  assert.ok(group('ready').outputs.some(a=>a.actor.id==='sensor'));
  assert.deepEqual(group('scale').inputs.map(a=>a.step.id),['process']);
  assert.deepEqual(group('@hook:measure').outputs.map(a=>a.actor.id),['scale']);
  assert.ok(isolated.some(owner=>owner.id==='idle'));
});

function exercise_workbench() {
  const d=document, q=selector=>d.querySelector(selector);
  const click=selector=>q(selector).click();
  const act=name=>click('[data-action="'+name+'"]');
  const verify=(value,msg)=>{if (!value) throw Error(msg);};
  try {
    q('.vp-play-range').dispatchEvent(new Event('input',{bubbles:true}));
    act('sequence');
    const row=q('.vp-event-row[data-record="7"]');
    verify(row.title.includes('scale → relay') && row.title.includes('84'),'recorded function return');
    row.click();
    verify(q('.vp-play-range').value==='7' && q('.vp-return'),'seek to original recording');
    click('.vp-event-nav button:last-child');
    verify(q('.vp-event-row[data-record="17"]'),'last event page');
    act('pipeline');
    click('[data-focus-key="out:read"]');
    verify(q('[data-field=operation]').value==='receive','edit the receiving endpoint');
    act('flow');
    verify(q('[data-node="read"] [data-shape=io]'),'I/O symbol');
    verify(q('[data-node="process"] [data-shape=subroutine]'),'function call symbol');
    click('[data-pick="scale"]');
    verify(q('[data-node="threshold"] [data-shape=decision]'),'decision symbol');
    for(const text of d.querySelectorAll('.vp-node text')){
      const bounds=text.getBBox();
      verify(bounds.x>=0 && bounds.x+bounds.width<185,'label contained by node: '+text.textContent);
    }
    const sample=ZephyrProgramModel.example();
    sample.functions[0].name='fixed_point_temperature_filter_with_calibration';
    const host=ThreadStudioUI.el('div');d.body.append(host);
    const other=ZephyrProgramView.mount(host,{language:d.documentElement.lang,graph:sample});
    const card=host.querySelector('[data-node="scale"]');
    verify(card.querySelector('title').textContent.includes(sample.functions[0].name),'full long name available');
    verify(card.querySelector('.vp-node-name').textContent.endsWith('…'),'long label fits');
    other.dispose();
    act('sequence');
    verify(d.documentElement.scrollWidth<=innerWidth,'no horizontal workbench overflow');
    parent.postMessage({ok:true,width:innerWidth,lang:d.documentElement.lang},'*');
  } catch(error) { parent.postMessage({error:error.message,width:innerWidth,lang:d.documentElement.lang},'*'); }
}

test('diagram pages, pipeline endpoints and flowchart shapes work in the bilingual workbench',
  {skip:!process.env.ZEPHYR_TEST_CHROME && 'Set ZEPHYR_TEST_CHROME for the browser integration'}, async t=>{
    const os=require('node:os'), {pathToFileURL}=require('node:url');
    const run=require('node:util').promisify(require('node:child_process').execFile);
    const work=await fs.promises.mkdtemp(path.join(os.tmpdir(),'zv-diagram-ui-'));
    t.after(()=>fs.promises.rm(work,{recursive:true,force:true,maxRetries:5,retryDelay:200}));
    const page=path.resolve(__dirname,'../design/review/visual-program.html');
    let html=fs.readFileSync(page,'utf8').replace('<head>','<head><base href="'+pathToFileURL(page).href+'">');
    html=html.replace('</body>','<script>addEventListener("load",'+exercise_workbench.toString()+');</script></body>');
    const workbench=path.join(work,'workbench.html');
    await fs.promises.writeFile(workbench,html);
    const widths=[380,940,1600], languages=['zh','en'];
    const frames=languages.flatMap(lang=>widths.map(w=>'<iframe width="'+w+'" height="900" src="workbench.html?example=firmware&lang='+lang+'"></iframe>')).join('');
    const index=path.join(work,'index.html');
    await fs.promises.writeFile(index,'<!doctype html><meta charset=utf-8><pre id="results"></pre><script>const rows=[];onmessage=e=>{rows.push(e.data);results.textContent=JSON.stringify(rows)}</script>'+frames);
    const {stdout}=await run(process.env.ZEPHYR_TEST_CHROME,['--headless','--disable-gpu','--disable-extensions','--no-first-run','--user-data-dir='+path.join(work,'profile'),'--virtual-time-budget=3500','--dump-dom',pathToFileURL(index).href],{timeout:35000,windowsHide:true,maxBuffer:1024*1024});
    const reports=JSON.parse(stdout.match(/<pre id="results">([^<]*)<\/pre>/)?.[1] || '[]');
    for (const lang of languages) for (const width of widths) {
      const result=reports.find(r=>r.width===width && r.lang.startsWith(lang));
      assert.ok(result?.ok,JSON.stringify(result)||lang+' '+width);
    }
  });
