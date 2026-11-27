'use strict';

const {source_types,skip_decorations} = require('./liveSourceTypes');
const {source_class_diagram} = require('./sourceClassDiagram');
const {SourcePreprocessor,header_guard} = require('./sourcePreprocessor');

const identifier = /^[A-Za-z_]\w*$/;
const definitions = new Set(['K_SEM_DEFINE','K_MUTEX_DEFINE','K_MSGQ_DEFINE','K_FIFO_DEFINE','K_LIFO_DEFINE',
  'K_EVENT_DEFINE','K_TIMER_DEFINE','K_WORK_DEFINE','K_WORK_DELAYABLE_DEFINE','K_WORK_USER_DEFINE',
  'K_PIPE_DEFINE','K_MEM_SLAB_DEFINE','K_CONDVAR_DEFINE','K_QUEUE_DEFINE','K_STACK_DEFINE']);
const keywords = new Set(['if','else','for','while','do','return','switch','sizeof','_Alignof','_Static_assert',
  'typeof','__typeof__','__attribute__','case','alignof','static_assert']);
const objectCall = /^k_(?:sem|mutex|msgq|fifo|lifo|queue|timer|event|work|poll_signal|condvar|pipe|mem_slab|stack)_/;
const timeoutArg = new Map(Object.entries({k_sem_take:1,k_mutex_lock:1,k_msgq_put:2,k_msgq_get:2,
  k_fifo_get:1,k_lifo_get:1,k_queue_get:1,k_mem_slab_alloc:2,k_event_wait:3,k_event_wait_all:3}));
const kernel_structs=new Set(['k_sem','k_mutex','k_msgq','k_fifo','k_lifo','k_queue','k_timer','k_event',
  'k_work','k_work_delayable','k_work_user','k_poll_signal','k_condvar','k_pipe','k_mem_slab','k_stack']);
const declared_macro_apis=new Set([...definitions,'K_THREAD_DEFINE','ISR_DIRECT_DECLARE','IRQ_CONNECT','IRQ_DIRECT_CONNECT']);
const directObject = value => /^\s*&?\s*([a-zA-Z_]\w*)\s*$/.exec(value || '')?.[1];

// Remove comments and mask all literals without changing source offsets or line numbering.
function mask(source, incomplete) {
  const trivia = /\/\*[\s\S]*?(\*\/|$)|\/\/(?:\\\r?\n|[^\n])*|(?:u8|[LuU])?R"([^\s()\\]{0,16})\([\s\S]*?(\)\2"|$)|"(?:\\(?:\r\n|[\s\S])|[^"\\\r\n])*("|\\?(?=[\r\n]|$))|'(?:\\(?:\r\n|[\s\S])|[^'\\\r\n])*('|\\?(?=[\r\n]|$))/g;
  return source.replace(trivia, (text, comment, delimiter, raw, string, character, offset) => {
    if ([comment, raw, string, character].some(end => end === '' || end === '\\')) incomplete?.(offset);
    return text.replace(/[^\r\n]/g, text.startsWith('/') ? ' ' : '@');
  });
}

function tokenize(source, firstBranch=false) {
  const syntax = /#(?:\\\r?\n|[^\n])*|\s+|[A-Za-z_]\w*|\d[\w.]*|@+|->|::|./g;
  const tokens = [], preprocessor = new SourcePreprocessor(), literalErrors = [];
  const masked = mask(source,offset=>literalErrors.push(offset));
  const guard=header_guard(masked);
  if (guard) preprocessor.macros.set(guard,{defined:0,value:0});
  let line=1, problem=0, issueLine;
  for (const match of masked.matchAll(syntax)) {
    const value=match[0], start=line;
    line+=(value.match(/\n/g) || []).length;
    while (problem<literalErrors.length && literalErrors[problem]<match.index+value.length) {
      if (preprocessor.active!==0) issueLine??=start;
      problem++;
    }
    if (value.startsWith('#')) {
      preprocessor.directive(value.replace(/\\\r?\n/g,' '),start);
      continue;
    }
    if (/^\s/.test(value) || preprocessor.active===0 || firstBranch && !preprocessor.selected) continue;
    tokens.push({value,start:match.index,end:match.index+value.length,line:start,
      conditional:preprocessor.active===undefined,branch:preprocessor.branch_path,macro:preprocessor.opaque(value)});
  }
  return {tokens,macros:preprocessor.macros,issueLine:issueLine ?? preprocessor.issueLine ?? preprocessor.stack[0]?.line};
}

