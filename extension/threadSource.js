'use strict';

const {source_types} = require('./liveSourceTypes');

const identifier = /^[A-Za-z_]\w*$/;
const definitions = new Set(['K_SEM_DEFINE','K_MUTEX_DEFINE','K_MSGQ_DEFINE','K_FIFO_DEFINE','K_LIFO_DEFINE',
  'K_EVENT_DEFINE','K_TIMER_DEFINE','K_WORK_DEFINE','K_WORK_DELAYABLE_DEFINE','K_WORK_USER_DEFINE',
  'K_PIPE_DEFINE','K_MEM_SLAB_DEFINE','K_CONDVAR_DEFINE','K_QUEUE_DEFINE','K_STACK_DEFINE']);
const keywords = new Set(['if','else','for','while','do','return','switch','sizeof','_Alignof','_Static_assert',
  'typeof','__typeof__','__attribute__','case','alignof','static_assert']);
const objectCall = /^k_(?:sem|mutex|msgq|fifo|lifo|queue|timer|event|work|poll_signal|condvar|pipe|mem_slab|stack)_/;
const timeoutArg = new Map(Object.entries({k_sem_take:1,k_mutex_lock:1,k_msgq_put:2,k_msgq_get:2,
  k_fifo_get:1,k_lifo_get:1,k_queue_get:1,k_mem_slab_alloc:2,k_event_wait:3,k_event_wait_all:3}));
const directObject = value => /^\s*&?\s*([a-zA-Z_]\w*)\s*$/.exec(value || '')?.[1];

// Remove comments and mask all literals without changing source offsets or line numbering.
function mask(source, incomplete) {
  const trivia = /\/\*[\s\S]*?(\*\/|$)|\/\/(?:\\\r?\n|[^\n])*|(?:u8|[LuU])?R"([^\s()\\]{0,16})\([\s\S]*?(\)\2"|$)|"(?:\\(?:\r\n|[\s\S])|[^"\\\r\n])*("|\\?(?=[\r\n]|$))|'(?:\\(?:\r\n|[\s\S])|[^'\\\r\n])*('|\\?(?=[\r\n]|$))/g;
  return source.replace(trivia, (text, comment, delimiter, raw, string, character, offset) => {
    if ([comment, raw, string, character].some(end => end === '' || end === '\\')) incomplete?.(offset);
    return text.replace(/[^\r\n]/g, text.startsWith('/') ? ' ' : '@');
  });
}

function expressionValue(expression) {
  const literal = /^\s*\(*\s*(0|1)[ul]*\s*\)*\s*$/i.exec(expression);
  return literal ? Number(literal[1]) : undefined;
}

// remaining records whether any as-yet unseen branch can run: false, true, or unknown.
function updateCondition(stack, directive) {
  const [, type, expression] = directive;
  if (type === 'endif') { stack.pop(); return; }
  if (type === 'if' || type === 'ifdef' || type === 'ifndef') {
    const value = type === 'if' ? expressionValue(expression) : undefined;
    stack.push({active:value, remaining:value === undefined ? undefined : 1 - value});
    return;
  }
  const branch = stack.at(-1);
  if (!branch) return;
  const value = type === 'else' ? 1 : expressionValue(expression);
  branch.active = value === 0 || branch.remaining === 0 ? 0 : value === 1 ? branch.remaining : undefined;
  if (value === 1) branch.remaining = 0;
  else if (value !== 0 && branch.remaining !== 0) branch.remaining = undefined;
}

function tokenize(source, incomplete) {
  const syntax = /#(?:\\\r?\n|[^\n])*|\s+|[A-Za-z_]\w*|\d[\w.]*|@+|->|::|./g;
  const tokens = [], conditions = [], macros = new Set();
  let line = 1;
  for (const match of mask(source, incomplete).matchAll(syntax)) {
    const value = match[0], start = line;
    line += (value.match(/\n/g) || []).length;
    if (value.startsWith('#')) {
      const statement = value.replace(/\\\r?\n/g, ' ');
      const directive = /^#\s*(if|ifdef|ifndef|elif|else|endif)\b(.*)/.exec(statement);
      if (directive) updateCondition(conditions, directive);
      else if (!conditions.some(branch=>branch.active === 0)) {
        const define = /^#\s*define\s+([A-Za-z_]\w*)/.exec(statement);
        if (define) macros.add(define[1]);
      }
      continue;
    }
    if (/^\s/.test(value) || conditions.some(branch=>branch.active === 0)) continue;
    tokens.push({value,start:match.index,end:match.index+value.length,line:start,
      conditional:conditions.some(branch=>branch.active === undefined)});
  }
  return {tokens,macros,openConditional:conditions.length > 0};
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

function fileLocal(tokens, index) {
  for (let i = index - 1; i >= 0 && ![';','{','}'].includes(tokens[i].value); i--) {
    if (tokens[i].value === 'static') return true;
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
  if (pieces.some(t=>t.conditional)) return;
  return lock;
}

/** A per-translation-unit lexical index. Unknown preprocessor alternatives are source candidates. */
function extract(file, source, english, sourceId, tokens, macros, pairs) {
  const result = {threads:[], functions:[], objects:[], calls:[], diagnostics:[]};
  const bindings = new Map();
  let owner, ownerEnd = -1, depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i], name = token.value;
    if (i >= ownerEnd) owner = undefined;
    if (name === '{') { depth++; continue; }
    if (name === '}') { depth--; continue; }
    if (!identifier.test(name) || keywords.has(name) || macros.has(name) || tokens[i+1]?.value !== '(') continue;
    if (['.', '->', '::'].includes(tokens[i-1]?.value)) continue;
    const right = pairs.get(i+1);
    if (right === undefined) continue;
    const args = argumentsAt(tokens,pairs,i+1,right,source);
    const at = {file,line:token.line,id:sourceId+'#'+i,conditional:token.conditional};
    if (!depth && tokens[right+1]?.value === '{' && pairs.has(right+1)) {
      const direct = name === 'ISR_DIRECT_DECLARE' && directObject(args[0]);
      owner = {...at,name:direct || name,fileLocal:fileLocal(tokens,i)};
      ownerEnd = pairs.get(right+1);
      result.functions.push(owner);
      if (direct && !at.conditional) bindings.set(owner.name,'interrupt');
      if (name === 'main') result.threads.push({...at,name,entry:name,api:name});
      i = right; continue;
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
      result.calls.push(call);
      const lock = heldMutex(call,i,right,tokens,pairs);
      if (lock && !macros.has('k_mutex_lock') && !macros.has('k_mutex_unlock'))
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
  const {tokens,macros} = tokenize(source);
  return extract(file,source,english,sourceId,tokens,macros,delimiters(tokens));
}

/** Inspect one editable buffer and distinguish unfinished syntax from a valid empty index. */
function read_source_buffer(file, source, english = false) {
  let unfinished;
  const {tokens,macros,openConditional} = tokenize(source, offset => { unfinished ??= offset; });
  if (unfinished !== undefined) {
    return {issue:'incomplete',line:source.slice(0,unfinished).split('\n').length};
  }
  const pairs = delimiters(tokens);
  const unpaired = tokens.find((token,index) => ['(',')','[',']','{','}'].includes(token.value) && !pairs.has(index));
  if (unpaired || openConditional) return {issue:'incomplete',line:unpaired?.line ?? tokens.at(-1)?.line ?? 1};
  return {records:extract(file,source,english,file,tokens,macros,pairs),types:source_types(source,tokens,pairs)};
}

module.exports = {readSource,read_source_buffer};
