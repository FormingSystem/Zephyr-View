'use strict';

globalThis.ThreadEvidenceView = (() => {
  const {el,button,select,section,details} = ThreadStudioUI;
  function list(title,rows,each,t,expanded=false) {
    const items = el('div','ts-rows');
    let cursor = 0;
    const more = button(t('显示更多','Show more'),append,'ts-more');
    function append() {
      more.remove();
      for (const row of rows.slice(cursor,cursor+24)) items.append(each(row));
      cursor += 24;
      if (cursor < rows.length) items.append(more);
    }
    const group = details(title+' · '+rows.length,items);
    group.open = expanded;
    if (expanded) append();
    else group.addEventListener('toggle', () => { if (group.open && !cursor) append(); });
    return group;
  }

  function source(ctx,row) {
    return button(row.file+':'+row.line,()=>ctx.post({action:'source',id:row.id}),'ts-source');
  }
  function row(ctx, label, entry, note) {
    return el('div','ts-record',el('strong','',label),el('small','',note),entry.conditional ? el('small','',ctx.t('条件编译候选','Conditional source candidate')) : null,source(ctx,entry));
  }
  function analysis(ctx) {
    const {t,state} = ctx;
    const a = state.analysis;
    const scan = button(t('分析当前应用','Analyze application'),()=>ctx.post({action:'analyze'}),'ts-primary');
    scan.disabled = !state.trusted || !state.application;
    const header = el('div','ts-actions',scan,el('small','ts-note',ZephyrPathDisplay.directory(state.application,state.workspace) || t('请先在构建页选择应用。','Select an application under Build first.')));
    if (!a) return el('div','ts-pane',header,el('p','ts-empty',t('扫描应用 C 源码可查看入口、函数调用、并发对象与诊断。','Scan the application C sources to inspect entries, calls, kernel objects and diagnostics.')));
    const coverage = a.coverage || {};
    const origin = coverage.mode === 'compilation-database' ? t('编译数据库内的应用源码','Application sources in compile_commands.json') : t('应用源码候选','Application source candidates');
    const entries = a.threads || [], calls = a.calls || [], objects = a.objects || [], diagnostics = a.diagnostics || [];
    const status = el('p','ts-note',origin+' · '+t('扫描文件 ','Files scanned ')+coverage.scanned+(coverage.partial?' · '+t('部分结果','Partial results'):'')+
      (coverage.omitted?' · '+t('跳过 ','Skipped ')+coverage.omitted:''));
    const summary = section(t('线程入口与直接调用','Thread entries and direct calls'),status);
    if (coverage.databaseIssue) summary.append(el('small','ts-warning',
      t('编译数据库不可用，已按应用源码扫描。','Compilation database unavailable. Scanned application sources instead.')));
    const entry = entries.find(th=>th.id===state.entry) || entries.find(th=>th.entry !== 'main') || entries[0];
    if (entry) {
      summary.append(select(t('线程入口','Thread entry'),entries.map(th=>[th.id,th.name+' · '+th.entry+' · '+th.file+':'+th.line]),entry.id,id=>{
        state.entry=id;state.callPath=[];ctx.draw('ts-entry');
      }));
      summary.lastElementChild.dataset.focus='ts-entry';
      summary.append(row(ctx,entry.entry,entry,[entry.api,entry.stack && t('栈 ','Stack ')+entry.stack,entry.priority && t('优先级 ','Priority ')+entry.priority].filter(Boolean).join(' · ')));
      drawCalls(ctx,summary,a,entry);
    } else summary.append(el('p','ts-note',t('在已扫描文件中未识别线程入口。','No thread entry was recognized in the scanned files.')));
    return el('div','ts-pane',header,summary,
      list(t('并发对象与访问点','Kernel objects and access sites'),objects,o=>objectAccess(ctx,o,a),t),
      list(t('静态诊断','Static diagnostics'),diagnostics,d=>row(ctx,d.message,d,d.rule),t),
      el('p','ts-note',t('扫描保留源码条件与间接调用的不确定性；本页的调用属于源码证据。','Conditional code and indirect calls can remain unresolved. The calls here are source evidence.')));
  }

  function objectAccess(ctx, object, analysis) {
    const {t,state} = ctx;
    const matching = analysis.calls.filter(c=>c.object === object.name);
    function access(call) {
      const item = row(ctx,call.owner+' → '+call.name,call,(call.args || []).join(', '));
      if(call.file !== object.file) item.append(el('small','ts-note',t('跨文件同名候选','Same-name candidate in another file')));
      for (const thread of analysis.threads.filter(th => th.entry===call.owner && th.file===call.file)) {
        item.append(button(t('查看线程 ','View thread ')+thread.name,()=>{
          state.entry=thread.id;state.callPath=[];state.objectId=undefined;ctx.draw('ts-entry');
        },'ts-link'));
      }
      return item;
    }
    const siteList = list(t('按对象名查找的访问点','Access sites matching the object name'),matching,access,t,true);
    return el('div','ts-object',row(ctx,object.name,object,object.api),siteList);
  }
  function drawCalls(ctx,target,a,entry) {
    const {state,t} = ctx;
    const sameFile = a.functions.filter(f=>f.name===entry.entry && f.file===entry.file);
    const candidates = sameFile.length ? sameFile : a.functions.filter(f=>f.name===entry.entry && !f.fileLocal);
    if (candidates.length!==1) {
      target.append(el('p','ts-note',t('入口定义未唯一定位。','A unique entry definition could not be located.')));
      return;
    }
    const path = [candidates[0],...state.callPath];
    const current = path[path.length-1];
    const chain = el('div','ts-path');
    path.forEach((item,index)=>{
      if(index)chain.append(el('span','ts-line','›'));
      chain.append(button(item.name,()=>{state.callPath=path.slice(1,index+1);ctx.draw();},'ts-link'));
    });
    target.append(chain);
    const calls = a.calls.filter(c=>c.ownerId ? c.ownerId===current.id : c.owner===current.name && c.file===current.file);
    const related = calls.filter(c=>c.object).slice(0,24);
    if (related.length) {
      const graph = el('div','ts-relations');
      for (const call of related) {
        const declarations = a.objects.filter(obj=>obj.name===call.object && obj.file===call.file);
        const api = button(call.name,()=>ctx.post({action:'source',id:call.id}),'ts-link');
        const object = declarations.length===1 ? button(call.object,()=>{
          state.objectId=state.objectId===declarations[0].id ? undefined : declarations[0].id;ctx.draw('ts-use-'+call.id);
        },'ts-item') : el('code','',call.object);
        if (declarations.length===1) {
          object.dataset.focus='ts-use-'+call.id;
          object.setAttribute('aria-expanded',String(state.objectId===declarations[0].id));
        }
        graph.append(el('div','ts-relation',el('strong','',current.name),el('span','ts-line','→'),api,el('span','ts-line','→'),object));
      }
      target.append(el('small','ts-file',t('源码中的调用目标与对象参数','Source call targets and object arguments')),graph);
      const selected = a.objects.find(o=>o.id===state.objectId && related.some(c=>c.object===o.name));
      if(selected)target.append(objectAccess(ctx,selected,a));
    }
    const rows = list(t('调用点','Call sites'),calls,call=>{
      const r = row(ctx,call.name,call,(call.args || []).join(', '));
      const local = a.functions.filter(f=>f.name===call.name && f.file===call.file);
      const matches = local.length ? local : a.functions.filter(f=>f.name===call.name && !f.fileLocal);
      if (matches.length===1 && !path.some(f=>f.id===matches[0].id)) r.append(button(t('展开调用','Explore calls'),()=>{state.callPath.push(matches[0]);ctx.draw();},'ts-link'));
      return r;
    },t,true);
    target.append(rows);
  }

  function runtime(ctx) {
    const {state,t} = ctx;
    const d = state.debug || {phase:'disconnected'};
    const send = (op,id) => ctx.post({action:'debug',op,id,token:d.token});
    const phases = {disconnected:t('未连接','Disconnected'),unknown:t('等待暂停状态','Awaiting stop state'),running:t('运行中','Running'),stopped:t('已暂停','Stopped')};
    const caption = ctx.preview ? (d.phase==='stopped' ? t('模拟继续','Simulate resume') : t('模拟暂停','Simulate stop')) : t('启动调试…','Start debugging…');
    const connect = button(caption,()=>ctx.post({action:'launch'}));
    connect.disabled=!state.trusted;
    const toolbar = el('div','ts-actions',el('strong','ts-phase',phases[d.phase]),connect);
    if (d.sessions?.length) toolbar.append(select(t('调试会话','Debug session'),d.sessions.map(s=>[s.id,s.name+' · '+s.type]),d.sessionId,id=>send('session',id)));
    const panel = section(t('调试器报告的调用栈','Debugger call stack'),toolbar);
    if(d.image)panel.append(el('small','ts-file',t('会话镜像','Session image')+' · '+ZephyrPathDisplay.relative(d.image,state.workspace)));
    if(d.error)panel.append(el('p','ts-warning',d.error));
    if(d.phase !== 'stopped') {
      panel.append(el('p','ts-empty',t('在 VS Code 调试器中暂停后，可读取该次暂停的线程、栈帧与变量。','Pause in the VS Code debugger to read threads, frames and variables for that stop.')));
      return panel;
    }
    const read = button(t('读取线程','Read threads'),()=>send('threads'));
    read.disabled=d.busy || !state.trusted;
    panel.append(el('div','ts-actions',read,el('small','ts-note',d.busy?t('读取中…','Reading…'):d.reason || '')));
    const ops = (label,op,id,selected,enabled=true) => {
      const b = button(label,()=>send(op,id),'ts-item');
      b.disabled = d.busy || !enabled || !state.trusted;
      b.setAttribute('aria-pressed',String(selected===id));
      return b;
    };
    if (d.threads?.length) panel.append(section(t('执行上下文','Execution contexts'),el('div','ts-options',...d.threads.map(th=>
      ops(th.name+(th.stopped?'':' · '+phases.running),'stack',th.id,d.threadId,th.stopped)))));
    if (d.frames?.length) panel.append(section(t('栈帧 · 顶帧在前','Frames · top first'),el('ol','ts-frames',...d.frames.map(f=>
      el('li','',ops(f.name,'scopes',f.id,d.frameId),el('small','ts-file',f.path ? ZephyrPathDisplay.relative(f.path,state.application)+':'+f.line : ''))))));
    if (d.scopes?.length) panel.append(section(t('作用域','Scopes'),el('div','ts-options',...d.scopes.map(s=>
      ops(s.name,'variables',s.reference,d.scopeReference,s.reference>0)))));
    if (d.variables?.length) panel.append(section(t('变量值','Variables'),...d.variables.map(v=>{
      const rawType = v.type || '';
      const type = el('span','',rawType.split(/\r?\n/,1)[0]);
      if (type.textContent !== rawType) type.title = rawType;
      return el('div','ts-record',el('code','',v.name),type,el('code','',v.value));
    })));
    if (d.truncated) panel.append(el('small','ts-note',t('适配器结果已截取；完整调试上下文可在原生调试视图查看。','Results were truncated. Inspect more in the native debugger.')));
    return panel;
  }
  return {analysis,runtime};
})();