function delimiters(tokens) {
  const open = {'(':')', '[':']', '{':'}'}, stack = [], pairs = new Map();
  for (const [index, token] of tokens.entries()) {
    if (Object.hasOwn(open,token.value)) stack.push(index);
    else if ([')',']','}'].includes(token.value)) {
      const left = stack.pop();
      if (Object.hasOwn(open,tokens[left]?.value) && open[tokens[left].value] === token.value) {
        pairs.set(left,index);
        pairs.set(index,left);
      }
    }
  }
  return pairs;
}

// Preserve a written member/array access as a use-site label. It is not a resolved global.
function member_access(expression) {
  const text=mask(expression || '').replace(/\s+/g,'').replace(/^&/,'');
  return /^[A-Za-z_]\w*(?:(?:\.|->)[A-Za-z_]\w*|\[(?:[A-Za-z_]\w*|\d+)\])+$/.test(text) ? text : undefined;
}

function argumentsAt(tokens, pairs, left, right, source) {
  const args = [];
  let first = left + 1;
  function append(end) {
    if (end === first) {args.push(''); return;}
    const start = tokens[first].start, finish = tokens[end-1].end;
    const value = source.slice(start,Math.min(finish,start+256)).trim();
    args.push(finish-start > 256 ? value+'…' : value);
  }
  for (let i = first; i < right; i++) {
    if (tokens[i].value === ',') {
      append(i);
      if (args.length === 16) return [...args,'…'];
      first = i + 1;
    } else if (pairs.get(i) > i) i = pairs.get(i);
  }
  if (first < right || args.length) append(right);
  return args;
}

function storage_class(tokens,index,spelling) {
  for (let i = index - 1; i >= 0 && ![';','{','}'].includes(tokens[i].value); i--) {
    if (tokens[i].value === spelling) return true;
  }
  return false;
}

function callbackContext(name,args) {
  if (['IRQ_CONNECT','IRQ_DIRECT_CONNECT','irq_connect_dynamic'].includes(name)) return ['interrupt',args[2]];
  if (['K_TIMER_DEFINE','k_timer_init'].includes(name)) return ['interrupt',args[1]];
  if (['K_WORK_DEFINE','K_WORK_DELAYABLE_DEFINE','K_WORK_USER_DEFINE','k_work_init','k_work_init_delayable','k_work_user_init'].includes(name)) {
    return ['work',args[1]];
  }
}

function timeoutSymbol(expression) {
  const clean = mask(expression || '').replace(/\s+/g,'');
  return /^\(*K_NO_WAIT\)*$/.test(clean) ? 'K_NO_WAIT' : /^\(*K_FOREVER\)*$/.test(clean) ? 'K_FOREVER' : clean;
}

function diagnose(call,context,english) {
  const wait = timeoutSymbol(call.args[timeoutArg.get(call.name)]);
  const warn = (rule,zh,en) => ({...call,rule,message:english ? en : zh});
  if (context === 'interrupt' && ['k_mutex_lock','k_mutex_unlock'].includes(call.name))
    return warn('isr-mutex','中断回调中出现互斥锁操作。核对执行上下文，必要时移交工作队列。','A mutex operation appears in an interrupt callback. Check the context and consider deferring the work.');
  if (context === 'interrupt' && wait && wait !== 'K_NO_WAIT')
    return warn('isr-timeout','中断回调中的超时参数需要等价于 K_NO_WAIT。请核对表达式。','An interrupt callback passes a timeout. Verify that the expression is equivalent to K_NO_WAIT.');
  if (context === 'work' && wait === 'K_FOREVER')
    return warn('workqueue-wait','工作处理函数可能无限等待，同一工作队列的后续工作会被延迟。','A work handler may wait indefinitely, delaying subsequent work on the same queue.');
}

