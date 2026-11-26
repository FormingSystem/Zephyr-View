'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const {pathToFileURL} = require('node:url');
const {execFile} = require('node:child_process');
const run = require('node:util').promisify(execFile);

// Runs inside a real Chromium frame. Only the VS Code extension-host transport is substituted.
function exercisePicker() {
  const cn=document.documentElement.lang==='zh';
  const check=(condition,message)=>{if(!condition) throw Error(message);};
  const get=selector=>document.querySelector(selector);
  const messages=[];
  window.send=(action,id)=>messages.push({action,id});
  const buttonWith=text=>[...document.querySelectorAll('.target-picker button')].find(b=>b.textContent===text);
  function click(button) {
    check(button && !button.disabled,'control unavailable');
    button.scrollIntoView({block:'center'});
    const rect=button.getBoundingClientRect();
    check(rect.width>0 && rect.left>=0 && rect.right<=document.documentElement.clientWidth+1,'control clipped: '+button.textContent);
    const hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
    check(button.contains(hit),'control covered: '+button.textContent);
    hit.click();
  }
  function opened() {
    click(get('[data-act="target:search:board"]'));
    check(messages.at(-1).action==='targetList','missing target list request');
    return messages.at(-1).id.request;
  }
  function receive(picker,items,diagnostics=[]) {
    window.dispatchEvent(new MessageEvent('message',{data:{picker,items,diagnostics}}));
  }
  function checkLayout() {
    check(document.documentElement.scrollWidth<=document.documentElement.clientWidth+1,'horizontal scrolling');
    const bar=get('.picker-bar'),input=bar.querySelector('input').getBoundingClientRect();
    const next=bar.querySelector('button').getBoundingClientRect();
    check(input.width>40 && input.right<=next.left,'search and action overlap');
    for(const item of document.querySelectorAll('.discovery-diagnostics code,.discovery-diagnostics small')) {
      for(const rect of item.getClientRects()) {
        check(rect.left>=0 && rect.right<=document.documentElement.clientWidth+1,'diagnostic text clipped');
      }
    }
  }
  const filename='C:/Worktrees/Current checkout/boards/vendor/board with spaces/board.yml';
  const issued=[{kind:'boardFile',path:filename,message:'Invalid SoC reference: <board>'}];
  try {
    get('main').innerHTML=targetFields(targetField('board',cn?'开发板与 CPU':'Board and CPU','',''));
    const first=opened();
    receive(first,['kit/cpuapp'],issued);
    checkLayout();
    const warning=get('.discovery-diagnostics');
    check(warning.open && warning.querySelector('code').textContent===filename,'missing diagnostic path');
    check(warning.textContent.includes(cn?'检查报错位置':'Check the reported location'),'missing actionable advice');
    check(warning.textContent.includes('<board>') && !warning.querySelector('board'),'diagnostic escaping');
    click(warning.querySelector('button'));
    check(messages.at(-1).action==='openDiscoveryFile' && messages.at(-1).id===filename,'incorrect open-file request');
    click(get('.picker-results button'));
    check(messages.at(-1).action==='targetSelect' && messages.at(-1).id.value==='kit/cpuapp','valid board inaccessible');

    const second=opened();
    receive(second,[]);
    receive(first,['stale/target'],issued);
    checkLayout();
    check(!get('.picker-results button') && !get('.discovery-diagnostics'),'stale network response reused');
    check(get('[role=status]').textContent===(cn?'没有匹配项':'No matches'),'empty state');
    click(buttonWith(cn?'添加板卡搜索目录…':'Add board root…'));
    check(messages.at(-1).action==='environment' && messages.at(-1).id==='BOARD_ROOT','wrong root action');
    const field=get('.picker-bar input');
    field.value='custom@2/soc/cpu';
    field.dispatchEvent(new Event('input',{bubbles:true}));
    click(buttonWith(cn?'使用此 BOARD':'Use this BOARD'));
    check(messages.at(-1).action==='targetBoard' && messages.at(-1).id.value===field.value,'manual target lost');

    window.live={folder:'C:/workspace/zephyr'};
    const current=cn?'当前目录':'Current directory';
    for(const [kind,value] of [['app','.'],['build',live.folder]]) {
      get('main').innerHTML=targetFields(targetField(kind,kind,value,value));
      check(get('main').textContent.includes(current),'current directory not labeled in target field');
      click(get('[data-act="target:search:'+kind+'"]'));
      receive(messages.at(-1).id.request,[value,'samples/demo']);
      const search=get('.picker-bar input');
      search.value=current;
      search.dispatchEvent(new Event('input',{bubbles:true}));
      const result=get('.picker-results button');
      check(result && result.firstChild.textContent===current,'current directory not searchable by its label');
      if(value==='.')check(!result.querySelector('small'),'stray dot in directory result');
      click(result);
      check(messages.at(-1).action==='targetSelect' && messages.at(-1).id.value===value,'directory value changed during selection');
    }
    parent.postMessage({lang:document.documentElement.lang,width:innerWidth,ok:true},'*');
  } catch(error) {
    parent.postMessage({lang:document.documentElement.lang,width:innerWidth,error:error.message},'*');
  }
}

