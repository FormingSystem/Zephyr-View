'use strict';

globalThis.ZephyrProgramAuthoring = (() => {
  const flow = ZephyrProgramFlow;
  const model = ZephyrProgramModel;

  // Endpoint order follows the arrow. A receive executes in the destination context.
  function connection(source, target) {
    if (!source || !target || source.id===target.id) return;
    if (!source.kind && target.role==='function') return {owner:source.id, fields:{op:'call',function:target.id}};
    const outgoing = !source.kind;
    const object = outgoing ? target : source;
    const actor = outgoing ? source : target;
    if (!actor.role || actor.kind || !object.kind) return;
    const op = {msgq:outgoing?'send':'receive', sem:outgoing?'give':'take', mutex:outgoing?'increment':null}[object.kind];
    if (op) return {owner:actor.id, fields:{op,object:object.id}};
  }

  // Each destination is the root list of a context or a branch of one instruction.
  function destinations(graph, ownerId, excludedId) {
    const owner = flow.owners(graph).find(item=>item.id===ownerId);
    if (!owner) return [];
    const blocks = [];
    function collect(steps, key, parent) {
      blocks.push({key,steps,parent});
      for (const step of steps) {
        if (step.id===excludedId) continue;
        for (const branch of flow.children(step)) collect(step[branch]||[],step.id+':'+branch,step);
      }
    }
    collect(owner.steps,'root',null);
    return blocks;
  }

  function block_steps(graph, ownerId, key) {
    if (key==='root') return flow.ownerSteps(graph,ownerId);
    const [id,branch] = key.split(':');
    const match = flow.findStep(graph,id);
    if (!match || match.owner.id!==ownerId || !flow.children(match.step).includes(branch)) return;
    return match.step[branch]||(match.step[branch]=[]);
  }

  function move(graph, stepId, ownerId, key, beforeId) {
    const source = flow.findStep(graph,stepId);
    if (!source || !destinations(graph,ownerId,stepId).some(block=>block.key===key)) return false;
    const list = block_steps(graph,ownerId,key);
    const before = beforeId ? list.find(step=>step.id===beforeId) : null;
    if ((beforeId && !before) || before===source.step) return false;
    source.steps.splice(source.index,1);
    list.splice(before ? list.indexOf(before) : list.length,0,source.step);
    return true;
  }

  function insert(graph, ownerId, currentId, placement, step) {
    const current = currentId && flow.findStep(graph,currentId);
    if (placement==='after' && current?.owner.id===ownerId) current.steps.splice(current.index+1,0,step);
    else {
      const list = block_steps(graph,ownerId,placement==='root'?'root':currentId+':'+placement);
      if (!list) return false;
      list.push(step);
    }
    return true;
  }

  function replacement(step, fields) {
    const {id,x,y} = step;
    const next = {id,...(x==null?{}:{x,y}),...fields};
    for (const key of flow.children(next)) next[key]=step[key]||[];
    return next;
  }

  function removed_children(step, fields) {
    const kept = fields ? flow.children(fields) : [];
    let count=0;
    for (const branch of flow.children(step)) {
      if (!kept.includes(branch)) flow.walk(step[branch],()=>{count++;});
    }
    return count;
  }

  // Validate the result before publishing one document edit. Invalid proposals leave the graph intact.
  function check(graph, mutate) {
    const candidate = structuredClone(graph);
    if (!mutate(candidate)) return {code:'reference',field:'steps'};
    return model.validate(candidate)[0];
  }
  return {connection,destinations,move,insert,replacement,removed_children,check};
})();
