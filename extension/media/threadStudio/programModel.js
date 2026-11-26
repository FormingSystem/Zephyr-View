'use strict';

(function () {
  const operations = Object.freeze({
    msgq:Object.freeze(['send','receive']), sem:Object.freeze(['give','take']), mutex:Object.freeze(['increment'])
  });
  const kinds = Object.keys(operations);
  const arithmetic = new Map([['set','='],['add','+='],['subtract','-='],['multiply','*=']]);
  const comparisons = new Map([['eq','=='],['ne','!='],['lt','<'],['le','<='],['gt','>'],['ge','>=']]);
  const signals = new Map([['send','k_msgq_put'],['receive','k_msgq_get'],['take','k_sem_take'],
    ['give','k_sem_give'],['increment','k_mutex_lock']]);
  const keywords = new Set(('alignas alignof auto bool break case char const constexpr continue default do ' +
    'double else enum extern false float for goto if inline int long nullptr register restrict return ' +
    'short signed sizeof static static_assert struct switch thread_local true typedef typeof typeof_unqual ' +
    'union unsigned void volatile while').split(' '));
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const inRange = (value,min,max) => Number.isSafeInteger(value) && value >= min && value <= max;
  const uint32 = value => inRange(value,0,0xffffffff);
  const validName = name => typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(name) && !keywords.has(name);
  const validId = id => typeof id === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id) && !Object.hasOwn(Object.prototype,id);

  function starter() {
    return {version:1, name:'application', creation:'static', objects:[], functions:[], threads:[],
      mainSteps:[{id:'initialize',op:'set',value:0}]};
  }

  function example() {
    return {
      version:1, name:'thread_network', creation:'static',
      objects:[{id:'samples',name:'samples',kind:'msgq',capacity:4},{id:'ready',name:'ready',kind:'sem',capacity:1}],
      functions:[{id:'scale',name:'scale',steps:[{id:'threshold',op:'if',test:'ge',value:40,
        steps:[{id:'double',op:'multiply',value:2}],elseSteps:[{id:'offset',op:'add',value:1}]}]}],
      mainSteps:[{id:'startup',op:'set',value:1},{id:'boot_output',op:'print'}],
      threads:[
        {id:'sensor',name:'sensor',stack:1024,priority:2,initialValue:42,steps:[{id:'publish',op:'send',object:'samples'}]},
        {id:'relay',name:'relay',stack:1024,priority:3,steps:[{id:'read',op:'receive',object:'samples'},
          {id:'process',op:'call',function:'scale'},{id:'result',op:'print'},{id:'notify',op:'give',object:'ready'}]},
        {id:'logger',name:'logger',stack:1024,priority:4,steps:[{id:'await_ready',op:'take',object:'ready'}]}
      ]
    };
  }

  // The host validates files from disk and draft messages using the same schema as the editor.
  class GraphValidator {
    constructor() {
      this.issues = [];
      this.ids = new Set();
      this.names = new Set();
      this.objects = new Map();
      this.functions = new Set();
      this.calls = new Map();
      this.stepCount = 0;
    }

    issue(field,code) { this.issues.push({field,code}); }

    list(value,field,min,max) {
      if (Array.isArray(value) && inRange(value.length,min,max)) return value;
      this.issue(field,'count');
      return [];
    }

    identify(item,field,named) {
      if (!record(item)) {this.issue(field,'schema'); return false;}
      if (!validId(item.id) || this.ids.has(item.id)) this.issue(field+'.id','id');
      this.ids.add(item.id);
      if (named) {
        if (!validName(item.name)) this.issue(field+'.name','name');
        else if (this.names.has(item.name)) this.issue(field+'.name','duplicate');
        this.names.add(item.name);
      }
      return true;
    }

    object(obj,field) {
      if (!this.identify(obj,field,true)) return;
      if (!kinds.includes(obj.kind)) this.issue(field+'.kind','kind');
      else if (obj.kind !== 'mutex' && !inRange(obj.capacity,1,64)) this.issue(field+'.capacity','range');
      this.objects.set(obj.id,obj);
    }

    thread(thread,field) {
      if (!this.identify(thread,field,true)) return;
      if (!inRange(thread.stack,512,4096) || thread.stack % 8 !== 0) this.issue(field+'.stack','range');
      if (!inRange(thread.priority,0,7)) this.issue(field+'.priority','range');
      if (thread.initialValue !== undefined && !uint32(thread.initialValue)) this.issue(field+'.initialValue','range');
      this.steps(thread.steps,field+'.steps',0);
    }

    steps(rows,field,depth,caller) {
      if (depth > 8 || this.stepCount >= 1024) {this.issue(field,'count'); return;}
      for (const [i,step] of this.list(rows,field,0,64).entries()) {
        if (++this.stepCount > 1024) {this.issue(field,'count'); return;}
        const location = field+'['+i+']';
        if (this.identify(step,location,false)) this.step(step,location,depth,caller);
      }
    }

    step(step,field,depth,caller) {
      if (signals.has(step.op)) {
        const target = this.objects.get(step.object);
        if (!target) this.issue(field+'.object','reference');
        else if (!kinds.includes(target.kind) || !operations[target.kind].includes(step.op)) this.issue(field+'.op','operation');
      } else if (step.op === 'if') {
        if (!comparisons.has(step.test)) this.issue(field+'.test','operation');
        if (!uint32(step.value)) this.issue(field+'.value','range');
        this.steps(step.steps,field+'.steps',depth+1,caller);
        this.steps(step.elseSteps,field+'.elseSteps',depth+1,caller);
      } else if (step.op === 'repeat') {
        if (!inRange(step.count,1,1024)) this.issue(field+'.count','range');
        this.steps(step.steps,field+'.steps',depth+1,caller);
      } else if (step.op === 'call') {
        if (!this.functions.has(step.function)) this.issue(field+'.function','reference');
        else if (caller) this.calls.get(caller).push([step.function,field+'.function']);
      } else if (arithmetic.has(step.op)) {
        if (!uint32(step.value)) this.issue(field+'.value','range');
      } else if (step.op === 'external') {
        if (!validName(step.symbol)) this.issue(field+'.symbol','name');
      } else if (step.op === 'delay') {
        if (!inRange(step.value,0,60000)) this.issue(field+'.value','range');
      } else if (step.op !== 'print') this.issue(field+'.op','operation');
    }

    checkCycles() {
      const visited = new Set(), visiting = new Set();
      const walk = id => {
        visiting.add(id);
        for (const [next,field] of this.calls.get(id) || []) {
          if (visiting.has(next)) this.issue(field,'cycle');
          else if (!visited.has(next)) walk(next);
        }
        visiting.delete(id);
        visited.add(id);
      };
      for (const id of this.functions) if (!visited.has(id)) walk(id);
    }

    validate(graph) {
      if (!record(graph) || graph.version !== 1) return [{field:'version',code:'schema'}];
      if (!validName(graph.name)) this.issue('name','name');
      if (!['static','dynamic'].includes(graph.creation)) this.issue('creation','creation');
      this.list(graph.objects,'objects',0,64).forEach((obj,i) => this.object(obj,'objects['+i+']'));
      const functions = this.list(graph.functions === undefined ? [] : graph.functions,'functions',0,32);
      functions.forEach((fn,i) => {
        if (!this.identify(fn,'functions['+i+']',true)) return;
        this.functions.add(fn.id);
        this.calls.set(fn.id,[]);
      });
      functions.forEach((fn,i) => {
        if (record(fn)) this.steps(fn.steps,'functions['+i+'].steps',0,fn.id);
      });
      this.list(graph.threads,'threads',0,32).forEach((th,i) => this.thread(th,'threads['+i+']'));
      this.steps(graph.mainSteps === undefined ? [] : graph.mainSteps,'mainSteps',0);
      if (!graph.threads?.length && !graph.mainSteps?.length) this.issue('threads','count');
      this.checkCycles();
      return this.issues;
    }
  }

  function validate(graph) { return new GraphValidator().validate(graph); }

  // A function can be shared. Only accept an event in a context with a path to that step.
  function execution_contexts(graph) {
    const result = new Map();
    const functions = new Map((graph.functions || []).map(fn => [fn.id, fn]));
    function index(context, steps) {
      const known = new Map();
      result.set(context,known);
      const pending = [...steps];
      while (pending.length) {
        const step = pending.pop();
        if (known.has(step.id)) continue;
        known.set(step.id,step);
        if (step.op === 'call') pending.push(...functions.get(step.function).steps);
        if (step.op === 'if' || step.op === 'repeat') pending.push(...step.steps);
        if (step.op === 'if') pending.push(...step.elseSteps);
      }
    }
    index('$main',graph.mainSteps || []);
    for (const thread of graph.threads) index(thread.id,thread.steps);
    return result;
  }

  // FNV-1a 64 identifies otherwise independent captures; it is not an authenticity check.
  // Only generation inputs enter the fingerprint. Moving a card on the canvas preserves trace compatibility.
  function fingerprint(graph) {
    if (validate(graph).length) return '';
    const steps = list => list.map(s => {
      if (signals.has(s.op)) return [s.id,s.op,s.object];
      if (s.op === 'if') return [s.id,s.op,s.test,s.value,steps(s.steps),steps(s.elseSteps)];
      if (s.op === 'repeat') return [s.id,s.op,s.count,steps(s.steps)];
      if (s.op === 'call') return [s.id,s.op,s.function];
      if (s.op === 'external') return [s.id,s.op,s.symbol];
      return [s.id,s.op,s.op === 'print' ? null : s.value];
    });
    const canonical = [graph.version,graph.name,graph.creation,
      graph.threads.map(t => [t.id,t.name,t.stack,t.priority,t.initialValue ?? 42,steps(t.steps)]),
      graph.objects.map(o => [o.id,o.name,o.kind,o.kind === 'mutex' ? null : o.capacity]),
      (graph.functions || []).map(f => [f.id,f.name,steps(f.steps)]),steps(graph.mainSteps || [])];
    let hash = 14695981039346656037n;
    for (const ch of JSON.stringify(canonical)) hash = BigInt.asUintN(64,(hash ^ BigInt(ch.charCodeAt(0))) * 1099511628211n);
    return hash.toString(16).padStart(16,'0');
  }

  class ProgramSource {
    constructor(graph,key,protocol) {
      this.protocol = protocol;
      this.graph = graph;
      this.objects = new Map(graph.objects.map(o => [o.id,o]));
      this.functions = new Map((graph.functions || []).map(f => [f.id,f]));
      this.code = ['/* SPDX-License-Identifier: Apache-2.0 */','#include <stdint.h>','#include <stdbool.h>',
        '#include <zephyr/kernel.h>','#include <zephyr/sys/printk.h>','',
        '#if defined(ZV_TRACE) && ZV_TRACE',
        '#define ZV_EVENT(step, object, op) \\',
        `\tprintk("ZVTRACE ${protocol} ${key} %s %s %s %s %u\\n", context, step, object, op, (unsigned int)value)`,
        '#else','#define ZV_EVENT(step, object, op) do { } while (0)','#endif',''];
      this.lines = Object.create(null);
      this.edges = [];
      this.hooks = new Set();
      this.depth = 0;
    }

    emit(text) { this.code.push('\t'.repeat(this.depth)+text); }

    checked(expression) {
      this.emit(`if (${expression}) {`);
      this.emit('\t'+this.abort);
      this.emit('}');
    }

    event(step,op=step.op) {
      this.emit(`ZV_EVENT("${step.id}", "${signals.has(step.op) ? step.object : '-'}", "${op}");`);
    }

    object(obj) {
      this.lines[obj.id] = this.code.length+1;
      const name = 'zv_obj_'+obj.name;
      switch (obj.kind) {
        case 'msgq': this.emit(`K_MSGQ_DEFINE(${name}, sizeof(uint32_t), ${obj.capacity}, 4);`); break;
        case 'sem': this.emit(`K_SEM_DEFINE(${name}, 0, ${obj.capacity});`); break;
        case 'mutex': this.emit(`K_MUTEX_DEFINE(${name});`); this.emit(`static uint32_t zv_count_${obj.name};`); break;
      }
    }

    signal(step) {
      const obj = this.objects.get(step.object), api = signals.get(step.op);
      const address = '&zv_obj_'+obj.name;
      const reads = step.op === 'receive' || step.op === 'take';
      this.edges.push({from:reads ? obj.id : this.owner,to:reads ? this.owner : obj.id,
        stepId:step.id,op:step.op,api,line:this.lines[step.id]});
      switch (step.op) {
        case 'send': case 'receive': this.checked(`${api}(${address}, &value, K_FOREVER) != 0`); break;
        case 'give': this.emit(`${api}(${address});`); break;
        case 'take': this.checked(`${api}(${address}, K_FOREVER) != 0`); break;
        case 'increment':
          this.checked(`${api}(${address}, K_FOREVER) != 0`);
          this.emit(`value = ++zv_count_${obj.name};`);
          this.checked(`k_mutex_unlock(${address}) != 0`);
          break;
      }
    }

    branch(step) {
      this.emit(`if (value ${comparisons.get(step.test)} ${step.value}U) {`);
      this.depth++;
      this.event(step,'if-then');
      this.steps(step.steps);
      this.depth--;
      this.emit('} else {');
      this.depth++;
      this.event(step,'if-else');
      this.steps(step.elseSteps);
      this.depth--;
      this.emit('}');
    }

    repeat(step) {
      const index = 'i'+this.depth;
      this.emit(`for (uint32_t ${index} = 0; ${index} < ${step.count}U; ++${index}) {`);
      this.depth++;
      this.steps(step.steps);
      this.depth--;
      this.emit('}');
    }

    steps(list) {
      for (const step of list) {
        this.lines[step.id] = this.code.length+1;
        if (step.op === 'if') {this.branch(step); continue;}
        const callBoundary = this.protocol === 2 && (step.op === 'call' || step.op === 'external');
        if (callBoundary) {
          this.event(step,step.op+'-enter');
          this.lines[step.id] = this.code.length+1;
        }
        if (signals.has(step.op)) this.signal(step);
        else if (arithmetic.has(step.op)) this.emit(`value ${arithmetic.get(step.op)} ${step.value}U;`);
        else if (step.op === 'print') this.emit('printk("%s value=%u\\n", context, (unsigned int)value);');
        else if (step.op === 'delay') this.emit(`k_sleep(K_MSEC(${step.value}));`);
        else if (step.op === 'repeat') this.repeat(step);
        else if (step.op === 'external') {
          this.emit(`value = zv_hook_${step.symbol}(value);`);
        }
        else if (step.op === 'call') {
          const fn = this.functions.get(step.function);
          this.checked(`!zv_fn_${fn.name}(&value, context)`);
        }
        this.event(step, callBoundary ? step.op+'-return' : step.op);
      }
    }

    begin(id,signature,abort) {
      this.lines[id] = this.code.length+1;
      this.code.push(signature,'{');
      this.depth = 1;
      this.owner = id;
      this.abort = abort;
    }

    end() { this.depth = 0; this.code.push('}',''); }

    locals(context,initial) {
      this.emit(`const char *context = "${context}";`);
      this.emit(`uint32_t value = ${initial}U;`);
      this.emit('ARG_UNUSED(context);');
      this.emit('ARG_UNUSED(value);');
    }

    func(fn) {
      this.begin(fn.id,`static bool zv_fn_${fn.name}(uint32_t *state, const char *context)`,'return false;');
      this.emit('uint32_t value = *state;');
      this.emit('ARG_UNUSED(context);');
      this.steps(fn.steps);
      this.emit('*state = value;');
      this.emit('return true;');
      this.end();
    }

    thread(thread) {
      const base = 'zv_task_'+thread.name;
      this.begin(thread.id,`static void ${base}_entry(void *p1, void *p2, void *p3)`,'return;');
      this.emit('ARG_UNUSED(p1);');
      this.emit('ARG_UNUSED(p2);');
      this.emit('ARG_UNUSED(p3);');
      this.locals(thread.id,thread.initialValue ?? 42);
      this.steps(thread.steps);
      this.end();
      if (this.graph.creation === 'static') {
        this.code.push(`K_THREAD_DEFINE(${base}_id, ${thread.stack}, ${base}_entry,`,
          `\t\tNULL, NULL, NULL, ${thread.priority}, 0, 0);`,'');
      } else {
        this.code.push(`K_THREAD_STACK_DEFINE(${base}_stack, ${thread.stack});`, `static struct k_thread ${base}_thread;`,'');
      }
    }

    main() {
      this.begin('$main','int main(void)','return 1;');
      if (this.graph.creation === 'dynamic') {
        for (const thread of this.graph.threads) {
          const base = 'zv_task_'+thread.name;
          this.emit(`k_thread_create(&${base}_thread, ${base}_stack,`);
          this.emit(`\tK_THREAD_STACK_SIZEOF(${base}_stack), ${base}_entry,`);
          this.emit(`\tNULL, NULL, NULL, ${thread.priority}, 0, K_NO_WAIT);`);
        }
      }
      if (this.graph.mainSteps?.length) {
        this.locals('$main',0);
        this.steps(this.graph.mainSteps);
      }
      this.emit('return 0;');
      this.end();
    }

    render() {
      const bodies = [this.graph.mainSteps || [], ...this.graph.threads.map(t => t.steps), ...Array.from(this.functions.values(),f => f.steps)];
      const declareHooks = rows => {
        for (const step of rows) {
          if (step.op === 'external') this.hooks.add(step.symbol);
          else if (step.op === 'repeat' || step.op === 'if') declareHooks(step.steps);
          if (step.op === 'if') declareHooks(step.elseSteps);
        }
      };
      for (const rows of bodies) declareHooks(rows);
      for (const symbol of this.hooks) this.code.push(`__weak uint32_t zv_hook_${symbol}(uint32_t value)`, '{', '\treturn value;', '}', '');
      for (const obj of this.graph.objects) this.object(obj);
      for (const fn of this.functions.values()) this.emit(`static bool zv_fn_${fn.name}(uint32_t *state, const char *context);`);
      this.code.push('');
      for (const fn of this.functions.values()) this.func(fn);
      for (const th of this.graph.threads) this.thread(th);
      this.main();
      return this;
    }
  }

  function describe(graph,protocol=2) {
    const diagnostics = validate(graph);
    if (diagnostics.length) return {diagnostics,lines:{},edges:[]};
    const {lines,edges} = new ProgramSource(graph,'',protocol).render();
    return {diagnostics,lines,edges};
  }

  function generate(graph,protocol=2) {
    const key = fingerprint(graph);
    if (!key) throw new RangeError('Invalid thread graph: '+validate(graph).map(d => d.field+' '+d.code).join(', '));
    return {
      'CMakeLists.txt':['# SPDX-License-Identifier: Apache-2.0','cmake_minimum_required(VERSION 3.20.0)',
        'find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})',`project(${graph.name})`,'target_sources(app PRIVATE src/main.c src/user_hooks.c)',
        'option(ZV_TRACE "Print visual program events to the Zephyr console" OFF)',
        'if(ZV_TRACE)','  target_compile_definitions(app PRIVATE ZV_TRACE=1)','endif()',''].join('\n'),
      'prj.conf':['CONFIG_MULTITHREADING=y','CONFIG_NUM_PREEMPT_PRIORITIES=8','CONFIG_THREAD_NAME=y','CONFIG_PRINTK=y',''].join('\n'),
      'src/user_hooks.c':['/* SPDX-License-Identifier: Apache-2.0 */','#include <stdint.h>','',
        '/* Add your driver adapters here. This file is kept when regenerating a graph.',
        ' * For an external step named read_sensor, define:',
        ' * uint32_t zv_hook_read_sensor(uint32_t value) { return value + 1U; }',
        ' * Without an override the weak hook returns its input unchanged.',' */',''].join('\n'),
      'src/main.c':new ProgramSource(graph,key,protocol).render().code.join('\n')
    };
  }

  const api = {operations,starter,example,validate,describe,generate,fingerprint,execution_contexts};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.ZephyrProgramModel = api;
}());
