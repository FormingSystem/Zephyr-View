'use strict';

(() => {
  const {el,button} = ThreadStudioUI;
  const host = acquireVsCodeApi();
  const t = (zh,en) => document.documentElement.lang.startsWith('zh') ? zh : en;
  const labels = {signals:t('信号流','Signals'),calls:t('函数调用','Calls'),entries:t('线程入口','Entries'),symbols:t('声明','Declarations')};
  const kinds = {function:t('函数','Function'),thread:t('线程','Thread'),object:t('内核对象','Kernel object'),reference:t('使用位置','Use site')};
  const directions = {in:t('接收','Receive'),out:t('发送','Send'),access:t('访问','Access'),call:t('调用','Call'),entry:t('入口','Entry')};
  let state, mode, limit = 40;
  const expanded_types = new Set();
  const container = document.querySelector('main'), nav = document.querySelector('nav');

  function source_button(label,line,class_name) {
    const item = button(label,()=>host.postMessage({action:'source',uri:state.uri,version:state.version,line}),class_name);
    item.disabled = state.current!==state.version;
    item.title = t('转到源码第 ','Go to source line ')+line;
    return item;
  }

  function symbol(item) {
    const node = source_button('',item.line,'node');
    node.append(el('strong','',item.name),el('small','', (kinds[item.kind] || item.kind)+' · L'+item.line));
    return node;
  }

  function declaration(item) {
    if (!item.count) return symbol(item);
    const key=item.kind+' '+item.name;
    const summary=el('summary','',key+' · '+item.count);
    const group=el('details','type',summary);
    group.open=expanded_types.has(key);
    group.addEventListener('toggle',()=>{
      if (!group.isConnected) return;
      if (group.open) expanded_types.add(key); else expanded_types.delete(key);
    });
    if (group.open) summary.setAttribute('aria-label',key);
    group.append(symbol(item),...item.members.map(member=>source_button(member.name,member.line,'member')));
    if (item.count>item.members.length) group.append(el('small','',t('更多成员见源码','Open the declaration for remaining members.')));
    return group;
  }

  function relation(row) {
    const via = source_button('',row.line,'via');
    const caption = directions[row.direction]+(row.conditional ? t(' · 条件编译',' · conditional') : '');
    via.append(el('small','',caption),el('code','',row.operation));
    if (row.arguments) via.title += '\n'+row.operation+'('+row.arguments+')';
    const edge = el('div','relation',symbol(row.source),via,symbol(row.destination));
    edge.dataset.direction=row.direction;
    return edge;
  }

  function draw() {
    const graph=state.graph;
    nav.hidden=!graph;
    if (!graph) {container.replaceChildren();nav.replaceChildren();return;}
    const active=document.activeElement?.dataset?.mode;
    const tabs = Object.entries(labels).map(([key,title])=>{
      const tab=button(title+' · '+graph[key].length,()=>{mode=key; limit=40; draw();});
      tab.dataset.mode=key;tab.setAttribute('aria-pressed',String(key===mode));return tab;
    });
    nav.replaceChildren(...tabs);
    if (active) tabs.find(tab=>tab.dataset.mode===active)?.focus();
    const rows=graph[mode], end=Math.min(limit,rows.length);
    const items=rows.slice(0,end).map(mode==='symbols'?declaration:relation);
    if (!items.length) items.push(el('p','empty',t('当前文件未识别到此类关系。','No matching relationships in this file.')));
    if (end<rows.length) items.push(button(t('显示更多','Show more'),()=>{limit+=40;draw();},'more'));
    if (graph.omitted) items.push(el('small','',t('已省略 ','Omitted ')+graph.omitted+t(' 项。',' items.')));
    container.replaceChildren(...items);
  }

  function status_of(next) {
    if (next.issue) {
      const reason=next.issue==='size'?t('文件超过 256 KiB','File exceeds 256 KiB'):
        t('括号、引号、注释或条件指令尚未闭合','Unclosed delimiter, literal, comment or conditional')+' · L'+next.line;
      return reason+(next.graph?t(' · 保留上次图',' · showing previous diagram'):'');
    }
    return (next.dirty?t('未保存','Unsaved'):t('已保存','Saved'))+t(' · 当前文件静态关系',' · static relationships in this file');
  }

  window.addEventListener('message',({data})=>{
    if (typeof data?.current!=='number') return;
    if (!mode || state?.uri!==data.uri || !state?.graph) {
      expanded_types.clear();
      mode=Object.keys(labels).find(key=>data.graph?.[key].length) || 'signals';
      limit=40;
    }
    state=data;
    document.getElementById('name').textContent=state.name;
    const status=document.getElementById('status');
    status.textContent=status_of(state);status.classList.toggle('warning',!!state.issue);
    draw();
  });
  host.postMessage({action:'ready'});
})();
