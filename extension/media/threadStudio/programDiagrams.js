'use strict';

(function () {
  const PAGE_SIZE = 16;
  const hook_id = name => '@hook:' + name;
  const flow = () => globalThis.ZephyrProgramFlow;
  const reverse = op => op === 'take' || op === 'receive';

  /** Group graph-visible accesses at their transfer object without choosing a runtime schedule. */
  function pipeline(graph) {
    const owners = flow().owners(graph);
    const rows = new Map(), used = new Set();
    const row = (id, name, kind, object) => {
      if (!rows.has(id)) rows.set(id, {id, name, kind, object, inputs:[], outputs:[]});
      return rows.get(id);
    };
    for (const obj of graph.objects) row(obj.id, obj.name, obj.kind, obj);
    for (const owner of owners.filter(o => o.role === 'function')) row(owner.id, owner.name, 'function');
    for (const owner of owners) flow().walk(owner.steps, step => {
      let group = rows.get(step.object);
      if (step.op === 'call') group = rows.get(step.function);
      if (step.op === 'external') group = row(hook_id(step.symbol), step.symbol, 'external');
      if (!group) return;
      used.add(owner.id);
      const end = {actor:owner, step};
      (reverse(step.op) ? group.outputs : group.inputs).push(end);
      if (step.op === 'external' || step.op === 'call') group.outputs.push(end);
    });
    const isolated = owners.filter(o => o.role !== 'function' && !used.has(o.id));
    return {groups:[...rows.values()], isolated};
  }

  /** Attribute a call to its defining function and retain the executing thread separately. */
  function sequence_index(graph) {
    const names = new Map(), owners = new Map();
    for (const owner of flow().owners(graph)) {
      names.set(owner.id, owner.name);
      flow().walk(owner.steps, step => owners.set(step.id, owner.id));
    }
    for (const object of graph.objects) names.set(object.id, object.name);
    return {names, owners};
  }

  function message(row, index) {
    if (row.kind !== 'event') return {kind:row.kind, line:row.line, count:row.count};
    const actor = index.owners.get(row.stepId) || row.contextId;
    let from = actor, to = actor;
    if (row.objectId) {
      if (reverse(row.op)) from = row.objectId;
      else to = row.objectId;
    } else if (row.phase) {
      const endpoint = row.op === 'external' ? hook_id(row.callee) : row.callee;
      if (row.phase === 'return') from = endpoint;
      else to = endpoint;
    }
    return {...row, from, to};
  }

  function sequence_page(data, index, requested) {
    const rows = data?.rows || [], pages = Math.ceil(rows.length / PAGE_SIZE);
    const page = Math.max(0, Math.min(requested, pages - 1)), start = page * PAGE_SIZE;
    const events = rows.slice(start, start + PAGE_SIZE).map(r => message(r, index));
    const lanes = new Set();
    for (const event of events) if (event.kind === 'event') { lanes.add(event.from); lanes.add(event.to); }
    return {events, lanes:[...lanes], start:(data?.first || 0) + start, page, pages};
  }

  const svg_ns = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs) {
    const item = document.createElementNS(svg_ns, tag);
    for (const [key, value] of Object.entries(attrs)) item.setAttribute(key, value);
    return item;
  }

  function arrow(from, to, count, returning) {
    const x = from * 100 + 50, end = to * 100 + 50, sign = from < to ? 1 : -1;
    const track = svg('svg', {class:'vp-event-arrow', viewBox:'0 0 '+count*100+' 36', preserveAspectRatio:'none', 'aria-hidden':true});
    const self = from === to, y = self ? 25 : 18, direction = self ? -1 : sign;
    const line = self ? 'M '+x+' 9 h 24 v 16 H '+end : 'M '+x+' 18 H '+end;
    track.append(svg('path', {d:line, class:returning ? 'vp-return' : ''}),
      svg('polyline', {points:[end-direction*6,y-4,end,y,end-direction*6,y+4].join(' ')}));
    return track;
  }

  const diagnostics = {
    loss:['日志报告丢失','Logger reported loss'], gap:['记录中断','Capture gap'], foreign:['其他构建','Different build'],
    malformed:['记录格式异常','Malformed record'], unmapped:['步骤无法匹配','Unmapped step'],
    inconsistent:['记录值与分支矛盾','Inconsistent branch']
  };

  class diagram_panel {
    constructor(editor) {
      this.editor=editor; this.t=editor.t;
      this.el=ThreadStudioUI.el; this.button=ThreadStudioUI.button;
      this.root=this.el('section','vp-projection'); this.root.hidden=true;
      this.page=0;
    }

    reset() {
      this.page=0; this.data=undefined; this.position=-1; this.painted=undefined;
    }

    records(data,position,seek) {
      const moved=this.position!==position || this.data!==data;
      if (this.data!==data) this.page=0;
      this.data=data; this.position=position; this.seek=seek;
      if (moved && position >= (data?.first || 0)) this.page=Math.floor((position-(data?.first || 0))/PAGE_SIZE);
      if (this.editor.mode==='sequence' && this.index) this.draw_sequence();
    }

    show(mode, graph) {
      this.root.hidden=mode!=='sequence' && mode!=='pipeline';
      if (this.root.hidden) return;
      const focused=this.root.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
      if (mode==='pipeline') this.draw_pipeline(graph);
      else {this.index=sequence_index(graph);this.painted=undefined;this.draw_sequence();}
      if (focused) Array.from(this.root.querySelectorAll('[data-focus-key]')).find(b=>b.dataset.focusKey===focused)?.focus({preventScroll:true});
    }

    step_button(endpoint, outgoing, kind) {
      const {actor,step}=endpoint;
      const open=()=>{this.editor.selectStep(step.id);this.editor.setDrawer('right');};
      const b=this.button('',open,'vp-endpoint');
      b.dataset.focusKey=(outgoing?'out:':'in:')+step.id;
      const operation=(kind==='function'||kind==='external') ?
        (outgoing?this.t('返回','Return'):this.t('调用','Call')) : this.editor.api(step.op);
      b.append(this.el('strong','',actor.name),this.el('small','',operation+' · '+step.id));
      b.setAttribute('aria-pressed',String(this.editor.stepId===step.id));
      return b;
    }

    route(group) {
      const t=this.t;
      const side=(ends,outgoing)=>this.el('div','vp-endpoints',...(ends.length ?
        ends.map(end=>this.step_button(end,outgoing,group.kind)) : [this.el('span','vp-muted',t('无图内端点','No graph endpoint'))]));
      const center=this.button('',()=>{
        if (group.kind==='external') this.editor.selectStep(group.inputs[0].step.id);
        else this.editor.selectNode(group.id);
        this.editor.setDrawer('right');
      },'vp-transfer');
      center.dataset.focusKey='group:'+group.id;
      const kind=group.kind==='external'?t('驱动接口','Driver hook'):this.editor.kind(group.kind);
      center.append(this.el('strong','',group.name || group.id),
        this.el('small','',kind+(group.object?.capacity!=null?' · '+t('容量 ','Capacity ')+group.object.capacity:'')));
      center.setAttribute('aria-pressed',String(this.editor.selected===group.id));
      const end=group.kind==='mutex' ? this.el('span','vp-muted',t('更新受保护的计数','Protected counter update')) : side(group.outputs,true);
      return this.el('div','vp-route',side(group.inputs,false),this.connector(),center,this.connector(),end);
    }

    connector() {
      const glyph=this.el('span','vp-route-arrow','→');
      glyph.setAttribute('aria-hidden','true');
      return glyph;
    }

    draw_pipeline(graph) {
      const {groups,isolated}=pipeline(graph), t=this.t;
      const heading=this.el('div','vp-route-head',this.el('span','',t('写入或调用','Write or call')),
        this.el('span','',t('通道或接口','Channel or interface')),this.el('span','',t('读取或返回','Read or return')));
      const routes=this.el('div','vp-routes',heading,...groups.map(group=>this.route(group)));
      if (isolated.length) {
        const box=this.el('div','vp-isolated',this.el('small','vp-muted',t('无传输连接','No transfers')));
        for (const node of isolated) {
          const b=this.button(node.name,()=>{this.editor.selectNode(node.id);this.editor.setDrawer('right');});
          b.dataset.focusKey='isolated:'+node.id;
          box.append(b);
        }
        routes.append(box);
      }
      this.root.replaceChildren(routes);
    }

    name(id) { return this.index.names.get(id) || String(id).replace(/^@hook:/,''); }

    event_label(event) {
      const t=this.t;
      if (event.kind!=='event') return [t(...(diagnostics[event.kind]||[event.kind,event.kind])),event.count].filter(v=>v!=null).join(' · ');
      const action=event.phase ? (event.phase==='enter'?t('调用输入','Call input'):t('返回值','Return value')) :
        ['give','take'].includes(event.op) ? this.editor.api(event.op)+' · '+t('局部值','local value') : this.editor.api(event.op);
      return action+' · '+event.value;
    }

    row(event, lanes, position) {
      if (event.kind!=='event') return this.el('div','vp-record-gap','#'+(position+1)+' · '+this.event_label(event));
      const open=()=>{this.editor.selectStep(event.stepId);this.seek?.(position);this.editor.setDrawer('right');};
      const row=this.button('',open,'vp-event-row');
      row.dataset.record=String(position); row.dataset.focusKey='event:'+position;
      const route=this.name(event.from)+' → '+this.name(event.to);
      const title='#'+(position+1)+' · '+this.name(event.contextId)+' · '+event.stepId;
      row.title=title+' · '+route+' · '+this.event_label(event);
      row.setAttribute('aria-label',row.title);
      row.append(this.el('span','vp-seq-description',this.el('small','',title),this.el('strong','',this.event_label(event))),
        this.el('span','vp-lifelines',arrow(lanes.indexOf(event.from),lanes.indexOf(event.to),lanes.length,event.phase==='return')));
      return row;
    }

    navigate(page, direction) {
      this.page=page; this.draw_sequence();
      const controls=this.root.querySelectorAll('.vp-event-nav button');
      (controls[direction]?.disabled ? controls[1-direction] : controls[direction])?.focus({preventScroll:true});
    }

    draw_sequence() {
      if (!this.data?.rows?.length) {
        if (this.painted!==null) this.root.replaceChildren(this.el('p','vp-empty',
          this.t('导入串口日志或播放固件示例，即可查看线程之间的事件顺序。','Import a console log or play the firmware example to see events in execution order.')));
        this.painted=null;return;
      }
      const data=this.data, first=data.first||0, start=Math.max(0,Math.min(this.page,Math.ceil(data.rows.length/PAGE_SIZE)-1))*PAGE_SIZE;
      const stamp=this.painted;
      if (!stamp || stamp.data!==data || stamp.first!==first || stamp.start!==start ||
          stamp.length!==data.rows.length) this.paint_sequence(data);
      for(const row of this.root.querySelectorAll('[data-record]'))
        row.setAttribute('aria-pressed',String(Number(row.dataset.record)===this.position));
    }

    paint_sequence(data) {
      const {events,lanes,start,page,pages}=sequence_page(data,this.index,this.page), t=this.t;
      this.page=page;
      const prev=this.button('‹',()=>this.navigate(page-1,0)), next=this.button('›',()=>this.navigate(page+1,1));
      prev.disabled=page===0; next.disabled=page+1>=pages;
      prev.setAttribute('aria-label',t('上一页事件','Previous event page'));next.setAttribute('aria-label',t('下一页事件','Next event page'));
      const nav=this.el('nav','vp-event-nav',prev,this.el('span','',t('事件 ','Events ')+(start+1)+'–'+(start+events.length)+' · '+(page+1)+' / '+pages),next);
      const head=this.el('div','vp-event-head',this.el('span','vp-seq-description',t('记录 / 线程 / 步骤','Record / thread / step')),
        this.el('div','vp-lane-names',...lanes.map(id=>this.el('span','',this.name(id)))));
      const sheet=this.el('div','vp-event-sheet',head,...events.map((e,i)=>this.row(e,lanes,start+i)));
      sheet.style.setProperty('--lanes',String(Math.max(1,lanes.length)));
      this.root.replaceChildren(nav,this.el('div','vp-seq-scroll',sheet));
      this.painted={data,first:data.first||0,start:page*PAGE_SIZE,length:data.rows.length};
    }
  }

  const api={pipeline,sequence_index,sequence_page,diagram_panel};
  if (typeof module==='object' && module.exports) module.exports=api;
  else globalThis.ZephyrProgramDiagrams=api;
})();
