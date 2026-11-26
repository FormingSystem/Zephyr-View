'use strict';

(() => {
  const host = acquireVsCodeApi();
  const zh = document.documentElement.lang.startsWith('zh');
  const t = (chinese,english) => zh ? chinese : english;
  const root = document.getElementById('designer');
  const status = document.getElementById('feedback');
  let editor, playback, graph, version, submitted, pending, queuedAction;
  let trusted = false, attached = false;

  function action(name,fields={}) {
    if (submitted || pending) queuedAction = {name,fields};
    else host.postMessage({...fields,action:name,version});
  }
  const toolbar = document.getElementById('commands');
  const labels = {new:t('新建设计','New design'),demo:t('播放固件示例','Play firmware example'),save:t('保存','Save'),copy:t('另存为…','Save as…'),open:t('打开设计…','Open design…'),
    export:t('导出新应用…','Export application…'),apply:t('审查源码更新…','Review source changes…'),
    window:t('移至新窗口','Move to new window'),text:t('打开 JSON','Open JSON')};
  for (const [key,label] of Object.entries(labels)) {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = label; button.dataset.command = key;
    button.addEventListener('click', () => action(key));
    toolbar.append(button);
  }
  function disabled(key, value) {toolbar.querySelector('[data-command="'+key+'"]').disabled=Boolean(value);}
  function update_actions() {
    const invalid = !editor || editor.diagnostics.length > 0;
    disabled('export',!trusted || invalid);
    disabled('apply',!trusted || !attached || invalid);
    const reason = invalid ? t('先修复上方的设计错误。','Correct the design errors above first.') :
      !trusted ? t('在受信任的工作区中可用。','Available in a trusted workspace.') : '';
    toolbar.querySelector('[data-command=export]').title = reason;
    toolbar.querySelector('[data-command=apply]').title = reason || (!attached ?
      t('打开已导出的 design.zephyr-program.json 后可审查更新。','Open an exported design.zephyr-program.json to review updates.') : '');
  }
  function flush() {
    if (submitted) return;
    if (pending) {
      submitted = pending; pending = undefined;
      host.postMessage({action:'edit', graph:submitted, version});
    } else if (queuedAction) {
      const next = queuedAction; queuedAction = undefined; action(next.name,next.fields);
    }
  }
  function change(next) {
    graph = next;
    update_actions();
    playback?.sync();
    pending = structuredClone(next);
    flush();
  }
  function mount(next) {
    editor = ZephyrProgramView.mount(root,{language:zh?'zh-CN':'en',graph:next,onChange:change,
      openSource:trusted && attached ? (file,step,protocol)=>action('source',{file,step,protocol}) : undefined});
    playback = ZephyrProgramPlayback.mount(editor.traceRoot,{language:zh?'zh-CN':'en',
      model:()=>graph,onEvent:event=>editor.showTrace(event),requestFile:()=>action('trace'),
      requestFollow:()=>action('follow'), requestStop:()=>action('stopFollow')});
  }
  function receive(data) {
    version = data.version;
    trusted=data.trusted; attached=data.attached;
    if (submitted && !data.force && JSON.stringify(submitted)===JSON.stringify(data.graph)) {
      submitted=undefined; flush(); return;
    }
    const interrupted = Boolean(submitted || pending);
    submitted=pending=queuedAction=undefined;
    if (interrupted) status.textContent=t('已载入文档的新版本。请核对刚才的编辑。','The document changed. Review your last edit.');
    else status.textContent='';
    const changed = JSON.stringify(data.graph)!==JSON.stringify(graph);
    graph=data.graph;
    if (!editor) mount(graph);
    else if (changed) {editor.setGraph(graph);playback.sync();}
    update_actions();
  }
  window.addEventListener('message',({data})=>{
    if (data?.type==='document') receive(data);
    if (data?.type==='invalid') {
      version=data.version; submitted=pending=queuedAction=undefined; graph=undefined;
      playback?.dispose();editor?.dispose();playback=editor=undefined;
      root.replaceChildren(); update_actions(); status.textContent=data.message;
    }
    if (data?.type==='follow' && playback) playback.follow(data.text,data.options);
    if (data?.type==='stopped' && playback) playback.stopFollowing();
    if (data?.type==='trace' && playback) {
      playback.load(data.text);
      if (data.autoplay) playback.toggle();
    }
    if (data?.notice) status.textContent=data.notice;
  });
  window.addEventListener('pagehide',()=>{playback?.dispose(); editor?.dispose();});
  host.postMessage({action:'ready'});
})();
