'use strict';

// DAP frame and variable handles have meaning only during their own suspension.
const ROW_LIMIT = 64;
const FRAME_LIMIT = 32;
const resumes = new Set(['continue','next','stepIn','stepOut','stepBack','reverseContinue',
  'restartFrame','goto','restart','disconnect','terminate']);

function emptyRows() {
  return {threads:[], frames:[], scopes:[], variables:[], threadId:null, frameId:null,
    scopeReference:null, busy:false, truncated:false, error:''};
}

const text = value => typeof value === 'string' ? value.slice(0,2048) : '';
const folderKey = folder => folder?.uri.toString();
const contains = (rows, id) => rows.some(row => row.id === id);

class Suspension {
  constructor(session) {
    this.session = session;
    this.phase = 'unknown';
    this.reason = '';
    this.all = false;
    this.stopped = new Set();
    this.resumed = new Set();
    this.version = 0;
    this.rows = emptyRows();
  }

  get token() { return this.session.id + ':' + this.version; }

  invalidate() {
    this.version++;
    this.rows = emptyRows();
  }

  isStopped(id) {
    return this.phase === 'stopped' && (this.stopped.has(id) || (this.all && !this.resumed.has(id)));
  }

  stop(body) {
    this.invalidate();
    if (body.allThreadsStopped === true) {
      this.all = true;
      this.resumed.clear();
    }
    if (Number.isInteger(body.threadId)) {
      this.stopped.add(body.threadId);
      this.resumed.delete(body.threadId);
    }
    this.phase = 'stopped';
    this.reason = text(body.reason);
  }

  resume(thread, partial) {
    this.invalidate();
    if (partial && Number.isInteger(thread)) {
      this.stopped.delete(thread);
      this.resumed.add(thread);
    } else {
      this.all = false;
      this.stopped.clear();
      this.resumed.clear();
    }
    this.phase = this.all || this.stopped.size ? 'stopped' : 'running';
    if (this.phase === 'running') this.reason = '';
  }

  readPlan(action,id) {
    switch (action) {
      case 'threads':
        return {command:'threads', args:{}, field:'threads', rows:'threads', limit:ROW_LIMIT,
          map:t => ({id:t.id, name:text(t.name), stopped:this.isStopped(t.id)})};
      case 'stack':
        if (!this.isStopped(id) || !contains(this.rows.threads,id)) return;
        return {command:'stackTrace', args:{threadId:id,startFrame:0,levels:FRAME_LIMIT}, field:'stackFrames',
          rows:'frames', limit:FRAME_LIMIT, map:f => ({id:f.id, name:text(f.name), path:text(f.source?.path), line:f.line})};
      case 'scopes':
        if (!contains(this.rows.frames,id)) return;
        return {command:'scopes', args:{frameId:id}, field:'scopes', rows:'scopes', limit:ROW_LIMIT,
          map:s => ({name:text(s.name), reference:s.variablesReference, expensive:s.expensive === true})};
      case 'variables':
        if (!(id > 0) || !this.rows.scopes.some(s => s.reference === id)) return;
        return {command:'variables', args:{variablesReference:id,start:0,count:ROW_LIMIT}, field:'variables',
          rows:'variables', limit:ROW_LIMIT, map:v => ({name:text(v.name), value:text(v.value),
            type:text(v.type), lazy:v.presentationHint?.lazy === true})};
    }
  }

  beginRead(action,id) {
    const plan = this.readPlan(action,id);
    if (!plan || this.phase !== 'stopped') return;
    const previous = this.rows;
    this.invalidate();
    if (action !== 'threads') Object.assign(this.rows,{threads:previous.threads,threadId:action === 'stack' ? id : previous.threadId});
    if (action === 'scopes' || action === 'variables')
      Object.assign(this.rows,{frames:previous.frames,frameId:action === 'scopes' ? id : previous.frameId});
    if (action === 'variables') Object.assign(this.rows,{scopes:previous.scopes,scopeReference:id});
    this.rows.busy = true;
    return plan;
  }

  async read(plan) {
    const {command,args,field,rows:destination,limit,map} = plan;
    const version = this.version;
    try {
      const response = await this.session.customRequest(command,args);
      if (version !== this.version) return;
      let rows = response?.[field];
      if (!Array.isArray(rows)) throw Error('DAP: ' + field + '[]');
      if (command === 'threads' && rows.length > limit) {
        rows = rows.filter(t => this.isStopped(t.id)).concat(rows.filter(t => !this.isStopped(t.id)));
      }
      this.rows[destination] = rows.slice(0,limit).map(map);
      this.rows.truncated = rows.length > limit ||
        (command === 'stackTrace' && (response.totalFrames ?? (rows.length === limit ? Infinity : rows.length)) > limit) ||
        (command === 'variables' && rows.length === limit);
    } catch (error) {
      if (version !== this.version) return;
      this.rows.error = text(error.message) || command;
    }
    this.rows.busy = false;
  }
}