function readRegistration(result,at,name,args,owner) {
  const fixed = name === 'K_THREAD_DEFINE';
  if ((fixed || (name === 'k_thread_create' && owner)) && args.length >= (fixed ? 9 : 10)) {
    result.threads.push({...at,name:args[0],entry:args[fixed?2:3],stack:args[fixed?1:2],
      priority:args[fixed?6:7],api:name});
  }
  if (definitions.has(name) && directObject(args[0])) result.objects.push({...at,name:directObject(args[0]),api:name,args});
}

// Recognize a direct lock → wait → unlock sequence only. Intervening branches, calls or aliases
// invalidate this rule; no whole-program locking or deadlock conclusion follows from the pattern.
function heldMutex(call, index, right, tokens, pairs) {
  if (call.conditional || call.name === 'k_mutex_lock' || !timeoutArg.has(call.name)) return;
  if (timeoutSymbol(call.args[timeoutArg.get(call.name)]) !== 'K_FOREVER') return;
  if (tokens[index-1]?.value !== ';' || tokens[index-2]?.value !== ')') return;
  const left = pairs.get(index-2);
  if (left === undefined || tokens[left-1]?.value !== 'k_mutex_lock') return;
  if (![';', '{', '}'].includes(tokens[left-2]?.value)) return;
  // Require exactly (&identifier, K_FOREVER) and the matching unlock immediately after the wait.
  const lock = tokens[left+2]?.value;
  if (!identifier.test(lock || '') || index-2 !== left+5) return;
  if (tokens[left+1].value !== '&' || tokens[left+3].value !== ',' || tokens[left+4].value !== 'K_FOREVER') return;
  const release = tokens.slice(right+1,right+8).map(t=>t.value).join(' ');
  if (release !== '; k_mutex_unlock ( & ' + lock + ' ) ;') return;
  const pieces = tokens.slice(left-1,right+8);
  if (pieces.some(t=>t.conditional || t.macro)) return;
  return lock;
}

// An all-caps name with a return type and an actual body is a function in this file.
function defined_uppercase_functions(tokens,pairs) {
  const names=new Set();
  for (let i=1;i<tokens.length;i++) {
    const token=tokens[i];
    if (token.macro || !/^[A-Z][A-Z0-9_]+$/.test(token.value) || tokens[i+1]?.value!=='(') continue;
    if (!identifier.test(tokens[i-1].value) && tokens[i-1].value!=='*') continue;
    const right=pairs.get(i+1);
    if (right!==undefined && tokens[skip_decorations(tokens,pairs,right+1)]?.value==='{') names.add(token.value);
  }
  return names;
}

