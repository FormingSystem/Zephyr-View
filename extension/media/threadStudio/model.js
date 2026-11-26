'use strict';

// The standalone design and the VS Code host use the same source and source locations.
(function () {
  const kinds = Object.freeze(['msgq', 'sem', 'mutex']);
  const limits = Object.freeze({
    producerStack:[512, 4096], consumerStack:[512, 4096],
    producerPriority:[0, 7], consumerPriority:[0, 7], capacity:[1, 64]
  });

  function defaults(kind = 'msgq') {
    if (!kinds.includes(kind)) throw new RangeError('Unknown concurrency primitive');
    const draft = {kind, creation:'static', producerStack:1024, consumerStack:1024, producerPriority:2, consumerPriority:3};
    if (kind !== 'mutex') draft.capacity = kind === 'sem' ? 1 : 4;
    return draft;
  }

  function validate(draft) {
    if (!draft || !kinds.includes(draft.kind)) return [{field:'kind', code:'kind'}];
    const diagnostics = [];
    if (!['static','dynamic'].includes(draft.creation ?? 'static')) diagnostics.push({field:'creation', code:'creation'});
    for (const [field, [min, max]] of Object.entries(limits)) {
      if (field === 'capacity' && draft.kind === 'mutex') continue;
      const value = draft[field];
      if (!Number.isSafeInteger(value)) diagnostics.push({field, code:'integer'});
      else if (value < min || value > max) diagnostics.push({field, code:'range', min, max});
      else if (field.endsWith('Stack') && value % 8 !== 0) diagnostics.push({field, code:'alignment'});
    }
    return diagnostics;
  }

  // These are application templates. Numeric limits belong to this lab's Kconfig and UI.
  const recipes = {
    msgq: {
      name:'samples', type:'struct k_msgq', macro:'K_MSGQ_DEFINE', payload:'uint32_t',
      declaration:capacity => `K_MSGQ_DEFINE(samples, sizeof(uint32_t), ${capacity}, 4);`,
      entries:['producer_entry', 'consumer_entry'],
      bodies:[
        `uint32_t value = 42U;
int err = k_msgq_put(&samples, &value, K_FOREVER);

if (err != 0) {
	printk("send failed: %d\\n", err);
}`,
        `uint32_t value;
int err = k_msgq_get(&samples, &value, K_FOREVER);

if (err == 0) {
	printk("received %u\\n", (unsigned int)value);
}`
      ],
      outgoing:['k_msgq_put'], incoming:['k_msgq_get']
    },
    sem: {
      name:'ready', type:'struct k_sem', macro:'K_SEM_DEFINE', payload:'',
      declaration:capacity => `K_SEM_DEFINE(ready, 0, ${capacity});`,
      entries:['producer_entry', 'consumer_entry'],
      bodies:[
        'k_sem_give(&ready);',
        `int err = k_sem_take(&ready, K_FOREVER);

if (err == 0) {
	printk("permit acquired\\n");
}`
      ],
      outgoing:['k_sem_give'], incoming:['k_sem_take']
    },
    mutex: {
      name:'counter_lock', type:'struct k_mutex', macro:'K_MUTEX_DEFINE', payload:'unsigned int',
      declaration:() => 'K_MUTEX_DEFINE(counter_lock);\nstatic unsigned int counter;',
      entries:['worker_a_entry', 'worker_b_entry'],
      bodies:['A', 'B'].map(name => `int err = k_mutex_lock(&counter_lock, K_FOREVER);
if (err != 0) {
	return;
}

unsigned int value = ++counter;

k_mutex_unlock(&counter_lock);
printk("worker ${name}: counter=%u\\n", value);`),
      outgoing:['k_mutex_lock'], incoming:[]
    }
  };

  const cmake = `# SPDX-License-Identifier: Apache-2.0
cmake_minimum_required(VERSION 3.20.0)
find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(thread_lab)
target_sources(app PRIVATE src/main.c)
`;

  const config = `CONFIG_MULTITHREADING=y
CONFIG_NUM_PREEMPT_PRIORITIES=8
CONFIG_THREAD_NAME=y
CONFIG_PRINTK=y
`;

  function build_source(draft) {
    const recipe = recipes[draft.kind];
    const lines = ['/* SPDX-License-Identifier: Apache-2.0 */', '#include <stdint.h>',
      '#include <zephyr/kernel.h>', '#include <zephyr/sys/printk.h>', ''];
    const object = {id:'object', name:recipe.name, type:recipe.type, payload:recipe.payload,
      macro:recipe.macro, line:lines.length + 1};
    if (draft.kind !== 'mutex') object.capacity = draft.capacity;
    lines.push(...recipe.declaration(draft.capacity).split('\n'), '');
    const threads = ['producer', 'consumer'].map((id, i) =>
      write_thread(lines, id, recipe.entries[i], recipe.bodies[i], draft));
    lines.push('int main(void)', '{');
    if (draft.creation === 'dynamic') {
      for (const thread of threads) write_creation(lines, thread);
    }
    lines.push('\treturn 0;', '}', '');
    const edges = [];
    for (const thread of threads) {
      for (const call of thread.calls) {
        if (recipe.outgoing.includes(call.name)) edges.push({from:thread.id, to:'object', api:call.name, line:call.line});
        if (recipe.incoming.includes(call.name)) edges.push({from:'object', to:thread.id, api:call.name, line:call.line});
      }
    }
    return {source:lines.join('\n'), threads, edges, object};
  }

  function write_thread(lines, id, entry, body, draft) {
    const stack = draft[id + 'Stack'];
    const priority = draft[id + 'Priority'];
    const thread = {id, entry, stack, priority, line:lines.length + 1, calls:[]};
    lines.push(`static void ${entry}(void *p1, void *p2, void *p3)`, '{',
      '\tARG_UNUSED(p1);', '\tARG_UNUSED(p2);', '\tARG_UNUSED(p3);', '');
    // Our generated statements each place a complete kernel or printk call on one line.
    for (const statement of body.split('\n')) {
      lines.push(statement ? '\t' + statement : '');
      const match = /\b(k_\w+|printk)\((.*)\);$/.exec(statement);
      if (match) thread.calls.push({name:match[1], args:match[2], line:lines.length});
    }
    lines.push('}', '');
    if (draft.creation === 'dynamic') {
      lines.push(`K_THREAD_STACK_DEFINE(${entry}_stack, ${stack});`, `static struct k_thread ${entry}_thread;`, '');
      return thread;
    }
    thread.registrationLine = lines.length + 1;
    lines.push(`K_THREAD_DEFINE(${entry}_id, ${stack}, ${entry},`,
      `		NULL, NULL, NULL, ${priority}, 0, 0);`, '');
    return thread;
  }

  function write_creation(lines, thread) {
    const {entry, priority} = thread;
    thread.registrationLine = lines.length + 1;
    lines.push(`\tk_thread_create(&${entry}_thread, ${entry}_stack,`,
      `\t\tK_THREAD_STACK_SIZEOF(${entry}_stack), ${entry},`,
      `\t\tNULL, NULL, NULL, ${priority}, 0, K_NO_WAIT);`);
  }

  function describe(draft) {
    const diagnostics = validate(draft);
    if (diagnostics.length) return {threads:[], object:null, edges:[], diagnostics};
    const {threads, object, edges} = build_source(draft);
    return {threads, object, edges, diagnostics};
  }

  function generate(draft) {
    const diagnostics = validate(draft);
    if (diagnostics.length) throw new RangeError('Invalid thread parameters: ' + diagnostics.map(item => item.field).join(', '));
    return {'CMakeLists.txt':cmake, 'prj.conf':config, 'src/main.c':build_source(draft).source};
  }

  const api = {kinds, limits, defaults, validate, describe, generate};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.ZephyrThreadModel = api;
}());
