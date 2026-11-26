'use strict';

(function () {
  const model = typeof module === 'object' && module.exports ? require('./programModel') : globalThis.ZephyrProgramModel;
  const object_ops = new Set(Object.values(model.operations).flat());
  const roots = graph => [{id:'$main', name:'main', steps:graph.mainSteps || []}, ...graph.threads];

  // Keep lexical ownership separate from possible execution contexts of a shared function.
  function collect_accesses(steps, owner, objects, by_step) {
    for (const step of steps) {
      if (object_ops.has(step.op)) {
        const access = {step, owner, contexts:[]};
        objects.get(step.object).accesses.push(access);
        by_step.set(step.id, access);
      }
      if (step.op === 'repeat' || step.op === 'if') collect_accesses(step.steps, owner, objects, by_step);
      if (step.op === 'if') collect_accesses(step.elseSteps, owner, objects, by_step);
    }
  }

  function object_accesses(graph, contexts) {
    const objects = new Map(graph.objects.map(object => [object.id, {object, accesses:[], actors:new Set()}]));
    const by_step = new Map();
    for (const owner of [...roots(graph), ...(graph.functions || [])]) {
      collect_accesses(owner.steps, owner.id, objects, by_step);
    }
    for (const [actor, steps] of contexts) {
      for (const step of steps.values()) {
        const access = by_step.get(step.id);
        if (!access) continue;
        access.contexts.push(actor);
        objects.get(step.object).actors.add(actor);
      }
    }
    return {objects, by_step};
  }

  function peer_finding(accesses) {
    const active = accesses.filter(access => access.contexts.length);
    const has = op => active.some(access => access.step.op === op);
    if (has('receive') && !has('send')) return ['missing_send', 'receive'];
    if (has('take') && !has('give')) return ['missing_give', 'take'];
    if (has('send') && !has('receive')) return ['buffer_only', 'send'];
  }

  // Unroll calls only on an unconditional prefix; a call DAG can otherwise expand exponentially.
  function* straight_prefix(steps, functions, budget) {
    for (const step of steps) {
      if (--budget.remaining < 0 || ['if','repeat','external'].includes(step.op)) return false;
      if (step.op === 'call') {
        if (!(yield* straight_prefix(functions.get(step.function).steps, functions, budget))) return false;
      } else {
        yield step;
      }
    }
    return true;
  }

  function first_wait(context, functions, objects) {
    const counts = new Map();
    for (const step of straight_prefix(context.steps, functions, {remaining:4096})) {
      const entry = objects.get(step.object);
      if (!entry || entry.actors.size !== 1 || !object_ops.has(step.op)) continue;
      const available = counts.get(step.object) || 0;
      if ((step.op === 'receive' || step.op === 'take') && !available) return {rule:'wait_empty', step};
      if (step.op === 'send' && available === entry.object.capacity) return {rule:'wait_full', step};
      if (step.op === 'receive' || step.op === 'take') counts.set(step.object, available - 1);
      if (step.op === 'send' || step.op === 'give') counts.set(step.object, Math.min(available + 1, entry.object.capacity));
    }
  }

  /** Report findings only for graph-visible accesses. Firmware hooks and interrupts may supply other peers. */
  function analyze(graph) {
    if (model.validate(graph).length) return {objects:new Map(), by_step:new Map(), findings:[]};
    const contexts = model.execution_contexts(graph);
    const {objects, by_step} = object_accesses(graph, contexts);
    const findings = new Map();
    for (const {object, accesses} of objects.values()) {
      const peer = peer_finding(accesses);
      if (!peer) continue;
      const access = accesses.find(a => a.contexts.length && a.step.op === peer[1]);
      const rule = peer[0];
      findings.set(object.id, {rule, severity:rule === 'buffer_only' ? 'info' : 'warning', object, access});
    }
    const functions = new Map((graph.functions || []).map(fn => [fn.id,fn]));
    const has_hook = [...contexts.values()].some(steps => [...steps.values()].some(s => s.op === 'external'));
    if (!has_hook) {
      for (const context of roots(graph)) {
        const wait = first_wait(context, functions, objects);
        if (!wait) continue;
        const {step,rule} = wait;
        if (findings.has(step.object) && rule === 'wait_empty') continue;
        findings.set(step.object, {rule, severity:'warning', object:objects.get(step.object).object, access:by_step.get(step.id)});
      }
    }
    return {objects, by_step, findings:[...findings.values()]};
  }

  function finding_label(t, finding) {
    const {rule,object} = finding;
    switch (rule) {
      case 'missing_send': return t('接收端使用 K_FOREVER，图中没有可达的发送步骤。','Receive uses K_FOREVER with no reachable send in the graph.');
      case 'missing_give': return t('初始许可为 0，图中没有可达的释放步骤。','The semaphore starts at zero with no reachable give in the graph.');
      case 'buffer_only': return t('图中没有接收端。达到容量 '+object.capacity+' 后再次发送会等待。','No receiver in the graph. Another send waits once the queue reaches capacity '+object.capacity+'.');
      case 'wait_empty': return object.kind === 'sem' ?
        t('按此上下文的步骤顺序，执行到这里时没有可用许可。请提前释放或由另一线程释放。','On reaching this step, this context has no permit available. Give earlier or from another thread.') :
        t('按此上下文的步骤顺序，执行到这里时队列为空。请提前发送或由另一线程发送。','On reaching this step, this context has no message available. Send earlier or from another thread.');
      case 'wait_full': return t('执行到本次发送时队列已满。请在此之前取走消息或安排另一个接收线程。','The queue is full on reaching this send. Receive earlier or add a receiving thread.');
    }
  }

  class review_panel {
    constructor(ctx) {
      this.ctx = ctx;
      const {el} = ThreadStudioUI;
      this.accesses = el('section','vp-review-access');
      this.summary = el('summary');
      this.list = el('div','vp-review-list');
      this.checks = el('details','vp-review-checks',this.summary,this.list);
      this.root = el('section','vp-review',this.accesses,this.checks);
      this.checks.addEventListener('toggle', () => this.draw_findings());
    }

    jump(step_id) {
      this.ctx.mode = 'flow';
      this.ctx.connecting = null;
      this.ctx.selectStep(step_id);
      this.ctx.canvas.center(step_id);
      this.ctx.setDrawer('right');
    }

    draw_findings() {
      if (!this.checks.open || !this.report) return;
      const {el,button} = ThreadStudioUI, {t} = this.ctx;
      const rows = this.report.findings.map(finding => {
        const row = button('', () => this.jump(finding.access.step.id));
        const level = finding.severity === 'info' ? t('缓冲容量','Buffer capacity') : t('等待风险','Wait risk');
        row.append(el('strong','',finding.object.name+' · '+level), el('span','',finding_label(t,finding)));
        row.dataset.reviewStep = finding.access.step.id;
        return row;
      });
      const scope = t('依据图内的调用、队列容量和许可。外设、中断与手写 C 可能提供其他访问端。','Checks use calls, queue capacity and permits in this graph. Drivers, interrupts or hand-written C may add peers.');
      this.list.replaceChildren(el('p','vp-muted',scope),...rows);
    }

    draw_accesses(selected) {
      const {el,button} = ThreadStudioUI, {t} = this.ctx;
      this.accesses.hidden = !selected;
      if (!selected) { this.accesses.replaceChildren(); return; }
      const buttons = selected.accesses.map(access => {
        const name = id => this.names.get(id) || id;
        const actors = access.contexts.length ? access.contexts.map(name).join(', ') : t('入口与线程均未调用','Uncalled by main or threads');
        const owner = this.ctx.api(access.step.op)+' · '+name(access.owner);
        const row = button('', () => this.jump(access.step.id));
        row.append(el('span','',owner),el('small','vp-muted',t('上下文','Contexts')+' · '+actors));
        row.dataset.accessStep = access.step.id;
        return row;
      });
      const object = selected.object;
      this.accesses.replaceChildren(el('h3','',t('访问端','Accesses')+' · '+object.name),
        buttons.length ? el('div','vp-review-list',...buttons) : el('p','vp-muted',t('尚无访问步骤。','No access steps yet.')));
    }

    update() {
      this.root.hidden = Boolean(this.ctx.diagnostics.length);
      if (this.root.hidden) return;
      if (!this.report) {
        this.report = analyze(this.ctx.graph);
        this.names = new Map([...roots(this.ctx.graph), ...(this.ctx.graph.functions || [])].map(n => [n.id,n.name]));
      }
      const {t} = this.ctx;
      const id = this.ctx.stepId ? this.report.by_step.get(this.ctx.stepId)?.step.object : this.ctx.selected;
      this.draw_accesses(this.report.objects.get(id));
      this.summary.textContent = t('并发检查','Concurrency checks')+' · '+this.report.findings.length;
      this.draw_findings();
    }
  }

  const api = {analyze, review_panel};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.ZephyrProgramReview = api;
}());
