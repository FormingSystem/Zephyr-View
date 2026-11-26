'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const model = require('../extension/media/threadStudio/model');

test('drafts use integers in the lab ranges and preserve invalid edits without exporting', () => {
  for (const [field, [min, max]] of Object.entries(model.limits)) {
    const draft = model.defaults();
    for (const value of [min, max]) {
      assert.deepEqual(model.validate({...draft, [field]:value}), []);
    }
    for (const value of [min - 1, max + 1, NaN, '', false, 4.25, '4);abort();']) {
      const invalid = Object.freeze({...draft, [field]:value});
      const report = model.describe(invalid);
      assert.deepEqual(report.diagnostics.map(row => row.field), [field]);
      assert.equal(report.object, null);
      assert.deepEqual(report.threads, []);
      assert.throws(() => model.generate(invalid), RangeError);
    }
  }
  assert.equal(model.validate({...model.defaults(), consumerStack:513})[0].code, 'alignment');
  assert.throws(() => model.defaults('unknown'), RangeError);
  assert.deepEqual(model.validate(null), [{field:'kind', code:'kind'}]);
});

test('each graph element points to its actual definition or call in the exported C', () => {
  for (const kind of model.kinds) {
    const draft = {...model.defaults(kind), producerStack:1536, consumerPriority:5};
    const files = model.generate(draft);
    assert.deepEqual(Object.keys(files), ['CMakeLists.txt', 'prj.conf', 'src/main.c']);
    const graph = model.describe(draft);
    const lines = files['src/main.c'].split('\n');
    assert.ok(lines[graph.object.line - 1].startsWith(graph.object.macro + '(' + graph.object.name));
    for (const thread of graph.threads) {
      assert.ok(lines[thread.line - 1].includes('static void ' + thread.entry + '('));
      assert.ok(lines[thread.registrationLine - 1].includes(thread.stack + ', ' + thread.entry));
      assert.ok(lines[thread.registrationLine].includes('NULL, ' + thread.priority + ', 0, 0);'));
      assert.ok(thread.calls.length);
      for (const call of thread.calls) assert.ok(lines[call.line - 1].includes(call.name + '(' + call.args + ');'));
    }
    for (const edge of graph.edges) assert.ok(lines[edge.line - 1].includes(edge.api + '('));
  }
});

test('graph preserves data transfer, semaphore permits and symmetric mutex ownership', () => {
  const queue = model.describe({...model.defaults('msgq'), capacity:2});
  assert.equal(queue.object.payload, 'uint32_t');
  assert.equal(queue.object.capacity, 2);
  assert.deepEqual(queue.edges.map(e => [e.from,e.api,e.to]),
    [['producer','k_msgq_put','object'], ['object','k_msgq_get','consumer']]);
  const gate = model.describe(model.defaults('sem'));
  assert.equal(gate.object.payload, '');
  assert.equal(gate.object.capacity, 1);
  assert.deepEqual(gate.edges.map(e => e.api), ['k_sem_give','k_sem_take']);
  const mutex = model.describe(model.defaults('mutex'));
  assert.ok(!Object.hasOwn(mutex.object,'capacity'));
  assert.deepEqual(mutex.edges.map(e => [e.from,e.api,e.to]),
    [['producer','k_mutex_lock','object'], ['consumer','k_mutex_lock','object']]);
  for (const thread of mutex.threads) assert.ok(thread.calls.find(call => call.name === 'k_mutex_unlock'));
});

test('runtime creation uses persistent thread storage and maps main to both entry functions', () => {
  for (const kind of model.kinds) {
    const draft = {...model.defaults(kind), creation:'dynamic', consumerPriority:6};
    const lines = model.generate(draft)['src/main.c'].split('\n');
    assert.ok(!lines.some(line => line.startsWith('K_THREAD_DEFINE')));
    for (const thread of model.describe(draft).threads) {
      assert.ok(lines.includes('K_THREAD_STACK_DEFINE(' + thread.entry + '_stack, ' + thread.stack + ');'));
      assert.ok(lines[thread.registrationLine - 1].includes('k_thread_create(&' + thread.entry + '_thread'));
      assert.ok(lines[thread.registrationLine].includes('K_THREAD_STACK_SIZEOF(' + thread.entry + '_stack), ' + thread.entry));
      assert.ok(lines[thread.registrationLine + 1].includes(thread.priority + ', 0, K_NO_WAIT)'));
    }
  }
  const old = model.defaults();
  delete old.creation;
  assert.deepEqual(model.generate(old), model.generate(model.defaults()));
  assert.throws(() => model.generate({...old, creation:'invalid'}), RangeError);
});

test('browser and extension host produce identical source', () => {
  const browser = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../extension/media/threadStudio/model'), 'utf8'), browser);
  for (const kind of model.kinds) {
    const draft = model.defaults(kind);
    assert.equal(browser.ZephyrThreadModel.generate(draft)['src/main.c'], model.generate(draft)['src/main.c']);
  }
});
