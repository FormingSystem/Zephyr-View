'use strict';

const assert = require('node:assert/strict');
const {execFile} = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {promisify} = require('node:util');
const {pathToFileURL} = require('node:url');
const test = require('node:test');
const command = promisify(execFile);

function exerciseStudio() {
  const report = {lang:document.documentElement.lang,width:innerWidth};
  const q = selector => document.querySelector(selector);
  const click = selector => q(selector).click();
  const check = (condition,message) => {if (!condition) throw Error(message);};
  function input(key,value) {
    const element=q('[data-key="'+key+'"]');
    element.value=String(value);
    element.dispatchEvent(new Event('input'));
  }
  try {
    const en = report.lang === 'en';
    const posted = [];
    const root = q('#studio');
    const studio=ZephyrThreadStudio.mount(root,{language:report.lang,post:m=>posted.push(m)});
    for (const kind of ['msgq','sem','mutex']) {
      click('[data-focus="ts-kind-'+kind+'"]');
      check(q('.ts-diagram').querySelectorAll('.ts-node').length===3,'diagram nodes');
      if (kind === 'mutex') check(q('.ts-reverse'),'both workers acquire the lock');
      else {
        input('capacity',9);
        check(q('.ts-code').textContent.includes(', 9') || q('.ts-code').textContent.includes(', 0, 9'),'capacity reaches C');
      }
    }
    const creation=q('.ts-creation select');
    creation.value='dynamic'; creation.dispatchEvent(new Event('change'));
    click('[data-node="producer"]');
    check(q('.ts-evidence').textContent.includes('K_NO_WAIT'),'dynamic registration includes start condition');
    input('producerStack',513);
    check(q('.ts-primary').disabled && q('[aria-invalid=true]'),'invalid stack blocks export');
    input('producerStack',2048);
    check(q('.ts-code').textContent.includes('2048'),'corrected stack reaches generated source');
    click('.ts-primary');
    check(posted.at(-1).draft.producerStack===2048 && posted.at(-1).action==='export','export valid draft');
    check(document.documentElement.scrollWidth<=innerWidth,'draft overflow');
    q('#ts-tab-draft').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight'}));
    check(q('#ts-tab-analysis').getAttribute('aria-selected')==='true','arrow navigation');
    studio.update({application:'test-app',analysis:{threads:[{id:'entry',entry:'consume',name:'consumer',file:'src/main.c',line:1,api:'K_THREAD_DEFINE'},{id:'producer',entry:'send',name:'sender',file:'src/main.c',line:7,api:'K_THREAD_DEFINE'}],
      functions:[{name:'consume',id:'fn',file:'src/main.c'},{name:'send',id:'sendfn',file:'src/main.c'}],objects:[{name:'q',id:'oa',file:'src/main.c',line:4,api:'K_MSGQ_DEFINE'}],
      calls:[{id:'ca',owner:'consume',ownerId:'fn',name:'k_msgq_get',file:'src/main.c',line:4,object:'q',args:['&q','&packet','K_FOREVER']},{id:'cb',owner:'send',ownerId:'sendfn',name:'k_msgq_put',file:'src/main.c',line:8,object:'q',args:['&q','&value','K_NO_WAIT']}],
      diagnostics:[],coverage:{mode:'source',scanned:1}}});
    click('.ts-relation .ts-link');
    check(posted.at(-1).action==='source' && posted.at(-1).id==='ca','call site uses source token');
    click('.ts-relation .ts-item');
    const peer=[...document.querySelectorAll('.ts-object button')].find(b=>b.textContent.includes('sender'));
    check(peer,'peer thread reachable through queue');
    peer.click();
    check(q('[data-focus="ts-entry"]').value==='producer','switch to writer from reader');
    click('#ts-tab-debug');
    check(!q('.ts-frames'),'no invented debugger stack');
    const debug={phase:'stopped',sessionId:'s',token:'s:5',sessions:[{name:'CPU',id:'s',type:'cortex-debug'}],
      threads:[{name:'CPU#0',id:1,stopped:true}],frames:[{id:7,name:'consumer_entry',path:'src/main.c',line:8}],
      frameId:7,scopes:[{name:'Local',reference:5}],variables:[{name:'value',type:'uint32_t value;\ndec: 42\nhex: 0x2a',value:'42'}]};
    studio.update({debug});
    click('.ts-frames button');
    check(posted.at(-1).op==='scopes' && posted.at(-1).id===7 && posted.at(-1).token===debug.token,'frame request');
    check(q('.ts-content').textContent.includes('42'),'observed value');
    const type=q('.ts-record span[title]');
    check(type.textContent==='uint32_t value;' && type.title.includes('hex: 0x2a'),'multiline debugger type details');
    studio.update({debug:{phase:'running',sessions:[]}});
    check(!q('.ts-frames') && !q('.ts-content').textContent.includes('42'),'resume clears frames');
    studio.update({trusted:false});
    click('#ts-tab-draft');
    check(q('.ts-primary').disabled,'untrusted export');
    check(document.documentElement.scrollWidth<=innerWidth,'final overflow');
    check(q('h1').textContent===(en?'Concurrency analysis':'并发分析'),'locale');
    studio.dispose();
    report.ok=true;
  } catch(error) {report.error=error.message;}
  parent.postMessage(report,'*');
}

const chrome=process.env.ZEPHYR_TEST_CHROME;
test('thread studio connects draft parameters, source evidence and stopped frames at narrow and wide widths',
  {skip:!chrome && 'Set ZEPHYR_TEST_CHROME to a Chromium executable'}, async t=>{
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'zephyr-thread-ui-'));
    t.after(()=>fs.rm(directory,{recursive:true,force:true,maxRetries:6,retryDelay:100}));
    const asset=name=>pathToFileURL(path.resolve(__dirname,'..',name)).href;
    const scripts='<script src="'+asset('design/pathDisplay.js')+'"></script>'+['model','ui','draftView','evidenceView','studio']
      .map(name=>'<script src="'+asset('extension/media/threadStudio/'+name+'.js')+'"></script>').join('');
    const css=['extension/media/design/workbench.css','extension/media/design/appearance.css','extension/media/threadStudio/studio.css']
      .map(name=>'<link rel="stylesheet" href="'+asset(name)+'">').join('');
    const langs=['zh-CN','en'], widths=[320,720,1280];
    for(const lang of langs) await fs.writeFile(path.join(directory,lang+'.html'),'<!doctype html><html lang="'+lang+'"><meta charset=utf-8>'+css+
      '<body><main id=studio></main>'+scripts+'<script>('+exerciseStudio.toString()+')()</script></body></html>');
    const runner=path.join(directory,'checks.html');
    const frames=langs.flatMap(lang=>widths.map(width=>'<iframe width="'+width+'" height="720" src="'+lang+'.html"></iframe>'));
    await fs.writeFile(runner,'<!doctype html><pre id="results"></pre><script>let rows=[];onmessage=e=>{rows.push(e.data);results.textContent=JSON.stringify(rows)}</script>'+frames.join(''));
    const {stdout}=await command(chrome,['--headless','--disable-gpu','--disable-extensions','--no-first-run','--user-data-dir='+path.join(directory,'profile'),
      '--window-size=1920,1080','--virtual-time-budget=4000','--dump-dom',pathToFileURL(runner).href],{windowsHide:true,timeout:30000,maxBuffer:1024*1024});
    const reports=JSON.parse(stdout.match(/<pre id="results">([^<]*)<\/pre>/)?.[1] || '[]');
    for (const lang of langs) for(const width of widths) assert.deepEqual(reports.find(r=>r.lang===lang && r.width===width),{lang,width,ok:true});
  });
