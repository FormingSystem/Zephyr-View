'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {readSource} = require('../extension/threadSource');
const {analyzeApplication, fingerprint} = require('../extension/threadAnalysis');
const model = require('../extension/media/threadStudio/model');

test('inactive branches, directive indentation, comments, literals and macro bodies leave no false thread entries', () => {
  const text = [
    '  #if 0 /* known false */', 'K_SEM_DEFINE(dead, 0, 1);','  #elif 1',
    '#if (1U)','K_SEM_DEFINE(active, 0, 1);','#else','K_SEM_DEFINE(dead2, 0, 1);','#endif',
    ' #else', 'K_SEM_DEFINE(dead3, 0, 1);','#endif',
    '#if MAYBE','K_SEM_DEFINE(a,0,1);','#elif 0','K_SEM_DEFINE(dead4,0,1);',
    '#elif 1','K_SEM_DEFINE(b,0,1);','#else','K_SEM_DEFINE(dead5,0,1);','#endif',
    '#define WRAPPER() \\', ' K_SEM_DEFINE(fake,0,1);',
    '// K_SEM_DEFINE(comment,0,1);', '/* K_SEM_DEFINE(block,0,1); */',
    'const char *text = "K_SEM_DEFINE(string,0,1);";',
    'const char *raw = R"q(a " quote K_SEM_DEFINE(raw,0,1);)q";',
    'K_MSGQ_DEFINE(real, sizeof(struct sample), 3, 4);'
  ].join('\n');
  const result = readSource('src/app.cpp',text);
  assert.deepEqual(result.objects.map(o=>[o.name,o.conditional,o.line]),
    [['active',false,5],['a',true,13],['b',true,17],['real',false,27]]);
});

test('multiline static/dynamic entries and same-name operations are scoped to their functions', () => {
  const code = `static void worker(void *a, void *b, void *c) { k_sem_take(&ready, K_FOREVER); }
K_THREAD_DEFINE(a, 1024, worker, NULL, NULL, NULL, 2, 0, 0);
int main(void) {
  k_thread_create(
    &thread, stack, K_THREAD_STACK_SIZEOF(stack), worker,
    NULL, NULL, NULL, 1, 0, K_NO_WAIT);
  helper("ignore(1,2)", nested(1, 2));
  x->k_thread_create(&unused, stack, 8, worker, 0, 0, 0, 0, 0, 0);
}
void another(void) { k_sem_take(&other, K_FOREVER); }`;
  const result = readSource('a.c',code);
  assert.deepEqual(result.threads.map(t=>[t.name,t.entry,t.priority]),
    [['a','worker','2'],['main','main',undefined],['&thread','worker','1']]);
  const helper = result.calls.find(c=>c.name==='helper');
  assert.deepEqual(helper.args,['"ignore(1,2)"','nested(1, 2)']);
  const workers = result.functions.filter(f=>f.name==='worker');
  assert.equal(workers[0].fileLocal,true);
  assert.equal(result.calls.find(c=>c.object==='ready').ownerId,workers[0].id);
  assert.equal(result.calls.find(c=>c.object==='other').owner,'another');
});

test('only bound IRQ and timer expiry callbacks trigger ISR diagnostics; timer stop and zero wait remain clean', () => {
  const text = `ISR_DIRECT_DECLARE(direct) { k_mutex_lock(&lock,K_NO_WAIT); return 0; }
void irq(void *arg) { k_sem_take(&sem,K_FOREVER); k_sem_take(&sem,( /*poll*/ K_NO_WAIT )); }
void expiry(struct k_timer *t) { k_msgq_get(&q,&v,K_MSEC(2)); }
void stop(struct k_timer *t) { k_mutex_lock(&lock,K_FOREVER); }
void unrelated(void) { k_sem_take(&sem,K_FOREVER); }
K_TIMER_DEFINE(timer,expiry,stop);
void init(void) { IRQ_CONNECT(1,2,irq,NULL,0); }
#if MAYBE
IRQ_CONNECT(2, 0, unrelated, NULL, 0);
#endif`;
  const r = readSource('main.c',text,true);
  assert.deepEqual(r.diagnostics.map(d=>[d.owner,d.name,d.rule]),
    [['direct','k_mutex_lock','isr-mutex'],['irq','k_sem_take','isr-timeout'],['expiry','k_msgq_get','isr-timeout']]);
  assert.ok(r.diagnostics.every(d=>d.id && d.file && d.line && d.message));
  assert.equal(readSource('separate.c','static void irq(void) { k_mutex_lock(&lock, K_FOREVER); }').diagnostics.length,0);
});

test('work handlers, including delayable work on the system queue, report forever waits only', () => {
  const text = `int background(void) { k_sem_take(&sem,K_FOREVER); return 0; }
void task(struct k_work *w) { k_sem_take(&sem,K_FOREVER); k_sem_take(&sem,K_NO_WAIT); }
void later(struct k_work *w) { k_msgq_get(&q,&v,K_FOREVER); }
K_WORK_DEFINE(job,task);
void init(void) { k_work_init_delayable(&delay,later); k_work_schedule(&delay,K_SECONDS(1)); }`;
  assert.deepEqual(readSource('work.c',text).diagnostics.map(d=>[d.owner,d.rule]),
    [['task','workqueue-wait'],['later','workqueue-wait']]);
});

