'use strict';

globalThis.ZephyrThreadStudio = (() => {
  function mount(root, options = {}) {
    const {el,button} = ThreadStudioUI;
    const t = (zh,en) => String(options.language || document.documentElement.lang).toLowerCase().startsWith('zh') ? zh : en;
    const model = ZephyrThreadModel;
    const draft = options.draft && model.kinds.includes(options.draft.kind) ? {...options.draft} : model.defaults();
    const state = {draft,drafts:{},view:'draft',node:'object',file:'src/main.c',callPath:[],trusted:true};
    const views = {draft:t('编程草稿','Program draft'),analysis:t('工程分析','Source analysis'),debug:t('暂停栈','Paused stack')};
    const shell = el('div','thread-studio');
    const tabs = el('div','ts-tabs');
    tabs.setAttribute('role','tablist');
    tabs.setAttribute('aria-label',t('分析视图','Analysis views'));
    const pane = el('div','ts-content');
    pane.setAttribute('role','tabpanel');
    pane.id='ts-current-pane';
    const notice = el('p','ts-notice');
    notice.setAttribute('role','status');
    const heading = el('div','ts-heading',el('h1','',t('并发分析','Concurrency analysis')),
      options.preview ? el('span','ts-preview-label',t('交互设计稿','Interactive prototype')) : null);
    if (options.openDesigner) heading.append(button(t('打开编程工作室','Open Programming Studio'),options.openDesigner,'ts-item'));
    shell.append(heading,tabs,pane,notice);
    const ctx = {t,model,state,draw,preview:options.preview,post:m=>options.post?.(m),save:()=>options.onDraft?.({...state.draft})};

    for (const [id,label] of Object.entries(views)) {
      const tab = button(label,()=>{state.view=id;draw('ts-tab-'+id);},'ts-tab');
      tab.dataset.focus='ts-tab-'+id;
      tab.id='ts-tab-'+id;
      tab.setAttribute('role','tab');
      tab.setAttribute('aria-controls',pane.id);
      tab.addEventListener('keydown', event=>{
        const ids=Object.keys(views);
        const dir=event.key==='ArrowLeft'?-1:event.key==='ArrowRight'?1:0;
        if (!dir && !['Home','End'].includes(event.key)) return;
        event.preventDefault();
        state.view=event.key==='Home'?ids[0]:event.key==='End'?ids.at(-1):ids[(ids.indexOf(id)+dir+ids.length)%ids.length];
        draw('ts-tab-'+state.view);
      });
      tabs.append(tab);
    }
    function draw(focus) {
      for(const tab of tabs.children){
        const selected=tab.id==='ts-tab-'+state.view;
        tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;
      }
      pane.setAttribute('aria-labelledby','ts-tab-'+state.view);
      const render = state.view==='draft' ? ThreadDraftView : state.view==='analysis' ? ThreadEvidenceView.analysis : ThreadEvidenceView.runtime;
      pane.replaceChildren(render(ctx));
      if (focus) shell.querySelector('[data-focus="'+CSS.escape(focus)+'"]')?.focus({preventScroll:true});
    }
    root.replaceChildren(shell);
    draw();
    return {
      update(patch = {}) {
        const sameScan = patch.analysis?.scanId && patch.analysis.scanId === state.analysis?.scanId;
        const newScan = Object.hasOwn(patch,'analysis') && !sameScan && patch.analysis !== state.analysis;
        if (newScan) {state.callPath=[];state.entry=undefined;state.objectId=undefined;}
        const applicationChanged = 'application' in patch && patch.application !== state.application;
        const trustChanged=Object.hasOwn(patch,'trusted') && state.trusted!==patch.trusted;
        Object.assign(state,patch);
        notice.textContent=state.notice || '';
        if (trustChanged || (state.view==='analysis' && (newScan || applicationChanged)) || (state.view==='debug' && 'debug' in patch)) draw();
      },
      dispose() {shell.remove();}
    };
  }
  return {mount};
})();
