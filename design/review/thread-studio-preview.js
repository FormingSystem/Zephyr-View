'use strict';

(() => {
  const english = new URLSearchParams(location.search).get('lang')==='en';
  const t=(zh,en)=>english?en:zh;
  document.documentElement.lang=english?'en':'zh-CN';
  document.title=t('线程工作室','Thread studio')+' · Zephyr View';
  const locale=document.getElementById('locale'),spec=document.getElementById('spec');
  if(english) {locale.href='?lang=zh';locale.textContent='简体中文';spec.href='thread-studio-draft.en.md';spec.textContent='Design notes';}
  const mockName=t('消息队列示例 · 模拟调试','Message queue example · simulated debugger');
  const debugBase = {sessionId:'demo',sessions:[{id:'demo',name:mockName,type:'demo'}],token:'demo-stop',phase:'disconnected',threads:[],frames:[],scopes:[],variables:[]};
  let debug = {...debugBase};
  let draft = ZephyrThreadModel.defaults();
  let lastSource;
  const view=ZephyrThreadStudio.mount(document.getElementById('thread-studio'),{language:document.documentElement.lang,preview:true,
    onDraft:d=>{draft=d;},post:handle});
  view.update({application:t('设计稿 · 生成的示例源码','Prototype · generated sample source'),debug});

  function handle(m) {
    if(m.action==='export') {
      const files=ZephyrThreadModel.generate(m.draft);
      view.update({notice:t('导出预览；在扩展中会提示选择目录。文件为 ','Export preview. The extension prompts for a destination. Files: ')+Object.keys(files).join(' · ')});
    } else if(m.action==='analyze') showAnalysis();
    else if(m.action==='source') view.update({notice:t('示例源码 · ','Example source · ')+(lastSource?.get(m.id)||'')});
    else if(m.action==='launch') {
      const stopped=debug.phase!=='stopped';
      debug={...debugBase,phase:stopped?'stopped':'running',reason:stopped?t('模拟断点','Simulated breakpoint'):''};
      view.update({debug,notice:stopped?t('模拟暂停：点击「读取线程」。再次点击模拟控制可恢复。','Simulated stop. Read threads or resume using the simulation control.'):t('已模拟继续执行，旧帧已清除。','Simulated resume. Previous frames cleared.')});
    } else if(m.action==='debug') demoRequest(m);
  }

  function showAnalysis() {
    const description=ZephyrThreadModel.describe(draft);
    if(!description.object){view.update({notice:t('请先修正草稿参数。','Correct the draft parameters first.')});return;}
    const file='src/main.c';
    const ref=line=>({file,line,id:'line-'+line});
    const functions=description.threads.map(th=>({...ref(th.line),name:th.entry}));
    const calls=description.threads.flatMap(th=>th.calls.map(c=>({...ref(c.line),name:c.name,owner:th.entry,args:[c.args],object:c.args.startsWith('&'+description.object.name) ? description.object.name : undefined})));
    const threads=description.threads.map(th=>({...ref(th.registrationLine),name:th.entry+(draft.creation==='dynamic'?'_thread':'_id'),entry:th.entry,stack:th.stack,priority:String(th.priority),api:draft.creation==='dynamic'?'k_thread_create':'K_THREAD_DEFINE'}));
    const obj=description.object,objects=[{...ref(obj.line),name:obj.name,api:obj.macro}];
    lastSource=new Map([...threads,...calls,...objects,...functions].map(item=>[item.id,file+':'+item.line+' · '+ZephyrThreadModel.generate(draft)[file].split('\n')[item.line-1].trim()]));
    view.update({analysis:{files:[file],functions,calls,threads,objects,diagnostics:[],coverage:{scanned:1,mode:'source'}},notice:t('设计稿以生成的示例源码演示分析。','Prototype analysis uses the generated sample source.')});
  }

  function demoRequest({op,id}) {
    if(op==='threads') debug={...debug,threads:[{id:1,name:'demo_cpu0',stopped:true}]};
    if(op==='stack') {
      const consumer=ZephyrThreadModel.describe(ZephyrThreadModel.defaults('msgq')).threads[1];
      const line=consumer.calls.find(call=>call.name==='printk').line;
      debug={...debug,threadId:id,frames:[{id:10,name:consumer.entry,path:'src/main.c',line}]};
    }
    if(op==='scopes') debug={...debug,frameId:id,scopes:[{name:t('局部变量（演示）','Locals (demo)'),reference:5}]};
    if(op==='variables') debug={...debug,scopeReference:id,variables:[{name:'value',type:'uint32_t',value:'42'}]};
    view.update({debug});
  }
})();
