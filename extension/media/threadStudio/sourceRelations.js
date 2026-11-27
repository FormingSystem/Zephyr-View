'use strict';

globalThis.ZephyrSourceRelations = (() => {
  const {el,button} = ThreadStudioUI;

  /** Render the current document's lexical index and locate selected lines in the owning editor. */
  function mount({nav,container,t,onLine,onExportClassDiagram}) {
    nav.classList.add('zv-source-tabs');
    container.classList.add('zv-source-relations');
    const tabs = {signals:t('信号流','Signals'),calls:t('函数调用','Calls'),entries:t('线程入口','Entries'),symbols:t('声明','Declarations'),class_diagram:t('UML 类图','UML classes')};
    const kinds = {function:t('函数','Function'),thread:t('线程','Thread'),object:t('内核对象','Kernel object'),reference:t('使用位置','Use site')};
    const directions = {in:t('接收','Receive'),out:t('发送','Send'),access:t('访问','Access'),call:t('调用','Call'),entry:t('入口','Entry')};
    const expanded = new Set();
    let state,mode,uml,limit=40;

    function source_link(label,line,css) {
      const control=button(label,()=>onLine(line),css);
      control.disabled=!!state.issue || state.current!==state.version;
      control.title=t('转到源码第 ','Go to source line ')+line;
      return control;
    }
    function symbol(item) {
      const node=source_link('',item.line,'node');
      const kind=kinds[item.kind] || item.kind;
      node.append(el('strong','',item.name),el('small','',kind+' · L'+item.line));
      if (item.signature) node.title+='\n'+item.signature;
      return node;
    }
    function declaration(item) {
      const conditional=item.conditional ? t(' · 条件编译',' · conditional') : '';
      if (!item.count) {
        const control=item.kind ? symbol(item) : source_link(item.name,item.line,'member');
        if (conditional) control.append(el('small','',conditional));
        return control;
      }
      const key=item.kind+' '+item.name+' · L'+item.line;
      const summary=el('summary','',item.name+' · '+item.count+conditional);
      const group=el('details','type',summary);
      group.open=expanded.has(key);
      group.addEventListener('toggle',()=>{
        if (!group.isConnected) return;
        if (group.open) expanded.add(key); else expanded.delete(key);
      });
      group.append(symbol(item),...item.members.map(declaration));
      if (item.count>item.members.length) group.append(el('small','',t('更多成员见源码','Open the declaration for remaining members.')));
      return group;
    }
    function relation(row) {
      const via=source_link('',row.line,'via');
      const caption=directions[row.direction]+(row.conditional ? t(' · 条件编译',' · conditional') : '');
      via.append(el('small','',caption),el('code','',row.operation));
      if (row.arguments) via.title+='\n'+row.operation+'('+row.arguments+')';
      const edge=el('div','relation',symbol(row.source),via,symbol(row.destination));
      edge.dataset.direction=row.direction;
      return edge;
    }
    function draw() {
      const graph=state.graph;
      if (mode!=='class_diagram' || !graph) {uml?.dispose();uml=undefined;}
      nav.hidden=!graph;
      if (!graph) {container.replaceChildren();nav.replaceChildren();return;}
      const active=nav.contains(document.activeElement) && document.activeElement?.dataset.mode;
      const controls=Object.entries(tabs).map(([id,title])=>{
        const count=id==='class_diagram' ? graph.class_diagram?.nodes.length || 0 : graph[id].length;
        const control=button(title+' · '+count,()=>{mode=id;limit=40;draw();});
        control.dataset.mode=id;control.setAttribute('aria-pressed',String(id===mode));return control;
      });
      nav.replaceChildren(...controls);
      if (active) controls.find(control=>control.dataset.mode===active)?.focus();
      if (mode==='class_diagram') {
        if (!uml) {
          uml=ZephyrClassDiagram.mount({t,onLine,onExportClassDiagram});
          container.replaceChildren(uml.root);
        }
        uml.update(graph.class_diagram || {nodes:[],edges:[]},Boolean(state.issue) || state.current!==state.version,state.uri,state.version);
        return;
      }
      const items=graph[mode].slice(0,limit).map(mode==='symbols' ? declaration : relation);
      if (!items.length) items.push(el('p','empty',t('当前文件未识别到此类关系。','No matching relationships in this file.')));
      if (limit<graph[mode].length) items.push(button(t('显示更多','Show more'),()=>{limit+=40;draw();},'more'));
      if (graph.omitted) items.push(el('small','',t('已省略 ','Omitted ')+graph.omitted+t(' 项。',' items.')));
      if (graph.coverage?.opaqueMacros) items.push(el('small','',t('未展开的宏调用：','Unexpanded macro calls: ')+graph.coverage.opaqueMacros));
      if (graph.coverage?.branchProjection) items.push(el('small','',t('互斥分支共用定界符，仅展示一组候选分支。','Conditional alternatives share delimiters. Showing one candidate branch selection.')));
      container.replaceChildren(...items);
    }
    function update(next) {
      if (!mode || state?.uri!==next.uri || !state.graph) {
        expanded.clear();
        mode=Object.keys(tabs).find(id=>next.graph?.[id]?.length) || 'signals';limit=40;
      }
      state=next;draw();
    }
    return {update};
  }
  return {mount};
})();
