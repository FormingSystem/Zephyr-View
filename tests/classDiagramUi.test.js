'use strict';

const assert=require('node:assert/strict');
const {execFile}=require('node:child_process');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {test}=require('node:test');
const {pathToFileURL}=require('node:url');
const {promisify}=require('node:util');

function check_header_navigation(check,t) {
  const fixture=document.createElement('section'), design=document.createElement('div'), toolbar=document.createElement('header');
  document.body.append(fixture);fixture.append(toolbar,design);
  const messages=[], q=selector=>fixture.querySelector(selector);
  const deliver=data=>window.dispatchEvent(new MessageEvent('message',{data}));
  ZephyrStudioToolbar.mount(toolbar,t,action=>messages.push({action}));
  ZephyrStudioProjectSource.bind({postMessage:message=>messages.push(message)},design,toolbar,t);
  function open_modeling() {
    const item=q('[data-command="umlModeling"]'), menu=item.closest('details');
    menu.querySelector('summary').click();
    check(!menu.hidden && menu.open && item.getClientRects().length && item.textContent===t('UML 建模…','UML modeling…'),'UML in Tools menu');
    item.click();
    check(!menu.open && messages.at(-1).action==='umlModeling','dispatch modeling and close menu');
  }
  open_modeling();
  const uri='file:///project/root.h', file='file:///project/chip.h', version=3, revision=7;
  const nodes=[{id:'device',name:'Device',kind:'struct',line:1,members:[{name:'struct Chip chip',line:5}]},
    {id:'chip',name:'Chip',kind:'struct',line:4,file,members:[{name:'uint32_t value',line:8}]}];
  const edges=[{from:'device',to:'chip',line:5,label:'chip',kind:'composition'}];
  const graph={symbols:[],signals:[],entries:[],calls:[],class_diagram:{nodes,edges}};
  const text=Array.from({length:12},(_,i)=>'line '+(i+1)).join('\n');
  const root={type:'projectSource',source:{uri,name:'root.h',current:version,version,graphRevision:revision,graph,text},
    breakpoints:[],trusted:true};
  const header=(request,breakpoints=[])=>({type:'projectHeader',rootUri:uri,graphRevision:revision,navigationId:request.navigationId,
    line:request.line,source:{uri:file,name:'chip.h',current:11,text,displayPath:'include/chip.h'},breakpoints,trusted:true});
  const heading=()=>q('.ps-reader h2').textContent;
  const row=()=>Number(q('.ps-listing .current').dataset.line);
  const action=op=>messages.filter(m=>m.op===op).at(-1);
  const control=(cn,en)=>Array.from(fixture.querySelectorAll('.ps-reader button')).find(b=>b.textContent===t(cn,en));
  q('[data-studio-mode="source"]').click();deliver(root);q('[data-mode="class_diagram"]').click();
  open_modeling();
  q('button[data-uml-edge]').click();check(row()===5,'root evidence line');
  q('button[data-uml-type="chip"]').click();const first=action('revealHeader');
  check(first.uri===uri && first.file===file && first.line===4 && first.version===3 && first.graphRevision===7,'header request context');
  q('[data-uml-member="uint32_t value"]').click();const second=action('revealHeader');
  deliver(header(first));check(heading()==='root.h','ignore out-of-order selection');
  deliver(header(second));check(heading()==='chip.h' && row()===8 && q('.ps-reader h2').title==='include/chip.h','show header member');
  check(q('.ps-graph strong').textContent==='root.h','keep UML source');
  q('[data-command="export-class-diagram"]').click();check(action('exportClassDiagram').uri===uri,'export root diagram');
  control('编辑源码','Edit source').click();control('切换断点','Toggle breakpoint').click();
  for (const op of ['edit','breakpoint']) {
    const m=action(op);check(m.uri===file && m.line===8 && m.version===11 && m.rootUri===uri && m.graphRevision===7,op+' header context');
  }
  q('.ps-listing').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
  deliver(root);deliver(header(second,[9]));
  check(row()===9 && q('.ps-listing .current').classList.contains('ps-break'),'preserve header cursor across breakpoint updates');
  control('← 返回来源','← Back to source').click();check(heading()==='root.h' && row()===5,'return to original row');
  deliver(header(second));check(heading()==='root.h','ignore a response after returning');
  q('button[data-uml-type="chip"]').click();const third=action('revealHeader');deliver(header(third));
  q('button[data-uml-edge]').click();check(heading()==='root.h' && row()===5,'relation returns to root evidence');
  q('button[data-uml-type="chip"]').click();const fourth=action('revealHeader');deliver(header(fourth));
  deliver({...root,source:{...root.source,graphRevision:8}});deliver(header(fourth));
  check(heading()==='root.h' && row()===5,'invalidated header closes after graph changes');
  q('[data-studio-mode="design"]').click();q('[data-studio-mode="source"]').click();
  check(!q('.ps-listing .current') && control('编辑源码','Edit source').disabled,'reopening waits for the new source');
  q('[data-studio-mode="design"]').click();fixture.remove();
}

