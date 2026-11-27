'use strict';

const assert=require('node:assert/strict');
const {execFile}=require('node:child_process');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {test}=require('node:test');
const {pathToFileURL}=require('node:url');
const {promisify}=require('node:util');

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
    const scripts=['ui','classDiagram','sourceRelations'].map(n=>'<script src="'+uri(n+'.js')+'"></script>').join('');
    const styles=['liveSource','sourceRelations','classDiagram'].map(n=>'<link rel="stylesheet" href="'+uri(n+'.css')+'">').join('');
    const widths=[360,720,1640],themes=['dark','light'];
    for (const theme of themes) {
      const page='<!doctype html><html data-theme="'+theme+'"><meta charset="utf-8">'+styles+
        '<style>html{--vscode-font-size:14px;--vscode-font-family:sans-serif;--vscode-editor-background:'+(theme==='dark'?'#222':'#fff')+'}</style>'+
        '<body><nav></nav><main></main>'+scripts+'<script>('+exercise.toString()+')()</script></body></html>';
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
