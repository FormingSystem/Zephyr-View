'use strict';

const {read_source_buffer} = require('./threadSource');
const max_bytes = 256 * 1024;
const max_relations = 1000;

// Only flip arrows for APIs that explicitly deliver data, a resource or a permit to the caller.
const inbound = new Set(['k_msgq_get','k_msgq_peek','k_msgq_peek_at','k_fifo_get','k_lifo_get','k_queue_get',
  'k_pipe_get','k_pipe_read','k_sem_take','k_stack_pop','k_mem_slab_alloc','k_event_wait','k_event_wait_all',
  'k_event_wait_safe','k_event_wait_all_safe','k_poll_signal_check']);
const outbound = new Set(['k_msgq_put','k_fifo_put','k_lifo_put','k_queue_append','k_queue_prepend',
  'k_pipe_put','k_pipe_write','k_sem_give','k_stack_push','k_event_post','k_event_set','k_poll_signal_raise']);

function node(name,kind,line,conditional=false) { return conditional ? {name,kind,line,conditional} : {name,kind,line}; }

function declaration_index(rows) {
  const by_name = new Map();
  for (const row of rows) by_name.set(row.name, by_name.has(row.name) ? undefined : row);
  return by_name;
}

/** Build per-file static relationships. An unresolved symbol still links to its use site. */
function diagram(records,types) {
  const functions = declaration_index(records.functions), objects = declaration_index(records.objects);
  const owners = new Map(records.functions.map(row=>[row.id,row]));
  const entries = [], calls = [], signals = [];
  let total = 0;
  function relation(group,source,destination,operation,at,direction) {
    total++;
    if (group.length < max_relations) group.push({source,destination,operation,line:at.line,
      conditional:at.conditional,direction,arguments:(at.args || []).join(', ').slice(0,240)});
  }
  for (const thread of records.threads) {
    const entry = functions.get(thread.entry);
    relation(entries,node(thread.name,'thread',thread.line),node(thread.entry,'function',entry?.line || thread.line),
      thread.api,thread,'entry');
  }
  for (const call of records.calls) {
    const fn = owners.get(call.ownerId) || functions.get(call.owner);
    const actor = node(call.owner,'function',fn?.line || call.line);
    const objectName=call.object || call.member;
    if (!objectName) {
      const definition = functions.get(call.name);
      relation(calls,actor,node(call.name,definition ? 'function' : 'reference',definition?.line || call.line),
        call.name,call,'call');
      continue;
    }
    const object = objects.get(objectName);
    const endpoint = node(objectName,object ? 'object' : 'reference',object?.line || call.line);
    const receives = inbound.has(call.name);
    relation(signals, receives ? endpoint : actor, receives ? actor : endpoint, call.name,call,
      receives ? 'in' : outbound.has(call.name) ? 'out' : 'access');
  }
  const symbols = [...types,...records.functions.map(r=>node(r.name,'function',r.line,r.conditional)),
    ...records.objects.map(r=>node(r.name,r.api,r.line,r.conditional))].sort((a,b)=>a.line-b.line);
  return {entries,calls,signals,symbols:symbols.slice(0,max_relations),
    omitted:total-entries.length-calls.length-signals.length+Math.max(0,symbols.length-max_relations)};
}

function inspect_buffer(file, source) {
  if (Buffer.byteLength(source,'utf8') > max_bytes) return {issue:'size'};
  const {records,types,coverage,issue,line} = read_source_buffer(file,source);
  if (issue) return {issue,line};
  return {graph:{...diagram(records,types),coverage}};
}

module.exports = {inspect_buffer,max_bytes};
