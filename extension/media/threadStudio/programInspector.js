'use strict';

globalThis.ZephyrProgramInspector=(()=>{
  const {el,button,select}=ThreadStudioUI,flow=ZephyrProgramFlow;
  const field=(title,control)=>el('label','vp-field',el('span','',title),control);
  function input(value,label,key,update,numeric=false) {
    const control=el('input','');
    control.type=numeric?'number':'text';control.value=value??'';control.dataset.field=key;
    control.setAttribute('aria-label',label);
    control.addEventListener('input',()=>update(numeric && control.value!==''?control.valueAsNumber:control.value));
    return field(label,control);
  }
  function action(label,run,title=label) {
    const b=button(label,run,'vp-action');
    b.setAttribute('aria-label',title);b.title=title;return b;
  }
  function nodeFields(ctx,n) {
    const t=ctx.t;
    const edit=(key,label,num=false,value=n[key])=>input(value,label,key,v=>ctx.editNode(n.id,{[key]:v},true),num);
    const fields=n.id===flow.mainId?[]:[edit('name',t('C 标识符','C identifier'))];
    if(n.role==='thread')fields.push(edit('stack',t('栈大小 (B)','Stack (B)'),true),edit('priority',t('优先级','Priority'),true),edit('initialValue',t('初始数值','Initial value'),true,n.initialValue??42));
    if(n.kind && n.kind!=='mutex')fields.push(edit('capacity',n.kind==='sem'?t('计数上限','Count limit'):t('队列容量','Queue capacity'),true));
    return el('div','vp-fields',...fields);
  }
  function moveForm(ctx,current) {
    const t=ctx.t, graph=ctx.graph;
    const details=el('details','vp-step-form',el('summary','',t('移动所选步骤…','Move selected step…')));
    details.addEventListener('toggle',()=>{
      if(!details.open || details.children.length>1)return;
      const destinations=el('div','vp-fields');
      const owner=select(t('目标执行上下文','Destination context'),flow.owners(graph).map(n=>[n.id,n.name]),current.owner.id,renderBlocks);
      owner.dataset.field='moveOwner';
      function renderBlocks(){
        const blocks=ZephyrProgramAuthoring.destinations(graph,owner.value,current.step.id);
        const entries=blocks.map(b=>[b.key,blockLabel(ctx,b)]);
        const currentBlock=blocks.find(b=>b.steps===current.steps);
        const block=select(t('目标执行块','Destination block'),entries,currentBlock?.key||'root',renderPosition);
        block.dataset.field='moveBlock';
        const position=el('div','vp-fields');
        function renderPosition(){
          const steps=blocks.find(b=>b.key===block.value).steps.filter(s=>s.id!==current.step.id);
          const choices=[['',t('块末尾','End of block')],...steps.map(s=>[s.id,t('在此之前 · ','Before · ')+flow.describeStep(graph,s,ctx.api,t).filter(Boolean).join(' · ')+' ['+s.id+']'])];
          const before=select(t('放置位置','Position'),choices,'',()=>{});
          before.dataset.field='moveBefore';
          const apply=action(t('移动步骤','Move step'),()=>ctx.moveStep(current.step.id,owner.value,block.value,before.value));
          apply.dataset.action='moveStep';
          position.replaceChildren(field(t('放置位置','Position'),before),apply);
        }
        renderPosition();
        destinations.replaceChildren(field(t('目标执行块','Destination block'),block),position);
      }
      renderBlocks();
      details.append(field(t('目标执行上下文','Destination context'),owner),destinations);
    });
    return details;
  }
  function blockLabel(ctx,block){
    const t=ctx.t;
    if(!block.parent)return t('顶层','Top level');
    const branch=block.key.endsWith(':elseSteps')?t('条件不成立','Else'):
      block.parent.op==='repeat'?t('循环体','Loop body'):t('条件成立','Then');
    const name=flow.describeStep(ctx.graph,block.parent,ctx.api,t).join(' · ');
    return name+' ['+block.parent.id+'] → '+branch;
  }
  function connectionPreview(ctx){
    const {from,to,proposal}=ctx.connecting,t=ctx.t;
    const source=flow.node(ctx.graph,from),target=flow.node(ctx.graph,to),owner=flow.node(ctx.graph,proposal.owner);
    const op=proposal.fields.op;
    const operation=flow.labels[op]?t(...flow.labels[op]):ctx.api(op);
    const confirm=action(t('确认连接','Confirm connection'),()=>ctx.addStep(owner.id,null,'root',proposal.fields));
    const cancel=action(t('取消','Cancel'),()=>ctx.cancelConnection());
    confirm.dataset.action='confirmConnection';cancel.dataset.action='cancelConnection';
    return el('section','vp-connection-preview',el('h2','',t('连接预览','Connection preview')),
      el('p','vp-identifier',source.name+' → '+target.name),
      el('p','',el('code','',operation),' · '+t('添加到执行块末尾','Append to context')+' · '+owner.name),
      el('div','vp-tools-group',confirm,cancel));
  }
  function sequence(ctx,owner) {
    const t=ctx.t;
    function items(steps,depth=0) {
      const list=el('ol','vp-sequence');
      for(const s of steps||[]){
        const [name,tail]=flow.describeStep(ctx.graph,s,ctx.api,t);
        const row=el('li','vp-step'+(ctx.stepId===s.id?' active':''));
        const pick=action(name+(tail?' · '+tail:''),()=>ctx.selectStep(s.id));pick.className='vp-step-label';
        row.append(pick);
        if(depth<16 && flow.children(s).includes('steps') && s.steps?.length)row.append(items(s.steps,depth+1));
        if(depth<16 && s.op==='if' && s.elseSteps?.length)row.append(el('small','vp-muted','else'),items(s.elseSteps,depth+1));
        list.append(row);
      }
      return list;
    }
    const head=el('div','vp-subhead',el('h3','',t('执行顺序','Operation order')));
    const current=flow.findStep(ctx.graph,ctx.stepId);
    if(current) {
      const controls=el('div','vp-tools-group');
      for(const [symbol,title,delta] of [['↑',t('上移操作','Move up'),-1],['↓',t('下移操作','Move down'),1]]){
        const b=action(symbol,()=>ctx.reorder(current,delta),title);
        b.disabled=current.index+delta<0 || current.index+delta>=current.steps.length;
        controls.append(b);
      }
      controls.append(action('×',()=>ctx.removeStep(current),t('删除选中操作及子步骤','Remove selected operation and nested steps')));
      head.append(controls);
    }
    return el('section','vp-sequence-section',head,items(owner.steps),current?moveForm(ctx,current):null,stepForm(ctx,owner,current));
  }
  function stepForm(ctx,owner,current) {
    const t=ctx.t;
    const s=current?.step;
    const pane=el('div','vp-step-form');
    const target=ctx.graph.objects.find(n=>n.id===s?.object)||ctx.graph.objects[0];
    const mode=ctx.editing && s?'edit':'add';
    const names=[...flow.instructionKinds,...flow.actions].filter(op=>
      (op!=='call'||ctx.graph.functions?.length) && (!flow.actions.includes(op)||ctx.graph.objects.some(o=>ZephyrProgramModel.operations[o.kind].includes(op))));
    const initial=mode==='edit'?s.op:'print';
    const selectOp=select(t('操作','Operation'),names.map(op=>[op,flow.labels[op]?t(...flow.labels[op]):ctx.api(op)]),initial,()=>fields());
    selectOp.dataset.field='operation';
    const body=el('div','vp-fields'), slot=el('div','vp-fields'), controls=el('div','vp-tools-group');
    const roots=[['root',t('当前执行块末尾','End of context')]];
    if(s)roots.push(['after',t('所选步骤之后','After selected step')]);
    if(s && ['if','repeat'].includes(s.op))roots.push(['steps',s.op==='repeat'?t('循环体','Loop body'):t('条件成立分支','Then branch')]);
    if(s?.op==='if')roots.push(['elseSteps',t('条件不成立分支','Else branch')]);
    const where=select(t('插入位置','Insert into'),roots,s?'after':'root',()=>{});
    where.dataset.field='placement';
    let read;
    function fields(){
      const op=selectOp.value;
      const same=s?.op===op && mode==='edit';
      body.replaceChildren();
      const ports=flow.ports(op,t);
      if(ports)body.append(el('div','vp-ports',
        el('span','',el('small','',t('输入','Input')),ports[0]),
        el('span','',el('small','',t('输出','Output')),ports[1])));
      if(flow.actions.includes(op)){
        const choices=ctx.graph.objects.filter(o=>ZephyrProgramModel.operations[o.kind].includes(op));
        const pick=select(t('对象','Object'),choices.map(n=>[n.id,n.name]),choices.find(n=>n.id===target?.id)?.id||choices[0]?.id,()=>{});
        pick.dataset.field='target';body.append(field(t('对象','Object'),pick));
        read=()=>({object:pick.value});
      }else if(op==='call'){
        const funcs=ctx.graph.functions||[];
        const pick=select(t('函数','Function'),funcs.map(n=>[n.id,n.name]),same?s.function:funcs[0]?.id,()=>{});
        pick.dataset.field='function';body.append(field(t('函数','Function'),pick));
        read=()=>({function:pick.value});
      }else if(op==='external'){
        const hook=el('input','');hook.dataset.field='hook';hook.value=same?s.symbol:'read_sensor';
        body.append(field(t('驱动函数名称','Driver hook name'),hook)); read=()=>({symbol:hook.value});
      }else if(op==='print')read=()=>({});
      else {
        const key=op==='repeat'?'count':'value';
        const control=el('input',''); control.type='number';control.dataset.field='operand';
        control.value=same?s[key]:op==='delay'?100:1;
        const label=op==='repeat'?t('次数','Count'):op==='delay'?t('毫秒','Milliseconds'):t('常量','Operand');
        let test;
        if(op==='if'){
          test=select(t('条件','Condition'),Object.entries({eq:'==',ne:'!=',lt:'<',le:'<=',gt:'>',ge:'>='}),same?s.test:'eq',()=>{});
          test.dataset.field='test';body.append(field(t('比较 value','Compare value'),test));
        }
        body.append(field(label,control));
        read=()=>({[key]:control.value===''?'':control.valueAsNumber,...(test?{test:test.value,elseSteps:same?s.elseSteps:[]}:{}),
          ...(['if','repeat'].includes(op)?{steps:same?s.steps:[]}: {})});
      }
    }
    fields();
    const submit=action(mode==='edit'?t('应用修改','Apply change'):t('添加操作','Add operation'),()=>{
      const step={op:selectOp.value,...read()};
      if(mode==='edit')ctx.updateStep(current,step);else ctx.addStep(owner.id,current,where.value,step);
    });submit.dataset.action=mode==='edit'?'updateStep':'addStep';
    controls.append(submit);
    if(s)controls.append(action(mode==='edit'?t('切换为新增','Add another'):t('修改所选操作','Edit selected'),()=>{ctx.editing=!ctx.editing;ctx.refresh();}));
    if(mode==='add')slot.append(field(t('插入位置','Insert into'),where));
    pane.append(field(t('接口或指令','API or instruction'),selectOp),body,slot,controls);
    return pane;
  }
  function confirmStepChange(ctx) {
    const {step,count,fields}=ctx.pendingStep,t=ctx.t;
    const confirm=action(fields?t('更改并移除子步骤','Change and remove nested steps'):t('删除步骤及子步骤','Delete step and nested steps'),()=>ctx.finishStepChange(true));
    const cancel=action(t('取消','Cancel'),()=>ctx.finishStepChange(false));
    confirm.dataset.action='confirmStepChange';cancel.dataset.action='cancelStepChange';
    const [name]=flow.describeStep(ctx.graph,step,ctx.api,t);
    const next=fields && flow.describeStep(ctx.graph,fields,ctx.api,t)[0];
    const message=fields?t('更改为 ','Changing to ')+next+t(' 将移除 ',' will remove '):t('删除所选操作还将移除 ','Deleting this operation will also remove ');
    return el('section','',el('h2','',name+' ['+step.id+']'),el('p','vp-confirm',message+count+t(' 个子步骤。',count===1?' nested step.':' nested steps.')),
      el('div','vp-tools-group',cancel,confirm));
  }
  function render(ctx,n) {
    const t=ctx.t;
    if(ctx.connecting?.proposal)return connectionPreview(ctx);
    if(ctx.pendingStep)return confirmStepChange(ctx);
    if(!n)return el('div','vp-none',t('选择节点查看配置。','Select a node to inspect it.'));
    const removable=n.id!==flow.mainId;
    const head=el('div','vp-inspector-head',el('h2','',t('节点配置','Inspector')));
    if(removable){
      const remove=action(t('删除节点','Delete node'),()=>ctx.askDelete(n.id));remove.dataset.action='deleteNode';head.append(remove);
    }
    if(ctx.deleting===n.id){
      const confirm=action(t('确认删除','Confirm delete'),()=>ctx.removeNode(n.id));confirm.dataset.action='confirmDelete';
      return el('div','',head,el('p','vp-confirm',t('同时删除此节点内的步骤和引用它的操作。','This removes nested steps and operations that reference this node.')),
        confirm,action(t('取消','Cancel'),()=>ctx.askDelete(null)));
    }
    return el('div','',head,el('strong','vp-identifier',n.name),nodeFields(ctx,n),n.kind?null:sequence(ctx,n));
  }
  return {render};
})();
