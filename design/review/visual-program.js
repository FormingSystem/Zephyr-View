'use strict';
(()=>{
  const english=new URLSearchParams(location.search).get('lang')==='en', lang=english?'en':'zh-CN';
  const t=(zh,en)=>english?en:zh;
  document.documentElement.lang=lang;
  const heading=document.getElementById('heading'),file=document.getElementById('load');
  const result=document.getElementById('result'),open=document.getElementById('open'),save=document.getElementById('save');
  heading.textContent=t('编程工作室','Programming Studio');
  document.title=heading.textContent+' · Zephyr View';
  open.textContent=t('打开设计…','Open design…'); save.textContent=t('保存设计副本…','Save design copy…');
  if(english){const link=document.getElementById('lang');link.href='?lang=zh';link.textContent='简体中文';}
  const sample=new URLSearchParams(location.search).get('example')==='firmware' && globalThis.ZephyrProgramRecording;
  const link=document.getElementById('sample');
  link.textContent=t('播放固件示例','Play firmware example');link.href='?example=firmware&lang='+lang;
  if(sample){link.hidden=true;document.getElementById('lang').href='?example=firmware&lang='+(english?'zh':'en');}
  const key='zephyr-view.visual-program.v1';
  let initial,playback;
  try{const stored=localStorage.getItem(key);if(stored)initial=JSON.parse(stored);}catch{}
  const editor=ZephyrProgramView.mount(document.getElementById('designer'),{language:lang,graph:sample?sample.graph:initial,
    onChange(graph){try{if(!sample)localStorage.setItem(key,JSON.stringify(graph));}catch{} playback?.sync();}});
  if(globalThis.ZephyrProgramPlayback)playback=ZephyrProgramPlayback.mount(editor.traceRoot,{language:lang,model:()=>editor.graph,onEvent:e=>editor.showTrace(e),onRecords:(data,position,seekTo)=>editor.showRecords(data,position,seekTo)});
  if(sample && playback){playback.load(sample.log);playback.toggle();}
  open.addEventListener('click',()=>file.click());
  file.addEventListener('change',async()=>{
    const selected=file.files[0];if(!selected)return;
    try{
      if(selected.size>2*1024*1024)throw Error(t('文件超过 2 MiB。','File exceeds 2 MiB.'));
      const graph=JSON.parse(await selected.text());
      if(!ZephyrProgramView.bounded(graph))throw Error(t('设计的嵌套过深或条目过多。','The design is too deeply nested or contains too many entries.'));
      const issues=ZephyrProgramModel.validate(graph);
      if(issues.length)throw Error(issues[0].field+' · '+issues[0].code);
      editor.setGraph(graph);playback?.sync();try{if(!sample)localStorage.setItem(key,JSON.stringify(graph));}catch{}
      result.textContent=selected.name;
    }catch(error){result.textContent=t('打开失败 · ','Could not open · ')+error.message;}
    file.value='';
  });
  save.addEventListener('click',()=>{
    const graph=editor.graph;
    if(!graph){result.textContent=t('请先打开有效的设计。','Open a valid design first.');return;}
    const url=URL.createObjectURL(new Blob([JSON.stringify(graph,null,2)+'\n'],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download=(/^[a-z]\w*$/i.test(graph.name)?graph.name:'program')+'.zephyr-program.json';
    link.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
  });
})();
