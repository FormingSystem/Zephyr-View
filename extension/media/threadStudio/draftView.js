'use strict';

globalThis.ThreadDraftView = function threadDraftView(ctx) {
  const {el, button, select, section, codeBlock, icon} = ThreadStudioUI;
  const {t, state, model} = ctx;
  const choices = {
    msgq: [t('消息队列','Message queue'),t('按顺序传递数据','Pass ordered data')],
    sem: [t('信号量','Semaphore'),t('通知另一线程','Signal another thread')],
    mutex: [t('互斥量','Mutex'),t('保护共享状态','Protect shared state')]
  };
  const role = id => state.draft.kind === 'mutex' ? (id === 'producer' ? t('工作线程 A','Worker A') : t('工作线程 B','Worker B')) : (id === 'producer' ? t('生产线程','Producer') : t('消费线程','Consumer'));
  const stack = t('栈空间','Stack size');
  const priority = t('优先级','Priority');
  const capacity = () => state.draft.kind === 'sem' ? t('计数上限','Count limit') : t('队列深度','Queue depth');
  const title = key => key === 'capacity' ? capacity() : key.endsWith('Stack') ? stack : priority;
  const flow = el('div','ts-diagram');
  const inspector = el('div','ts-inspector');
  const code = codeBlock('');
  const files = ['src/main.c','prj.conf','CMakeLists.txt'];
  const exportButton = button(t('导出示例工程…','Export sample project…'),() => ctx.post({action:'export',draft:{...state.draft}}),'ts-primary');
  const alert = el('div','ts-errors');
  alert.setAttribute('aria-live','polite');

  function chooseKind(kind) {
    if (kind === state.draft.kind) return;
    state.drafts[state.draft.kind] = {...state.draft};
    state.draft = {...model.defaults(kind), ...state.drafts[kind]};
    state.node = 'object';
    ctx.save();
    ctx.draw('ts-kind-' + kind);
  }

  function kindChoice(kind) {
    const node = button('', () => chooseKind(kind), 'ts-choice');
    node.dataset.focus = 'ts-kind-' + kind;
    node.setAttribute('aria-pressed',String(kind === state.draft.kind));
    node.append(icon(kind),el('span','',el('strong','',choices[kind][0]), el('small','',choices[kind][1])));
    return node;
  }

  function inputField(key) {
    const node = el('input','ts-number');
    node.type = 'number';
    const limits = model.limits[key];
    if (limits) [node.min,node.max] = limits;
    node.step = key.endsWith('Stack') ? '8' : '1';
    node.value = Number.isFinite(state.draft[key]) ? state.draft[key] : '';
    node.dataset.key = key;
    node.setAttribute('aria-label', title(key));
    node.addEventListener('input', () => {
      state.draft[key] = node.valueAsNumber;
      ctx.save();
      refresh();
    });
    return el('label','ts-field',el('span','',title(key)),node,
      key.endsWith('Stack') ? el('small','ts-unit','B') : null);
  }

  function drawInspector() {
    const object = state.node === 'object';
    const fields = object ? (state.draft.kind === 'mutex' ? [] : [inputField('capacity')]) :
      [inputField(state.node+'Stack'),inputField(state.node+'Priority')];
    const hints = {
      msgq: t('队列满时，发送方能否继续取决于超时参数。','A full queue can block the sender according to its timeout.'),
      sem: t('初始计数为 0；给出许可以后，等待者才有机会继续。','The initial count is zero. Giving a permit allows a waiter to proceed.'),
      mutex: t('持锁线程独占共享状态，完成访问后应释放锁。','The owner has exclusive access to shared state until it unlocks.')
    };
    inspector.replaceChildren(el('div','ts-inspector-title', el('strong','',object ? choices[state.draft.kind][0] : role(state.node))),
      el('div','ts-fields', ...fields),el('p','ts-note',object ? hints[state.draft.kind] :
        t('此示例的可抢占优先级为 0 到 7，数值较小的线程优先级较高。','This sample has preemptible priorities 0 to 7. Smaller values have higher scheduling priority.')),
      el('div','ts-evidence'));
  }

  function graphNode(id, name, metric) {
    const node = button('',() => {
      state.node = id;
      drawInspector();
      refresh();
      flow.querySelector('[data-node="'+id+'"]')?.focus({preventScroll:true});
    }, 'ts-node');
    node.dataset.node = id;
    node.setAttribute('aria-pressed',String(state.node === id));
    node.append(el('span','ts-node-title',icon(id === 'object' ? state.draft.kind : 'thread'),
      id === 'object' ? choices[state.draft.kind][0] : role(id)),
      el('code','',name),el('small','',metric));
    return node;
  }

  function wire(edge, reverse) {
    const link = el('div','ts-wire'+(reverse ? ' ts-reverse':''),
      el('code','',edge?.api || '…'),el('span','ts-arrow'));
    link.setAttribute('aria-label',edge ? edge.from+' → '+edge.to+' · '+edge.api : '');
    return link;
  }

  function graph(description) {
    if (!description.object) {
      const switchNode = id => button(id === 'object' ? choices[state.draft.kind][0] : role(id),()=>{
        state.node=id; drawInspector(); refresh(); inspector.querySelector('input')?.focus();
      });
      flow.replaceChildren(el('div','ts-empty',t('修正参数后可更新关系图。','Correct the parameters to update the diagram.'),
        el('div','ts-options', ...['producer','object','consumer'].map(switchNode))));
      return;
    }
    const {threads,object,edges} = description;
    const task = th => graphNode(th.id,th.entry,th.stack+' B · '+priority+' '+th.priority);
    const objectMetric = object.capacity !== undefined ? capacity()+' '+object.capacity : t('互斥访问','Exclusive access');
    const edgeFor = id => edges.find(e => e.from === id || e.to === id);
    const [left,right] = [edgeFor('producer'),edgeFor('consumer')];
    flow.replaceChildren(task(threads[0]),wire(left,false),graphNode('object',object.name,objectMetric),wire(right,right?.from === 'consumer'),task(threads[1]));
  }

  function objectContract(object) {
    if (state.draft.kind === 'sem') return t('传递许可 · 无数据载荷','Transfers a permit · no payload');
    const caption = state.draft.kind === 'mutex' ? t('受保护数据','Protected data') : t('消息类型','Message type');
    return caption+' · '+object.payload;
  }

  function renderSource(description, directory) {
    const evidence = inspector.querySelector('.ts-evidence');
    if (!directory) {evidence.replaceChildren(); code.firstChild.textContent=''; return;}
    const thread = description.threads.find(row => row.id === state.node);
    const owner = thread || description.object;
    const lines = directory['src/main.c'].split('\n');
    const registration = thread?.registrationLine;
    const rows = thread ? [registration,registration+1,...(state.draft.creation==='dynamic'?[registration+2]:[]),...thread.calls.map(call=>call.line)] : [owner.line];
    const links = [...new Set(rows)].map(n => el('div','ts-excerpt',el('span','ts-line',String(n)),el('code','',lines[n-1]?.trim() || '')));
    const contract = thread ? null : el('small','ts-contract', objectContract(owner));
    evidence.replaceChildren(...[contract,el('small','ts-file','src/main.c'),...links].filter(Boolean));
    code.firstChild.textContent = directory[state.file];
  }

  function refresh() {
    const result = model.describe(state.draft);
    const issues = result.diagnostics;
    const bad = new Set(issues.map(item=>item.field));
    inspector.querySelectorAll('[data-key]').forEach(node => node.setAttribute('aria-invalid',String(bad.has(node.dataset.key))));
    const messages = issues.map(issue => {
      const caption = title(issue.field);
      const name = issue.field.startsWith('producer') ? role('producer') : issue.field.startsWith('consumer') ? role('consumer') : '';
      const limits = model.limits[issue.field];
      const fix = issue.code === 'alignment' ? t('请输入 8 的整数倍。','Enter a multiple of 8.') :
        limits ? t('请输入范围内的整数','Enter an integer in range')+' '+limits.join('–') : t('请检查此项。','Check this value.');
      return el('p','',name+' '+caption+' · '+fix);
    });
    alert.replaceChildren(...messages);
    exportButton.disabled = Boolean(issues.length) || !state.trusted;
    graph(result);
    renderSource(result,issues.length ? null : model.generate(state.draft));
  }

  const types = el('div','ts-choices', ...model.kinds.map(kindChoice));
  const creation = select(t('线程创建方式','Thread creation'),[
    ['static',t('静态定义 · K_THREAD_DEFINE','Static definition · K_THREAD_DEFINE')],
    ['dynamic',t('运行时创建 · k_thread_create','Create at run time · k_thread_create')]
  ],state.draft.creation || 'static',value=>{
    state.draft.creation=value; ctx.save(); refresh();
  });
  const creationField = el('label','ts-creation',el('span','',t('线程创建方式','Thread creation')),creation);
  const picker = select(t('预览文件','Preview file'),files.map(file=>[file,file]),state.file,value=>{
    state.file=value;
    refresh();
  });
  drawInspector();
  refresh();
  const tree = section(t('线程关系','Thread relationships'),flow,inspector);
  const details = el('details','ts-details',el('summary','',t('生成的工程文件','Generated project files')),picker,code);
  const actions = el('div','ts-actions',exportButton);
  return el('div','ts-pane',section(t('选择并发组件','Choose a concurrency component'),types,creationField),tree,alert,details,actions);
};