function exercise() {
  const q=s=>document.querySelector(s);
  const check=(condition,detail)=>{if (!condition) throw Error(detail);};
  const result={width:innerWidth,theme:document.documentElement.dataset.theme};
  try {
    const zh=result.theme==='light',t=(chinese,english)=>zh?chinese:english;
    const members=Array.from({length:7},(_,i)=>({name:'uint32_t value'+i,line:10+i}));
    const nodes=['card','function','channel','token','bus','driver'].map((id,i)=>({id,name:id,kind:'struct',line:1+i,members:i?[]:members}));
    nodes[1].members.push({name:'struct card *owner',line:30});
    const edges=nodes.slice(1).map((node,i)=>({from:'card',to:node.id,line:20+i,kind:'composition',label:'field'+i}));
    edges.push({from:'function',to:'card',kind:'association',line:30,label:'owner',conditional:true},
      {from:'card',to:'card',kind:'association',line:33,label:'next'});
    const model={signals:[],calls:[],entries:[],symbols:[],class_diagram:{nodes,edges}};
    const state={graph:model,version:1,current:1,uri:'sample.h'};
    let line,exports=0;
    const view=ZephyrSourceRelations.mount({container:q('main'),nav:q('nav'),t,onLine:n=>{line=n;},onExportClassDiagram:()=>exports++});
    view.update(state);q('[data-mode="class_diagram"]').click();
    q('button[data-uml-type="card"]').click();check(line===1,'selected type');
    q('[data-uml-member="uint32_t value1"]').click();check(line===11,'selected member');
    q('button[data-uml-edge="0"]').click();check(line===20,'selected composition label');
    const reverse=q('path[data-uml-edge="5"]');reverse.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    check(line===30 && reverse.classList.contains('picked'),'select reverse edge');
    check(q('[data-uml-member="struct card *owner"]').classList.contains('uml-evidence'),'edge highlights the declaring member');
    check(q('path[data-uml-edge="0"]').getAttribute('d')!==reverse.getAttribute('d'),'separate reciprocal paths');
    check(q('[marker-start]') && q('[marker-end]'),'edge direction markers');
    q('[data-more]').click();check(q('[data-uml-member="uint32_t value6"]'),'expanded members');
    q('[data-uml-member="uint32_t value6"]').focus();
    view.update(state);check(document.activeElement.dataset.umlMember==='uint32_t value6','retain keyboard focus on refresh');
    const before=q('.uml-zoom output').textContent;
    q('.uml-canvas').dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,deltaY:-10,cancelable:true}));
    check(before!==q('.uml-zoom output').textContent,'zoom');
    q('.uml-footer button:last-of-type').click();check(q('path[data-line="33"]'),'self relation on next page');
    q('[data-command="export-class-diagram"]').click();check(exports===1,'export current');
    view.update({...state,current:2,issue:'incomplete'});
    check(q('button[data-uml-type]').disabled && q('button[data-uml-edge]').disabled && q('[data-command="export-class-diagram"]').disabled,'stale actions');
    view.update({...state,current:3,version:3});check(!q('.uml-hit.picked'),'new source revision clears the previous edge selection');
    const selection=q('[data-uml-focus]');selection.value='bus';selection.dispatchEvent(new Event('change'));
    check(q('.uml-focus [data-uml-type]').dataset.umlType==='bus','focus type');
    check(document.documentElement.scrollWidth<=innerWidth,'page overflow');
    view.update({...state,graph:{...model,class_diagram:{nodes:[],edges:[]}}});
    check(q('.uml-layout.empty') && !q('[data-uml-member]'),'empty source');
    q('[data-mode="signals"]').click();check(!q('.uml-workspace'),'switch away');
    check_header_navigation(check,t);
    result.ok=true;
  } catch(error) {result.error=error.message;}
  parent.postMessage(result,'*');
}

const chrome=process.env.ZEPHYR_TEST_CHROME;
test('UML canvas links declarations and directional edges to source at narrow and full widths',
  {skip:!chrome && 'Set ZEPHYR_TEST_CHROME to a Chromium executable'},async t=>{
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'zephyr-uml-ui-'));
    t.after(()=>fs.rm(dir,{recursive:true,force:true,maxRetries:4,retryDelay:100}));
    const uri=name=>pathToFileURL(path.resolve(__dirname,'../extension/media/threadStudio',name)).href;
    const scripts=['ui','classDiagram','sourceRelations','programDesk','studioToolbar','studioProjectSource'].map(n=>'<script src="'+uri(n+'.js')+'"></script>').join('');
    const styles=['liveSource','sourceRelations','classDiagram'].map(n=>'<link rel="stylesheet" href="'+uri(n+'.css')+'">').join('');
    const widths=[360,720,1640],themes=['dark','light'];
    for (const theme of themes) {
      const page='<!doctype html><html data-theme="'+theme+'"><meta charset="utf-8">'+styles+
        '<style>html{--vscode-font-size:14px;--vscode-font-family:sans-serif;--vscode-editor-background:'+(theme==='dark'?'#222':'#fff')+'}</style>'+
        '<body><nav></nav><main></main>'+scripts+'<script>'+check_header_navigation.toString()+';('+exercise.toString()+')()</script></body></html>';
      await fs.writeFile(path.join(dir,theme+'.html'),page);
    }
    const frames=themes.flatMap(theme=>widths.map(width=>'<iframe width="'+width+'" height="680" src="'+theme+'.html"></iframe>'));
    const file=path.join(dir,'test.html');
    await fs.writeFile(file,'<!doctype html><pre id="out"></pre><script>const results=[];onmessage=e=>{results.push(e.data);out.textContent=JSON.stringify(results)}</script>'+frames.join(''));
    const {stdout}=await promisify(execFile)(chrome,['--headless','--disable-gpu','--disable-extensions','--no-first-run',
      '--window-size=1920,1080','--user-data-dir='+path.join(dir,'profile'),'--virtual-time-budget=5000','--dump-dom',pathToFileURL(file).href],
      {windowsHide:true,maxBuffer:1024*1024,timeout:30000});
    const results=JSON.parse(stdout.match(/<pre id="out">([^<]*)<\/pre>/)?.[1]||'[]');
    for(const width of widths) for(const theme of themes) assert.deepEqual(results.find(r=>r.width===width && r.theme===theme),{width,theme,ok:true});
  });