test('a straight-line held mutex yields a possible blocking interval, unrelated branches and unlocks do not', () => {
  const body = text => readSource('main.c','void task(void) {'+text+'}').diagnostics.map(d=>d.rule);
  const lock = 'k_mutex_lock(&lock,K_FOREVER);', wait = 'k_sem_take(&sem,K_FOREVER);';
  const release = 'k_mutex_unlock(&lock);';
  assert.deepEqual(body(lock+wait+release),['held-mutex-wait']);
  for (const sample of [lock+release+wait,lock+'helper();'+wait+release,'if (ready) '+lock+wait+release,
    lock+'k_sem_take(&sem,K_NO_WAIT);'+release,lock+wait+'k_mutex_unlock(&other);',lock+lock+release]) {
    assert.deepEqual(body(sample),[]);
  }
});

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(),'Zephyr threads '));
  t.after(()=>fs.rm(base,{recursive:true,force:true}));
  const app = path.join(base,'app'), build=path.join(base,'build');
  await fs.mkdir(app);
  await fs.mkdir(build);
  async function write(file, contents) {
    await fs.mkdir(path.dirname(file),{recursive:true});
    await fs.writeFile(file,contents);
  }
  return {base,app,build,write};
}

test('source scanning and compile database selection isolate adjacent, nested, linked and generated projects',async t=>{
  const {base,app,build,write} = await fixture(t);
  const external = path.join(base,'app-foreign');
  const main = 'int main(void) { return 0; }';
  await write(path.join(external,'bad.c'),main);
  await write(path.join(app,'src','main.c'),main);
  await write(path.join(app,'second.c'),main);
  await write(path.join(app,'child','CMakeLists.txt'),'find_package(\n Zephyr REQUIRED)');
  await write(path.join(app,'child','src','other.c'),main);
  await write(path.join(app,'generated','CMakeCache.txt'),'');
  await write(path.join(app,'generated','out.c'),main);
  const link = path.join(app,'alias');
  await fs.symlink(external, link, process.platform==='win32'?'junction':'dir');
  const scan = (await analyzeApplication(app)).data;
  assert.equal(scan.coverage.mode,'source');
  assert.deepEqual(scan.files.sort(),['second.c','src/main.c']);
  const db = path.join(build,'compile_commands.json');
  await write(db,JSON.stringify([path.join(app,'src','main.c'),path.join(external,'bad.c'),path.join(link,'bad.c')].map(file=>({file,directory:build}))));
  const {data,locations} = await analyzeApplication(app,build);
  assert.equal(data.coverage.mode,'compilation-database');
  assert.deepEqual(data.files,['src/main.c']);
  assert.equal(data.coverage.omitted,1);
  assert.equal(locations.get(data.threads[0].id).digest, fingerprint(main));
  const next = await analyzeApplication(app,build);
  assert.ok(!next.locations.has(data.threads[0].id), 'Source links from an earlier scan must not locate another row');
  await write(db,'[]');
  assert.deepEqual((await analyzeApplication(app,build)).data.files,[]);
  await write(db,'{bad');
  assert.equal((await analyzeApplication(app,build)).data.coverage.databaseIssue,'invalid');
  assert.equal(await analyzeApplication(app,build,true,()=>false),undefined);
});

test('analysis reports truncated calls and oversized files', async t=>{
  const {app,write} = await fixture(t);
  await write(path.join(app,'many.c'),'void worker(void) {\n'+'call();\n'.repeat(2050)+'}');
  await write(path.join(app,'big.c'),' '.repeat(256*1024+1));
  const {data,locations} = await analyzeApplication(app);
  assert.equal(data.coverage.partial,true);
  assert.equal(data.coverage.omitted,1);
  assert.equal(data.calls.length,2000);
  assert.equal(locations.size,2001);
});

test('all exported exercises produce the same thread entries, kernel declarations and calls when re-read', () => {
  for (const kind of model.kinds) for (const creation of ['static','dynamic']) {
    const draft = {...model.defaults(kind),creation}, expected = model.describe(draft);
    const actual = readSource('src/main.c',model.generate(draft)['src/main.c']);
    assert.deepEqual(actual.threads.map(t=>t.entry).sort(),[...expected.threads.map(t=>t.entry),'main'].sort());
    for (const thread of expected.threads) {
      const entry = actual.threads.find(t=>t.entry === thread.entry);
      assert.equal(entry.line,thread.registrationLine);
      assert.equal(entry.api,creation === 'dynamic' ? 'k_thread_create' : 'K_THREAD_DEFINE');
    }
    assert.deepEqual(actual.objects.map(o=>[o.name,o.line]),[[expected.object.name,expected.object.line]]);
    for (const thread of expected.threads) {
      assert.deepEqual(actual.calls.filter(c=>c.owner===thread.entry && c.name!=='ARG_UNUSED').map(c=>[c.name,c.line]),
        thread.calls.map(c=>[c.name,c.line]));
    }
    assert.deepEqual(actual.diagnostics,[]);
  }
});
