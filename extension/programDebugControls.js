'use strict';

// Control only the adapter associated with the design's workspace and suspension token.
const stepCommands = new Set(['continue','next','stepIn','stepOut']);

class ProgramDebugControls {
  constructor({runtime,folder,launch,showFrame,report,send,isVisible=() => true}) {
    Object.assign(this,{runtime,folder,launch,showFrame,report,send,isVisible});
    this.subscription = runtime.onDidChange(() => this.refresh());
  }

  current(token) {
    const record = this.runtime.current(this.folder);
    if (record && record.token === token) return record;
  }

  state() {
    const snapshot = this.runtime.snapshot(this.folder);
    const selected = snapshot.sessions.find(s => s.id === snapshot.sessionId);
    return {type:'debugState',active:Boolean(selected),paused:snapshot.phase==='stopped',
      phase:snapshot.phase,reason:snapshot.reason,sessionId:snapshot.sessionId,
      sessions:snapshot.sessions,token:snapshot.token,name:selected?.name || ''};
  }

  refresh() {
    if (this.closed || !this.isVisible()) return;
    const state = this.state();
    if (state.token !== this.location?.token) this.location = undefined;
    this.send({...state,...this.location?.data});
    const record = this.current(state.token);
    if (!state.paused || !record || this.location) return;
    const lookup = this.location = {token:state.token,data:{}};
    this.readFrame(record,lookup).catch(error => {
      if (this.location===lookup && !this.closed) this.report(String(error.message || error));
    });
  }

  async readFrame(record,lookup) {
    const sameStop = () => !this.closed && this.location===lookup && this.current(lookup.token)===record;
    const {threads=[]} = await record.session.customRequest('threads',{});
    if (!sameStop()) return;
    const selected = this.runtime.debug.activeStackItem;
    const stopped = threads.filter(t => Number.isSafeInteger(t.id) && record.isStopped(t.id));
    const thread = stopped.find(t => selected?.session?.id===record.session.id && t.id===selected.threadId)
      || stopped.find(t => record.stopped.has(t.id)) || stopped[0];
    if (!thread) return;
    lookup.data.thread = {id:thread.id,name:thread.name};
    this.send({...this.state(),...lookup.data});
    const response = await record.session.customRequest('stackTrace',{threadId:thread.id,startFrame:0,levels:1});
    const top = response?.stackFrames?.[0];
    if (!sameStop() || !top) return;
    lookup.data.frame = {name:top.name,path:top.source?.path,line:top.line};
    this.send({...this.state(),...lookup.data});
  }

  async handle({op='start',token,id}) {
    if (this.closed || !this.folder) return;
    if (op==='start') return this.launch(this.folder);
    const record = this.current(token);
    if (!record) return;
    if (op==='session') return this.runtime.request(this.folder,'session',id,token);
    if (op==='stop') return this.runtime.debug.stopDebugging(record.session);
    if (op==='pause' && record.phase!=='stopped') {
      const {threads=[]} = await record.session.customRequest('threads',{});
      const thread = threads.find(t => Number.isSafeInteger(t.id));
      if (!this.closed && this.current(token)===record && thread)
        return record.session.customRequest('pause',{threadId:thread.id});
      return;
    }
    const location = this.location;
    if (record.phase!=='stopped' || location?.token!==token) return;
    if (op==='frame' && location.data.frame) return this.showFrame(location.data.frame,this.folder);
    const thread = location.data.thread;
    if (thread && record.isStopped(thread.id) && stepCommands.has(op))
      return record.session.customRequest(op,{threadId:thread.id});
  }

  dispose() { this.closed=true; this.subscription.dispose(); }
}

module.exports = {ProgramDebugControls};
