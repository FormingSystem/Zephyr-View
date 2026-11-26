'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs/promises'), os=require('node:os'), path=require('node:path');
const {pathToFileURL}=require('node:url');
const run=require('node:util').promisify(require('node:child_process').execFile);

function exercise(){
  const q=s=>document.querySelector(s);
  const act=id=>q('[data-action="'+id+'"]').click();
  const field=(id,value)=>{
    const n=q('[data-field="'+id+'"]');n.value=value;
    n.dispatchEvent(new Event(n.tagName==='INPUT'?'input':'change',{bubbles:true}));
  };
  const pick=id=>q('[data-pick="'+id+'"]').click();
  const key=(element,k)=>element.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true}));
  const check=(truth,message)=>{if(!truth)throw Error(message)};
  let mutations=0;
  try{
    const original=ZephyrProgramModel.example();
    const editor=ZephyrProgramView.mount(q('main'),{language:document.documentElement.lang,graph:original,onChange:()=>mutations++});
    const graph=()=>editor.graph,root=()=>graph().mainSteps;
    const snapshot=JSON.stringify(original);
    act('library');act('function');
    const fn=graph().functions.at(-1);
    field('name','read_driver');
    check(fn.name==='read_driver','new function name');
    field('operation','external');field('hook','read_sensor');act('addStep');
    check(fn.steps[0].symbol==='read_sensor','driver hook');
    pick('$main');
    field('operation','if');field('operand','7');act('addStep');
    field('operation','call');field('function',fn.id);field('placement','steps');act('addStep');
    check(root().at(-1).steps[0].function===fn.id,'conditional function call');
    act('flow');
    const nested=root().at(-1).steps[0];
    check(q('.vp-node[data-operation-id="'+nested.id+'"]'),'flow graph includes the branch');
    const flowEdge=q('.vp-edge[data-operation-id="'+nested.id+'"]');
    flowEdge.focus();key(flowEdge,'Enter');
    check(editor.stepId===nested.id && document.activeElement.dataset.edge===flowEdge.dataset.edge,'focus and select flow edge from keyboard');
    key(q('.vp-node[data-node="'+nested.id+'"]'),'Enter');
    check(document.activeElement.dataset.field==='operation','edit flow instruction from keyboard');
    const conditional=root().at(-1);
    editor.showTrace({kind:'event',op:'if-then',stepId:conditional.id,contextId:'$main',value:7});
    check(q('.vp-edge.observed')?.dataset.operationId===nested.id,'recorded branch highlights only the taken route');
    editor.showTrace(null);
    act('architecture');act('thread');
    const thread=graph().threads.at(-1);
    field('name','other_worker');
    act('object');
    const object=graph().objects.at(-1);
    act('connect');pick(thread.id);pick(object.id);
    field('operation','send');act('addStep');
    field('operation','receive');act('addStep');
    const recv=thread.steps[1];
    q('.vp-subhead button').click();
    check(thread.steps[0].op==='receive' && thread.steps[1].object===object.id,'reorder steps');
    check(q('[data-edge="'+recv.id+'"]'),'visible directed operation');
    q('.vp-code').open=true;editor.showCode();
    check(q('.vp-code pre').textContent.includes('zv_hook_read_sensor'),'preview renders the generated C');
    const event={contextId:thread.id,stepId:recv.id,objectId:object.id,op:recv.op,value:42};
    const preview=q('.vp-code pre'),sensorCard=q('[data-node=sensor]');
    editor.showTrace(event);
    check(q('.vp-code pre')===preview && q('[data-node=sensor]')===sensorCard,'trace reuses source and diagram');
    check(q('.vp-edge.observed') && q('.vp-caption').textContent.includes('value = 42') && q('.vp-code .current'),'trace highlights graph and source');
    const firstLine=q('.vp-code .current');
    editor.showTrace({...event,op:'send',stepId:thread.steps[1].id});
    check(q('.vp-code .current')!==firstLine && q('.vp-code pre')===preview,'recorded line follows each event in place');
    editor.showTrace(null);
    check(!q('.vp-edge.observed'),'trace clears');
    pick(object.id);act('deleteNode');act('confirmDelete');
    check(!graph().objects.includes(object)&&thread.steps.length===0,'delete clears references');
    act('fit');
    const percent=q('.vp-percent').value; act('zoomOut');check(percent!==q('.vp-percent').value,'zoom');
    check(ZephyrProgramModel.validate(graph()).length===0,'buildable semantic graph');
    check(JSON.stringify(original)===snapshot && mutations>9,'isolated draft mutations');
    editor.setGraph(original);check(graph().threads.length===original.threads.length,'undo from host');
    if(innerWidth<700){
      act('library');act('inspector');
      const side=q('.vp-right'),map=q('.vp-graph');
      check(getComputedStyle(q('.vp-toggles')).display!=='none' && side.clientHeight<=innerHeight*.45,'inspector leaves room for graph');
      check(side.getBoundingClientRect().bottom<=map.getBoundingClientRect().top,'drawer does not overlay canvas');
      key(side,'Escape');
      check(q('[data-action=inspector]').getAttribute('aria-expanded')==='false' && document.activeElement.dataset.action==='inspector','return to toolbar from drawer');
    }
    const labels=[...document.querySelectorAll('.vp-edge-caption')].map(el=>el.getBBox());
    const intersects=(a,b)=>a.x<b.x+b.width && a.x+a.width>b.x && a.y<b.y+b.height && a.y+a.height>b.y;
    check(!labels.some((a,i)=>labels.slice(i+1).some(b=>intersects(a,b))),'edge labels avoid each other');
    for(const malformed of [{...original,mainSteps:[null]},{...original,objects:[] ,threads:original.threads.map(()=>original.threads[0])}]){
      editor.setGraph(malformed);
      check(q('.vp-graph').hidden && !!q('.vp-warnings').textContent,'invalid structure has a readable repair hint');
    }
    const extra={};let tail=extra;
    for(let i=0;i<12000;i++)tail=tail.extra={};
    editor.setGraph({...original,extra});
    check(q('.vp-graph').hidden && q('.vp-warnings').textContent.includes('JSON'),'deep unknown property safely rejected');
    editor.setGraph({...original,extra:Array(65000).fill(1)});
    check(q('.vp-graph').hidden,'oversize graph rejected');
    const broad={...original,mainSteps:Array.from({length:64},(_,i)=>({id:'branch_'+i,op:'print'}))};
    editor.setGraph(broad);pick('$main');act('flow');act('fit');
    const stage=q('.vp-map').getBoundingClientRect(),last=q('[data-node=branch_63]').getBoundingClientRect();
    check(last.right<=stage.right+1 && last.left>=stage.left-1,'fit includes distant steps in a large flow');
    editor.setGraph(original);check(!q('.vp-graph').hidden && q('.vp-warnings').textContent==='','recover on next valid document');
    check(document.documentElement.scrollWidth<=innerWidth,'no horizontal page overflow');
    editor.dispose();parent.postMessage({ok:true,w:innerWidth,lang:document.documentElement.lang},'*');
  }catch(error){parent.postMessage({error:error.stack,w:innerWidth,lang:document.documentElement.lang},'*');}
}

