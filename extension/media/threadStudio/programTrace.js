'use strict';

(function () {
  const model = typeof module === 'object' && module.exports ? require('./programModel') : globalThis.ZephyrProgramModel;
  const MAX_BYTES = 4 * 1024 * 1024;
  const MAX_ROWS = 20000;
  const token = '[A-Za-z][A-Za-z0-9_-]{0,63}';
  const format = new RegExp('^ZVTRACE\\s+1\\s+([0-9a-f]{16})\\s+(\\$main|'+token+')\\s+('+token+')\\s+(-|'+token+')\\s+('+token+')\\s+(\\d{1,10})\\s*$');
  const lossMarker = /(?:^|\s)---\s+(\d{1,10})\s+messages?\s+dropped\s+---\s*$/i;
  const objectOperations = new Set(Object.values(model.operations).flat());

  // A function can be shared. Only accept an event in a context with a path to that step.
  function executionContexts(graph) {
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

  function recordedLine(text, line, fingerprint, contexts) {
    const cleaned = text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').trim();
    const loss = lossMarker.exec(cleaned);
    if (loss) return {kind:'loss',line,count:Number(loss[1])};
    const start = /(?:^|\s)(ZVTRACE\b)/.exec(cleaned);
    if (!start) return;
    const record = format.exec(cleaned.slice(start.index).trimStart());
    if (!record || Number(record[6]) > 0xffffffff) return {kind:'malformed',line};
    const [,captureId,contextId,stepId,object,op,value] = record;
    if (captureId !== fingerprint) return {kind:'foreign',line,fingerprint:captureId};
    const step = contexts.get(contextId)?.get(stepId);
    const expectedOp = op === 'if-then' || op === 'if-else' ? 'if' : op;
    if (!step || expectedOp !== step.op || op === 'if' || object !== (objectOperations.has(op) ? step.object : '-')) {
      return {kind:'unmapped',line};
    }
    return {kind:'event',line,fingerprint,contextId,stepId,objectId:object === '-' ? null : object,op,value:Number(value)};
  }

  /** Parse one bounded UTF-8 console capture in file order. Ordinary console output is ignored.
   *  Loss markers identify reported losses, not all missing lines or missing graph events. */
  function parse(text,graph) {
    const fingerprint = model.fingerprint(graph);
    if (!fingerprint) throw new RangeError('invalid-model');
    if (typeof text !== 'string' || text.length > MAX_BYTES || new TextEncoder().encode(text).length > MAX_BYTES) {
      throw new RangeError('file-size');
    }
    const contexts = executionContexts(graph);
    const rows = [];
    const counts = counters();
    let start = 0, line = 1, truncated = false;
    while (start < text.length) {
      const end = text.indexOf('\n',start);
      const row = recordedLine(text.slice(start,end < 0 ? text.length : end),line,fingerprint,contexts);
      if (row) {
        if (rows.length >= MAX_ROWS) {truncated=true; break;}
        rows.push(row);
        counts[row.kind]++;
      }
      if (end < 0) break;
      start=end+1;
      line++;
    }
    return {fingerprint,rows,counts,truncated};
  }

  const LIVE_ROWS = 2048, MAX_LINE = 4096;

  function counters() {
    return {event:0,foreign:0,malformed:0,loss:0,unmapped:0,gap:0};
  }

  // A chunk may split a UTF-8-decoded line anywhere. Never emit a partial printk record.
  class TraceStream {
    constructor(graph) {
      this.fingerprint=model.fingerprint(graph);
      if (!this.fingerprint) throw new RangeError('invalid-model');
      this.contexts=executionContexts(graph);
      this.rows=[];
      this.counts=counters();
      this.line=1;
      this.first=0;
      this.partial='';
      this.skipPartial=false;
    }

    append(chunk,gap=false) {
      if (typeof chunk !== 'string' || chunk.length > MAX_BYTES) throw new RangeError('file-size');
      const rows=[];
      if (gap) {
        rows.push({kind:'gap',line:this.line});
        this.partial='';
        this.skipPartial=true;
      }
      for (let start=0;start<chunk.length;) {
        const newline=chunk.indexOf('\n',start);
        const end=newline<0 ? chunk.length : newline;
        if (!this.skipPartial && this.partial.length+end-start > MAX_LINE) {
          this.skipPartial=true;
          this.partial='';
          rows.push({kind:'gap',line:this.line});
        }
        if (!this.skipPartial) this.partial+=chunk.slice(start,end);
        if (newline<0) break;
        if (!this.skipPartial) {
          const row=recordedLine(this.partial,this.line,this.fingerprint,this.contexts);
          if (row) rows.push(row);
        }
        this.partial='';
        this.skipPartial=false;
        this.line++;
        start=end+1;
      }
      for (const row of rows) this.counts[row.kind]++;
      const discard=Math.max(0,this.rows.length+rows.length-LIVE_ROWS);
      if (rows.length>=LIVE_ROWS) this.rows=rows.slice(-LIVE_ROWS);
      else {
        if (discard) this.rows.splice(0,discard);
        for (const row of rows) this.rows.push(row);
      }
      this.first+=discard;
      return rows.length;
    }

    finish() {
      if (!this.partial) return 0;
      return this.append('',true);
    }
  }

  const api = {MAX_BYTES,MAX_ROWS,LIVE_ROWS,TraceStream,parse};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.ZephyrProgramTrace = api;
}());
