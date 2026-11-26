'use strict';

globalThis.ZephyrProgramFlow=(()=>{
  const mainId='$main';
  const branches=['steps','elseSteps'];
  const actions=['send','receive','give','take','increment'];
  const instructionKinds=['set','add','subtract','multiply','bit_and','bit_or','bit_xor','shift_left','shift_right','delay','print','call','external','if','repeat'];
  const labels={set:['赋值','Set value'],add:['加','Add'],subtract:['减','Subtract'],multiply:['乘','Multiply'],
    bit_and:['按位与','Bitwise AND'],bit_or:['按位或','Bitwise OR'],bit_xor:['按位异或','Bitwise XOR'],
    shift_left:['左移','Shift left'],shift_right:['右移','Shift right'],delay:['延时','Delay'],print:['输出','Print'],call:['调用函数','Call function'],external:['调用驱动接口','Call driver hook'],if:['条件分支','If / else'],repeat:['循环','Repeat']};
  function owners(graph){
    return [{id:mainId,name:'main',role:'main',steps:graph.mainSteps||[],x:graph.layout?.main?.x,y:graph.layout?.main?.y},
      ...graph.threads.map(n=>({...n,role:'thread'})),...(graph.functions||[]).map(n=>({...n,role:'function'}))];
  }
  function children(step) {
    if(step.op==='if')return branches;
    return step.op==='repeat'?['steps']:[];
  }
  function walk(steps,fn,depth=0) {
    if(depth>16 || !Array.isArray(steps))return;
    steps.forEach((step,index)=>{
      if(!step)return;
      fn(step,steps,index,depth);
      for(const key of children(step))walk(step[key],fn,depth+1);
    });
  }
  function findStep(graph,id) {
    for(const owner of owners(graph)) {
      let match;
      walk(owner.steps,(step,steps,index)=>{if(step.id===id)match={owner,step,steps,index};});
      if(match)return match;
    }
  }
  function node(graph,id){return owners(graph).find(n=>n.id===id)||graph.objects.find(n=>n.id===id);}
  function reference(graph,id){return [...graph.threads,...graph.objects,...(graph.functions||[])].find(n=>n.id===id);}
  function ownerSteps(graph,id){
    if(id===mainId)return graph.mainSteps||(graph.mainSteps=[]);
    return reference(graph,id)?.steps;
  }
  function describeStep(graph,s,api,t) {
    const target=s.object?graph.objects.find(o=>o.id===s.object)?.name:s.function?graph.functions?.find(f=>f.id===s.function)?.name:'';
    if(actions.includes(s.op))return [api(s.op),target||s.object];
    const label=Object.hasOwn(labels,s.op)?t(...labels[s.op]):s.op;
    const operand=typeof s.value==='object' && s.value!==null ? ZephyrProgramModel.operand_text(graph,s.value) : s.value;
    if(s.op==='if')return [label,'value '+({eq:'==',ne:'!=',lt:'<',le:'<=',gt:'>',ge:'>='}[s.test]||'?')+' '+operand];
    if(s.op==='repeat')return [label,'× '+s.count];
    if(s.op==='external')return [label,s.symbol];
    if(s.op==='call')return [label,target||s.function];
    if(s.op==='print')return [label,'printk(value)'];
    return [label,s.op==='delay'?s.value+' ms':'value '+({set:'=',add:'+=',subtract:'−=',multiply:'×=',bit_and:'&=',bit_or:'|=',bit_xor:'^=',shift_left:'<<=',shift_right:'>>='}[s.op]||'')+' '+operand];
  }
  function ports(op,t){
    const portsByOp={
      send:[t('局部 value','Local value'),t('消息队列','Message queue')],
      receive:[t('消息队列','Message queue'),t('局部 value','Local value')],
      give:[t('释放一次','Give once'),t('信号量计数','Semaphore count')],
      take:[t('信号量许可','Semaphore permit'),t('继续执行','Continue')],
      increment:[t('受互斥量保护的计数','Mutex-protected count'),t('更新后的计数','Updated count')],
      call:['value',t('返回值 → value','Return → value')],external:['value',t('驱动返回值 → value','Driver return → value')],
      print:['value',t('控制台','Console')],set:[t('常量','Constant'),'value'],
      if:[t('value 与常量','Value and operand'),t('条件成立或不成立','Then or else')],
      repeat:[t('循环次数','Count'),t('循环体或后续步骤','Loop body or next step')],
      delay:[t('毫秒','Milliseconds'),t('延时结束后继续','Continue after delay')]
    };
    if(['add','subtract','multiply','bit_and','bit_or','bit_xor','shift_left','shift_right'].includes(op))return [t('value 与常量','Value and operand'),t('更新后的 value','Updated value')];
    return Object.hasOwn(portsByOp,op)?portsByOp[op]:null;
  }
  function architecture(graph,t) {
    const contexts=owners(graph);
    const root={id:'$program',name:graph.name,role:'program',x:graph.layout?.program?.x,y:graph.layout?.program?.y};
    const nodes=[root,...contexts,...graph.objects],edges=[{id:'@main',from:root.id,to:mainId,kind:'control',label:t('入口','Entry'),thread:mainId}];
    const known=new Map(nodes.map(n=>[n.id,n]));
    for(const o of contexts) {
      if(o.role==='thread')edges.push({id:'@'+o.id,from:graph.creation==='dynamic'?mainId:root.id,to:o.id,kind:'control',label:graph.creation==='dynamic'?'k_thread_create':t('静态定义','Static definition'),thread:o.id});
      walk(o.steps,s=>{
        const obj=known.get(s.object), fn=known.get(s.function);
        if(obj) {
          const input=['take','receive'].includes(s.op);
          edges.push({id:s.id,from:input?obj.id:o.id,to:input?o.id:obj.id,kind:obj.kind,step:s,thread:o.id});
        }else if(s.op==='call' && fn)edges.push({id:s.id,from:o.id,to:fn.id,kind:'call',step:s,thread:o.id});
      });
    }
    return {nodes,edges};
  }
  function flow(graph,owner,api,t) {
    const nodes=[owner],edges=[];
    function connect(from,to,label,kind='control',branch) {
      edges.push({id:'@'+edges.length,from,to,label,kind,branch,stepId:to,thread:owner.id});
    }
    function sequence(steps,incoming,depth) {
      if(depth>16)return incoming;
      let ends=incoming;
      for(const s of steps||[]) {
        const [name,metric]=describeStep(graph,s,api,t);
        nodes.push({...s,role:'instruction',name,metric});
        for(const end of ends)connect(end.id,s.id,end.label,'control',end.branch);
        ends=[{id:s.id}];
        if(s.op==='if'){
          ends=sequence(s.steps,[{id:s.id,label:t('是','Yes'),branch:'if-then'}],depth+1)
            .concat(sequence(s.elseSteps,[{id:s.id,label:t('否','No'),branch:'if-else'}],depth+1));
        }
        if(s.op==='repeat'){
          const body=sequence(s.steps,[{id:s.id,label:t('循环体','Body')}],depth+1);
          for(const end of body)if(end.id!==s.id)connect(end.id,s.id,t('迭代','Next'),'call');
          ends=[{id:s.id,label:t('完成','Done')}];
        }
      }
      return ends;
    }
    sequence(owner.steps,[{id:owner.id}],0);
    return {nodes,edges};
  }
  return {mainId,actions,ports,children,instructionKinds,labels,owners,node,reference,walk,findStep,ownerSteps,architecture,flow,describeStep};
})();