/** A per-translation-unit lexical index. Unknown preprocessor alternatives are source candidates. */
function extract(file, source, english, sourceId, tokens, pairs, coverage) {
  const result = {threads:[], functions:[], objects:[], calls:[], diagnostics:[]};
  const bindings = new Map();
  const linkageEnds = new Set(), uppercase_functions=defined_uppercase_functions(tokens,pairs);
  let owner, ownerEnd = -1, depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i], name = token.value;
    if (i >= ownerEnd) owner = undefined;
    if (!depth && name==='struct' && kernel_structs.has(tokens[i+1]?.value) &&
        identifier.test(tokens[i+2]?.value || '') && [';','='].includes(tokens[i+3]?.value) &&
        !storage_class(tokens,i,'typedef') && !tokens[i+2].macro) {
      const tag=tokens[i+1].value, object=tokens[i+2];
      result.objects.push({file,line:object.line,id:sourceId+'#'+(i+2),name:object.value,api:'struct '+tag,args:[],conditional:object.conditional});
    }
    if (name === '{') {
      if (tokens[i-2]?.value==='extern' && tokens[i-1].value.startsWith('@')) linkageEnds.add(pairs.get(i));
      else depth++;
      continue;
    }
    if (name === '}') { if (!linkageEnds.has(i)) depth--; continue; }
    if (!identifier.test(name) || tokens[i+1]?.value !== '(') continue;
    if (['.', '->', '::'].includes(tokens[i-1]?.value)) continue;
    const right = pairs.get(i+1);
    if (right === undefined) continue;
    if (keywords.has(name)) {
      if (['sizeof','typeof','__typeof__','__attribute__','alignof','_Alignof','_Static_assert','static_assert'].includes(name)) i=right;
      continue;
    }
    if (token.macro || (!declared_macro_apis.has(name) && !uppercase_functions.has(name) && /^[A-Z][A-Z0-9_]+$/.test(name))) {
      if (coverage) coverage.opaqueMacros++;
      i=right;continue;
    }
    const args = argumentsAt(tokens,pairs,i+1,right,source);
    const at = {file,line:token.line,id:sourceId+'#'+i,conditional:token.conditional || !!owner?.conditional};
    const body=skip_decorations(tokens,pairs,right+1);
    if (!depth && tokens[body]?.value === '{' && pairs.has(body)) {
      const direct = name === 'ISR_DIRECT_DECLARE' && directObject(args[0]);
      owner = {...at,name:direct || name,fileLocal:storage_class(tokens,i,'static')};
      ownerEnd = pairs.get(body);
      result.functions.push(owner);
      if (direct && !at.conditional) bindings.set(owner.name,'interrupt');
      if (name === 'main') result.threads.push({...at,name,entry:name,api:name});
      i = body-1; continue;
    }
    readRegistration(result,at,name,args,owner);
    const binding = callbackContext(name,args);
    if (binding && !at.conditional && (owner || name === name.toUpperCase())) {
      const [context,callback] = binding, symbol = directObject(callback);
      if (symbol) bindings.set(symbol,context);
    }
    if (owner) {
      const call = {...at,owner:owner.name,ownerId:owner.id,name,args,
        object:objectCall.test(name) ? directObject(args[0]) : undefined};
      if (!call.object && objectCall.test(name)) call.member=member_access(args[0]);
      result.calls.push(call);
      const lock = heldMutex(call,i,right,tokens,pairs);
      if (lock)
        result.diagnostics.push({...call,rule:'held-mutex-wait',message:english ?
          'A K_FOREVER wait appears between locking and unlocking '+lock+'. Check whether another task needs this mutex to satisfy the wait.' :
          '持有 '+lock+' 的直线路径上出现 K_FOREVER 等待。请核对负责唤醒的线程是否也需要此锁。'});
    }
  }
  for (const call of result.calls) {
    const context = bindings.get(call.owner);
    if (!context) continue;
    const warning = diagnose(call,context,english);
    if (warning) result.diagnostics.push(warning);
  }
  return result;
}

function readSource(file, source, english = false, sourceId = file) {
  const {tokens} = tokenize(source);
  return extract(file,source,english,sourceId,tokens,delimiters(tokens));
}

function unpaired_token(tokens,pairs) {
  return tokens.find((token,index)=>['(',')','[',']','{','}'].includes(token.value) && !pairs.has(index));
}

/** Inspect one editable buffer and distinguish unfinished syntax from a valid empty index. */
function read_source_buffer(file, source, english = false) {
  let {tokens,macros,issueLine}=tokenize(source);
  if (issueLine!==undefined) return {issue:'incomplete',line:issueLine};
  let pairs=delimiters(tokens), unpaired=unpaired_token(tokens,pairs);
  const coverage={opaqueMacros:0};
  if (unpaired && tokens.some(token=>token.conditional)) {
    // Mutually exclusive declarations can share their closing brace after #endif. Index one
    // feasible spelling only when flattening the alternatives makes the delimiters inconsistent.
    tokens=tokenize(source,true).tokens;
    pairs=delimiters(tokens);unpaired=unpaired_token(tokens,pairs);
    coverage.branchProjection=true;
  }
  if (unpaired) return {issue:'incomplete',line:unpaired.line};
  return {records:extract(file,source,english,file,tokens,pairs,coverage),types:source_types(source,tokens,pairs),
    class_diagram:source_class_diagram(source,tokens,pairs,macros,file.endsWith('.c')),coverage};
}

module.exports = {readSource,read_source_buffer,mask};