const chrome=process.env.ZEPHYR_TEST_CHROME;
test('visual development edits branches, named hooks and ordered connections and follows an observed source line',
  {skip:!chrome && 'Set ZEPHYR_TEST_CHROME to test the editor in Chromium'},async t=>{
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'visual-program-ui-'));
    t.after(()=>fs.rm(directory,{recursive:true,force:true,maxRetries:8,retryDelay:100}));
    const asset=name=>pathToFileURL(path.resolve(__dirname,'../extension/media/threadStudio',name)).href;
    const scripts=['model','programModel','ui','programFlow','programCanvas','programInspector','programView']
      .map(n=>'<script src="'+asset(n+'.js')+'"></script>').join('');
    for(const lang of ['en','zh'])await fs.writeFile(path.join(directory,lang+'.html'),'<!doctype html><html lang="'+lang+'"><meta charset=utf-8><link rel="stylesheet" href="'+asset('programView.css')+'"><style>body{margin:0}</style><main></main>'+scripts+'<script>('+exercise.toString()+')()</script>');
    const widths=[380,960,1800];
    const frames=['en','zh'].flatMap(lang=>widths.map(w=>'<iframe src="'+lang+'.html" width="'+w+'" height="900"></iframe>')).join('');
    const page=path.join(directory,'index.html');
    await fs.writeFile(page,'<!doctype html><pre id="report"></pre><script>const rows=[];onmessage=e=>{rows.push(e.data);report.textContent=JSON.stringify(rows)}</script>'+frames);
    const {stdout}=await run(chrome,['--headless','--disable-gpu','--no-first-run','--disable-extensions','--user-data-dir='+path.join(directory,'profile'),'--virtual-time-budget=4500','--dump-dom',pathToFileURL(page).href],{timeout:30000,windowsHide:true,maxBuffer:1024*1024});
    const reports=JSON.parse(stdout.match(/<pre id="report">([^<]*)<\/pre>/)?.[1]||'[]');
    for(const lang of ['en','zh'])for(const w of widths){const row=reports.find(r=>r.w===w&&r.lang===lang);assert.ok(row?.ok,JSON.stringify(row)||lang+w);}
});
