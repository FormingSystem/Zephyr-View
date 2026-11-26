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
  function accesses(ctx,node) {
    const buttons=[];
    for(const owner of flow.owners(ctx.graph))flow.walk(owner.steps,s=>{
      if(s.object===node.id)buttons.push(action(owner.name+' · '+ctx.api(s.op),()=>ctx.selectStep(s.id)));
    });
    return el('section','vp-uses',el('h3','',ctx.t('访问此对象','Object accesses')),
      buttons.length?el('div','vp-access-list',...buttons):el('small','vp-muted',ctx.t('尚未连接','No connections')));
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
    return el('section','vp-sequence-section',head,items(owner.steps),stepForm(ctx,owner,current));
  }
  function stepForm(ctx,owner,current) {
    const t=ctx.t;
    const s=current?.step;
    const pane=el('div','vp-step-form');
    const target=ctx.graph.objects.find(n=>n.id===(ctx.targetObject||s?.object))||ctx.graph.objects[0];
    const mode=ctx.editing && s?'edit':'add';
    const names=[...flow.instructionKinds,...flow.actions].filter(op=>
      (op!=='call'||ctx.graph.functions?.length) && (!flow.actions.includes(op)||ctx.graph.objects.some(o=>ZephyrProgramModel.operations[o.kind].includes(op))));
    const initial=mode==='edit'?s.op:ctx.targetObject && target?ZephyrProgramModel.operations[target.kind][0]:'print';
    const selectOp=select(t('操作','Operation'),names.map(op=>[op,flow.labels[op]?t(...flow.labels[op]):ctx.api(op)]),initial,()=>fields());
    selectOp.dataset.field='operation';
    if(mode==='edit' && (s.steps?.length || s.elseSteps?.length))selectOp.disabled=true;
    const body=el('div','vp-fields'), slot=el('div','vp-fields'), controls=el('div','vp-tools-group');
    const roots=[['root',t('当前执行块末尾','End of context')]];
    if(s)roots.push(['after',t('所选步骤之后','After selected step')]);
    if(s && ['if','repeat'].includes(s.op))roots.push(['steps',s.op==='repeat'?t('循环体','Loop body'):t('条件成立分支','Then branch')]);
    if(s?.op==='if')roots.push(['elseSteps',t('条件不成立分支','Else branch')]);
    const where=select(t('插入位置','Insert into'),roots,s && !ctx.targetObject?'after':'root',()=>{});
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
  function render(ctx,n) {
    const t=ctx.t;
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
    return el('div','',head,el('strong','vp-identifier',n.name),nodeFields(ctx,n),n.kind?accesses(ctx,n):sequence(ctx,n));
  }
  return {render};
})();
