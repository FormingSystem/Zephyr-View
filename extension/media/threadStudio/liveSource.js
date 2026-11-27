'use strict';

(() => {
  const host=acquireVsCodeApi();
  const t=(zh,en)=>document.documentElement.lang.startsWith('zh') ? zh : en;
  let state;
  const view=ZephyrSourceRelations.mount({
    nav:document.querySelector('nav'),container:document.querySelector('main'),t,
    onLine:line=>host.postMessage({action:'source',uri:state.uri,version:state.version,line})
  });
  function status_of(next) {
    if (next.issue) {
      const reason=next.issue==='size'?t('文件超过 256 KiB','File exceeds 256 KiB'):
        t('请检查此行附近的括号、引号、注释或条件指令','Check delimiters, literals, comments or conditional directives near this line')+' · L'+next.line;
      return reason+(next.graph?t(' · 保留上次图',' · showing previous diagram'):'');
    }
    return (next.dirty?t('未保存','Unsaved'):t('已保存','Saved'))+t(' · 当前文件静态关系',' · static relationships in this file');
  }
  window.addEventListener('message',({data})=>{
    if (typeof data?.current!=='number') return;
    state=data;
    document.getElementById('name').textContent=state.name;
    const status=document.getElementById('status');
    status.textContent=status_of(state);status.classList.toggle('warning',!!state.issue);
    view.update(state);
  });
  host.postMessage({action:'ready'});
})();