/** Track DAP lifecycle from activation; opening the view never starts or interrupts a target. */
class ThreadDebug {
  constructor(debug, changed = () => {}) {
    this.debug = debug;
    this.observers = new Set([changed]);
    this.records = new Map();
    this.choices = new Map();
    this.listeners = [
      debug.registerDebugAdapterTrackerFactory('*',{createDebugAdapterTracker:session => this.tracker(session)}),
      debug.onDidStartDebugSession(session => { this.add(session); this.changed(); }),
      debug.onDidTerminateDebugSession(session => this.remove(session)),
      debug.onDidChangeActiveDebugSession(session => { if (session) this.add(session); this.changed(); })
    ];
    if (debug.activeDebugSession) this.add(debug.activeDebugSession);
  }

  onDidChange(listener) {
    this.observers.add(listener);
    return {dispose:() => this.observers.delete(listener)};
  }

  changed() { for (const listener of this.observers) listener(); }

  add(session) {
    if (!session.workspaceFolder) return;
    if (!this.records.has(session.id)) this.records.set(session.id,new Suspension(session));
    return this.records.get(session.id);
  }

  remove(session) {
    const record = this.records.get(session.id);
    if (!record) return;
    record.invalidate();
    this.records.delete(session.id);
    const key = folderKey(session.workspaceFolder);
    if (this.choices.get(key) === session.id) this.choices.delete(key);
    this.changed();
  }

  tracker(session) {
    const record = this.add(session);
    if (!record) return;
    let pendingResume;
    return {
      onWillReceiveMessage:message => {
        if (message.type !== 'request' || !resumes.has(message.command)) return;
        const before = {phase:record.phase, reason:record.reason, all:record.all,
          stopped:new Set(record.stopped), resumed:new Set(record.resumed)};
        pendingResume = {seq:message.seq, thread:message.arguments?.threadId, before};
        record.resume(message.arguments?.threadId, message.arguments?.singleThread === true);
        this.changed();
      },
      onDidSendMessage:message => {
        if (message.type === 'response' && pendingResume && message.request_seq === pendingResume.seq) {
          const {before,thread} = pendingResume;
          pendingResume = undefined;
          if (!message.success || message.command === 'continue') {
            Object.assign(record,before);
            if (message.success) record.resume(thread,message.body?.allThreadsContinued === false);
            else record.invalidate();
            this.changed();
          }
          return;
        }
        if (message.type !== 'event') return;
        const body = message.body || {};
        switch (message.event) {
          case 'stopped': pendingResume = undefined; record.stop(body); break;
          case 'continued': pendingResume = undefined; record.resume(body.threadId, body.allThreadsContinued === false); break;
          case 'invalidated': record.invalidate(); break;
          case 'thread':
            pendingResume = undefined;
            if (record.phase !== 'stopped') return;
            record.resume(body.threadId,true);
            break;
          case 'exited':
          case 'terminated': return this.remove(session);
          default: return;
        }
        this.changed();
      },
      onExit:() => this.remove(session)
    };
  }

  matching(folder) {
    const key = folderKey(folder);
    return [...this.records.values()].filter(r => key && folderKey(r.session.workspaceFolder) === key);
  }

  current(folder, choices = this.matching(folder)) {
    const id = this.choices.get(folderKey(folder));
    return choices.find(r => r.session.id === id) ||
      choices.find(r => r.session.id === this.debug.activeDebugSession?.id) || choices[0];
  }

  snapshot(folder) {
    const choices = this.matching(folder);
    const current = this.current(folder,choices);
    const sessions = choices.map(({session}) => ({id:session.id, name:session.name, type:session.type}));
    return {phase:current?.phase || 'disconnected', reason:current?.reason || '', sessions,
      sessionId:current?.session.id, image:text(current?.session.configuration?.executable || current?.session.configuration?.program), token:current?.token || '', ...(current?.rows || emptyRows())};
  }

  async request(folder, action, id, token) {
    const choices = this.matching(folder);
    const current = this.current(folder,choices);
    if (!current || token !== current.token) return;
    if (action === 'session') {
      const selected = choices.find(r => r.session.id === id);
      if (!selected || selected === current) return;
      current.invalidate();
      selected.invalidate();
      this.choices.set(folderKey(folder),id);
      this.changed();
      return;
    }
    const plan = current.beginRead(action,id);
    if (!plan) return;
    this.changed();
    await current.read(plan);
    if (this.current(folder) === current) this.changed();
  }

  dispose() {
    for (const subscription of this.listeners) subscription.dispose();
    for (const record of this.records.values()) record.invalidate();
    this.records.clear();
    this.choices.clear();
    this.observers.clear();
  }
}

module.exports = {ThreadDebug};