const chrome=process.env.ZEPHYR_TEST_CHROME;
test('board recovery and directory selection work in English and Chinese at narrow and desktop widths',
  {skip:!chrome && 'Set ZEPHYR_TEST_CHROME to a Chromium executable to verify browser layout'},async t=>{
    const temp=await fs.mkdtemp(path.join(os.tmpdir(),'zephyr-picker-browser-'));
    t.after(()=>fs.rm(temp,{recursive:true,force:true,maxRetries:6,retryDelay:100}));
    const asset=name=>pathToFileURL(path.resolve(__dirname,'..',name)).href;
    const css=['design/workbench.css','design/build-panel.css','design/appearance.css','extension/media/workbench.css']
      .map(name=>'<link rel="stylesheet" href="'+asset(name)+'">').join('');
    const scripts=['design/fuzzy.js','design/pathDisplay.js','design/build-context.js','extension/media/discoveryDiagnostics.js','extension/media/targetPicker.js']
      .map(name=>'<script src="'+asset(name)+'"></script>').join('');
    const languages=['en','zh'], widths=[360,1200];
    for(const lang of languages) {
      await fs.writeFile(path.join(temp,lang+'.html'),'<!doctype html><html lang="'+lang+'"><meta charset="utf-8">'+css+
        '<body><main class="native-grid"></main>'+scripts+'<script>('+exercisePicker.toString()+')()</script></body></html>');
    }
    const runner=path.join(temp,'test.html');
    const frames=languages.flatMap(lang=>widths.map(width=>'<iframe width="'+width+'" height="640" src="'+lang+'.html"></iframe>'));
    await fs.writeFile(runner,'<!doctype html><meta charset="utf-8"><pre id="results"></pre><script>const reports=[];'+
      'onmessage=e=>{reports.push(e.data);results.textContent=JSON.stringify(reports)}</script>'+frames.join(''));
    const {stdout}=await run(chrome,['--headless','--disable-gpu','--disable-extensions','--no-first-run',
      '--user-data-dir='+path.join(temp,'profile'),'--window-size=1920,1080','--virtual-time-budget=4000',
      '--dump-dom',pathToFileURL(runner).href],{windowsHide:true,timeout:30000,maxBuffer:1024*1024});
    const reports=JSON.parse(stdout.match(/<pre id="results">([^<]*)<\/pre>/)?.[1] || '[]');
    assert.equal(reports.length,4,JSON.stringify(reports));
    for(const lang of languages) {
      for(const width of widths) assert.deepEqual(reports.find(r=>r.lang===lang && r.width===width),{lang,width,ok:true});
    }
  });
