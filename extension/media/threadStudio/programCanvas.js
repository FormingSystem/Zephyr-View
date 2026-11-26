'use strict';

globalThis.ZephyrProgramCanvas = (() => {
  const namespace = 'http://www.w3.org/2000/svg';
  const width = 184, height = 64;
  function svg(tag, attributes = {}, text) {
    const node = document.createElementNS(namespace,tag);
    for (const [key,value] of Object.entries(attributes)) node.setAttribute(key,value);
    if (text != null) node.textContent = text;
    return node;
  }
  // Place reachable nodes in flow order; cycles start a new component at the first unplaced node.
  function layout(nodes,edges) {
    const ranks = new Map(), slots = new Map(), positions = new Map();
    const incoming = new Set(edges.map(e=>e.to));
    const outgoing = new Map();
    for (const e of edges) {
      if (!outgoing.has(e.from)) outgoing.set(e.from,[]);
      outgoing.get(e.from).push(e.to);
    }
    const queue = nodes.filter(n=>!incoming.has(n.id)).map(n=>[n.id,0]);
    let cursor = 0;
    while (ranks.size < nodes.length) {
      if (cursor === queue.length) {
        const root = nodes.find(n=>!ranks.has(n.id));
        if (!root) break;
        queue.push([root.id,0]);
      }
      const [id,rank] = queue[cursor++];
      if (ranks.has(id)) continue;
      ranks.set(id,rank);
      for (const target of outgoing.get(id)||[]) if (!ranks.has(target)) queue.push([target,rank+1]);

    }
    for (const node of nodes) {
      const rank = ranks.get(node.id) || 0;
      const slot = slots.get(rank) || 0;
      slots.set(rank,slot+1);
      positions.set(node.id,{x: Number.isFinite(node.x)&&Math.abs(node.x)<=1e6?node.x:rank*261,
        y: Number.isFinite(node.y)&&Math.abs(node.y)<=1e6?node.y:slot*118});
    }
    return positions;
  }
  // Try positions along the actual cubic so neighboring links keep distinct readable labels.
  function captionPosition(curve,label,obstacles,labels) {
    const half=Math.min(100,label.length*3.2+2);
    for(const t of [.5,.35,.65,.2,.8]){
      const u=1-t;
      const x=u*u*u*curve[0].x+3*u*u*t*curve[1].x+3*u*t*t*curve[2].x+t*t*t*curve[3].x;
      const base=u*u*u*curve[0].y+3*u*u*t*curve[1].y+3*u*t*t*curve[2].y+t*t*t*curve[3].y;
      for(const offset of [-6,12,-17,23]){
        const y=base+offset,box={l:x-half,r:x+half,t:y-9,b:y+3};
        const overlaps=r=>box.r>=r.l && box.l<=r.r && box.b>=r.t && box.t<=r.b;
        if(!obstacles.some(overlaps) && !labels.some(overlaps)){
          labels.push(box);return {x,y};
        }
      }
    }
  }
  // Keep Chinese and wide glyphs inside the SVG symbol. Its title keeps the complete label.
  function clipped(text, units) {
    const value=String(text);
    let used=0, result='';
    for (const char of value) {
      used+=char.codePointAt(0)>255 ? 2 : 1;
      if (used>units) return result+'…';
      result+=char;
    }
    return value;
  }

  function instruction_face(node, label, metric) {
    const middle=[{class:'vp-node-name',x:92,y:28,'text-anchor':'middle'},
      {class:'vp-node-meta',x:92,y:45,'text-anchor':'middle'}];
    let shape='process', face=svg('rect',{class:'vp-node-box',width,height,rx:3});
    if (node.op==='if') shape='decision';
    else if (node.op==='repeat') shape='loop';
    else if (['call','external'].includes(node.op)) shape='subroutine';
    else if (['print','send','receive'].includes(node.op)) shape='io';
    const outlines={decision:'M 92 0 L 184 32 L 92 64 L 0 32 Z',
      loop:'M 18 0 H 166 L 184 32 L 166 64 H 18 L 0 32 Z',
      io:'M 17 0 H 184 L 167 64 H 0 Z'};
    if (outlines[shape]) face=svg('path',{class:'vp-node-box',d:outlines[shape]});
    face.dataset.shape=shape;
    const parts=[face];
    if (shape==='subroutine') parts.push(svg('path',{class:'vp-process-detail',d:'M 8 0 V 64 M 176 0 V 64'}));
    parts.push(svg('text',middle[0],clipped(label,shape==='decision'?14:20)),
      svg('text',middle[1],clipped(metric,shape==='decision'?12:21)));
    return parts;
  }

  class canvas {
    constructor(frame,ctx) {
      this.frame=frame;
      this.ctx=ctx;
      this.view=svg('svg',{class:'vp-map',tabindex:0,role:'group','aria-label':ctx.t('线程与对象关系图','Threads and kernel objects')});
      this.scene=svg('g');
      this.scale=1; this.x=0; this.y=0;
      this.view.append(this.markers(),this.scene);
      frame.append(this.view);
      this.view.addEventListener('pointerdown',event=>this.begin(event));
      this.view.addEventListener('pointermove',event=>this.move(event));
      this.view.addEventListener('pointerup',event=>this.end(event));
      this.view.addEventListener('pointercancel',()=>this.abort());
      this.view.addEventListener('wheel',event=>this.wheel(event),{passive:false});
      this.view.addEventListener('keydown',event=>this.key(event));
      this.resize=new ResizeObserver(()=>{if (this.autoFit) this.fit();});
      this.autoFit=true;
      this.resize.observe(frame);
    }
    markers() {
      const defs=svg('defs');
      for (const kind of ['msgq','sem','mutex','control','call']) {
        const marker=svg('marker',{id:'vp-end-'+kind,viewBox:'0 0 10 8',refX:9,refY:4,markerWidth:7,markerHeight:6,orient:'auto-start-reverse',markerUnits:'strokeWidth'});
        marker.append(svg('path',{d:'M 0 0 L 10 4 L 0 8 z',class:'vp-head vp-'+kind}));
        defs.append(marker);
      }
      return defs;
    }
    show(diagram,selected,stepId) {
      const focused=document.activeElement;
      const previous=focused?.closest('[data-node]')?.dataset.node;
      const previousEdge=focused?.closest('[data-edge]')?.dataset.edge;
      this.selected=selected; this.stepId=stepId;
      this.nodes=diagram.nodes;
      this.edges=diagram.edges;
      this.pos=layout(this.nodes,this.edges);
      this.draw();
      if (this.autoFit) this.fit();
      if(previous || previousEdge) (this.cards.get(previous)||this.wires.get(previousEdge)?.g||this.cards.get(stepId)||this.cards.get(selected)||this.view).focus({preventScroll:true});
    }
    markObserved() {
      if(this.returnWire) {
        this.returnWire.setAttribute('marker-end',this.returnWire.getAttribute('marker-start'));
        this.returnWire.removeAttribute('marker-start');
        this.returnWire=null;
      }
      for(const item of this.marked||[])item.classList.remove('observed');
      this.marked=[];
      this.pulse?.remove();this.pulse=null;
      const event=this.observed;
      if(!event || !this.cards)return;
      const callee=event.op==='call' ? event.callee : null;
      for(const id of new Set([event.contextId,event.ownerId,event.stepId,event.objectId,callee])){
        const card=this.cards.get(id);
        if(card)this.marked.push(card);
      }
      const operation=this.wires.get(event.stepId);
      if(operation){
        this.marked.push(operation.g);
        if(event.phase==='return' && operation.edge.kind==='call'){
          this.returnWire=operation.g.querySelector('.vp-wire');
          this.returnWire.setAttribute('marker-start',this.returnWire.getAttribute('marker-end'));
          this.returnWire.removeAttribute('marker-end');
        }
      }
      for(const branch of this.branches.get(event.stepId)||[])if(branch.edge.branch===event.op)this.marked.push(branch.g);
      for(const item of this.marked)item.classList.add('observed');
    }
    playPulse(){
      const wire=this.marked?.find(n=>n.classList.contains('vp-edge'));
      if(!wire || matchMedia('(prefers-reduced-motion: reduce)').matches)return;
      const dot=svg('circle',{class:'vp-pulse',r:4.3,'pointer-events':'none'});
      const motion=svg('animateMotion',{path:wire.querySelector('.vp-wire').getAttribute('d'),dur:'.4s',begin:'indefinite',fill:'remove'});
      if(this.returnWire){
        motion.setAttribute('calcMode','linear');motion.setAttribute('keyTimes','0;1');motion.setAttribute('keyPoints','1;0');
      }
      dot.append(motion);wire.append(dot);this.pulse=dot;
      motion.addEventListener('endEvent',()=>dot.remove(),{once:true});
      motion.beginElement();
    }
    trace(event) {
      this.observed=event;
      this.markObserved();
      if(event){
        this.playPulse();
        const p=this.pos?.get(event.stepId)||this.pos?.get(event.objectId)||this.pos?.get(event.contextId);
        if(!p)return;
        const x=(p.x+width/2)*this.scale+this.x,y=(p.y+height/2)*this.scale+this.y;
        if(x<0||x>this.view.clientWidth||y<0||y>this.view.clientHeight){
          this.x+=this.view.clientWidth/2-x;this.y+=this.view.clientHeight/2-y;this.transform();
        }
      }
    }
    draw() {
      const lanes=new Map();
      this.captions=[];
      this.obstacles=[...this.pos.values()].map(p=>({l:p.x-2,r:p.x+width+2,t:p.y-2,b:p.y+height+2}));
      this.cards=new Map();this.wires=new Map();this.branches=new Map();
      const links=this.edges.map(edge=>{
        const key=edge.from+'|'+edge.to, order=lanes.get(key)||0;
        lanes.set(key,order+1);
        const g=this.link(edge,order), item={edge,g};
        this.wires.set(edge.id,item);
        if(edge.branch){
          if(!this.branches.has(edge.from))this.branches.set(edge.from,[]);
          this.branches.get(edge.from).push(item);
        }
        return g;
      });
      for(const n of this.nodes)this.cards.set(n.id,this.card(n));
      this.scene.replaceChildren(...links,...this.cards.values());this.markObserved();
    }
    link(edge,order) {
      const start=this.pos.get(edge.from), end=this.pos.get(edge.to);
      const forward=end.x>=start.x, side=forward?1:-1;
      const a={x:start.x+(forward?width:0),y:start.y+height*.5};
      const b={x:end.x+(forward?0:width),y:end.y+height*.5};
      const spread=21+Math.min(Math.abs(b.x-a.x)*.4,115);
      const offset=order ? (order%2?1:-1)*Math.ceil(order/2)*24 : 0;
      const curve=[a,{x:a.x+side*spread,y:a.y+offset},{x:b.x-side*spread,y:b.y+offset},b];
      const d='M '+a.x+' '+a.y+' C '+(a.x+side*spread)+' '+(a.y+offset)+' '+(b.x-side*spread)+' '+(b.y+offset)+' '+b.x+' '+b.y;
      const active=edge.id===this.stepId || edge.stepId===this.stepId;
      const g=svg('g',{class:'vp-edge vp-'+edge.kind+([edge.from,edge.to].includes(this.selected)?' neighbor':'')+(active?' active':''),'data-edge':edge.id,role:'button',tabindex:0,'aria-label':edge.label||this.ctx.api(edge.step?.op)||this.ctx.t('执行下一步','Next operation'),'data-operation-id':edge.step?.id||edge.stepId||''});
      g.append(svg('title',{},edge.label||this.ctx.api(edge.step?.op)),svg('path',{d,class:'vp-hit'}),svg('path',{d,class:'vp-wire','marker-end':'url(#vp-end-'+edge.kind+')'}));
      const caption=edge.label||this.ctx.api(edge.step?.op);
      if(caption && !order && (edge.step||edge.stepId) && (this.edges.length<=128||active)){
        const pos=captionPosition(curve,caption,this.obstacles,this.captions);
        if(pos)g.append(svg('text',{class:'vp-edge-caption',x:pos.x,y:pos.y,'text-anchor':'middle'},caption));
      }
      return g;
    }
    card(node) {
      const p=this.pos.get(node.id),kind=node.kind||node.role||'thread', active=node.id===this.selected || node.id===this.stepId;
      const g=svg('g',{class:'vp-node vp-'+kind+(active?' selected':''),transform:'translate('+p.x+' '+p.y+')',
        'data-node':node.id,'data-operation-id':kind==='instruction'?node.id:'','data-object-id':node.kind?node.id:'','data-thread-id':kind==='thread'?node.id:'',role:'button',tabindex:0,'aria-pressed':active,'aria-label':this.ctx.kind(kind)+' '+node.name});
      const label=node.name||this.ctx.t('未命名','Unnamed');
      const metric=node.metric || (kind!=='thread' && !node.kind ? this.ctx.kind(kind) : node.kind ? this.ctx.kind(kind)+(node.kind==='mutex'?'':'  ·  '+node.capacity) :
        this.ctx.kind(kind)+'  ·  '+this.ctx.t('优先级 ','Priority ')+node.priority);
      g.append(svg('title',{},label+' · '+metric));
      if (kind==='instruction') {g.append(...instruction_face(node,label,metric));return g;}
      g.append(svg('rect',{class:'vp-node-box',width,height,rx:7}),
        svg('path',{class:'vp-node-glyph',d:glyphs[kind]||glyphs.thread,transform:'translate(13 13)'}),
        svg('text',{class:'vp-node-name',x:41,y:28},clipped(label,16)),
        svg('text',{class:'vp-node-meta',x:14,y:50},clipped(metric,23)));
      return g;
    }
    transform() {
      this.scene.setAttribute('transform','translate('+this.x+' '+this.y+') scale('+this.scale+')');
      this.ctx.scale(this.scale);
    }
    fit() {
      this.autoFit=true;
      if(!this.pos?.size || !this.view.clientWidth || !this.view.clientHeight) return;
      const values=[...this.pos.values()];
      const left=Math.min(...values.map(p=>p.x)), top=Math.min(...values.map(p=>p.y));
      const w=Math.max(...values.map(p=>p.x))+width-left,h=Math.max(...values.map(p=>p.y))+height-top;
      this.scale=Math.max(.00001,Math.min(1.1,Math.max(1,this.view.clientWidth-44)/w,Math.max(1,this.view.clientHeight-40)/h));
      this.x=(this.view.clientWidth-w*this.scale)/2-left*this.scale;
      this.y=(this.view.clientHeight-h*this.scale)/2-top*this.scale;
      this.transform();
    }
    center(id){
      const p=this.pos?.get(id)||this.pos?.get(this.selected);if(!p)return;
      this.autoFit=false;this.scale=Math.max(1,this.scale);
      this.x=this.view.clientWidth/2-(p.x+width/2)*this.scale;this.y=this.view.clientHeight/2-(p.y+height/2)*this.scale;
      this.transform();
    }
    zoom(factor,x=this.view.clientWidth/2,y=this.view.clientHeight/2) {
      const next=Math.min(3,Math.max(Math.min(.05,this.scale),this.scale*factor)),ratio=next/this.scale;
      this.autoFit=false;
      this.x=x+(this.x-x)*ratio; this.y=y+(this.y-y)*ratio;
      this.scale=next;
      this.transform();
    }
    wheel(event) {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const r=this.view.getBoundingClientRect();
      this.zoom(event.deltaY<0?1.13:1/1.13,event.clientX-r.left,event.clientY-r.top);
    }
    begin(event) {
      if(event.button!==0 || this.drag || !this.pos) return;
      const node=event.target.closest('[data-node]')?.dataset.node,edge=event.target.closest('[data-edge]')?.dataset.edge;
      this.drag={id:event.pointerId,node,edge,start:this.pos.get(node),x:event.clientX,y:event.clientY,tx:this.x,ty:this.y};
      this.view.setPointerCapture(event.pointerId);
    }
    move(event) {
      const drag=this.drag;
      if(!drag || drag.id!==event.pointerId) return;
      const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
      if(!drag.moved && Math.hypot(dx,dy)<4) return;
      drag.moved=true;
      this.autoFit=false;
      if(drag.node) {
        this.pos.set(drag.node,{x:Math.round(drag.start.x+dx/this.scale),y:Math.round(drag.start.y+dy/this.scale)});
        this.draw();
      } else {
        this.x=drag.tx+dx;this.y=drag.ty+dy;this.transform();
      }
    }
    abort() {
      if(this.drag?.node && this.drag.moved) {this.pos.set(this.drag.node,this.drag.start);this.draw();}
      this.drag=undefined;
    }
    end(event) {
      const drag=this.drag;
      if(!drag || drag.id!==event.pointerId) return;
      this.drag=undefined;
      if(drag.moved && drag.node) this.ctx.move(drag.node,this.pos.get(drag.node));
      if(!drag.moved && drag.node) {
        const now=Date.now(),edit=this.last?.node===drag.node && now-this.last.time<450;
        this.last={node:drag.node,time:now}; this.ctx.select(drag.node,edit);
      }
      if(!drag.moved && drag.edge) this.chooseEdge(drag.edge);
    }
    chooseEdge(id) {
      const e=this.wires.get(id)?.edge;
      if(e)this.ctx.edge(e.step?.id || e.stepId || e.to);
    }
    key(event) {
      const edge=event.target.closest('[data-edge]')?.dataset.edge;
      if(edge && ['Enter',' '].includes(event.key)){event.preventDefault();this.chooseEdge(edge);return;}
      const id=event.target.closest('[data-node]')?.dataset.node;
      if (id && ['Enter',' '].includes(event.key)) {event.preventDefault();this.ctx.select(id,true);return;}
      const offsets={ArrowLeft:[50,0],ArrowRight:[-50,0],ArrowUp:[0,50],ArrowDown:[0,-50]};
      if (offsets[event.key]) {
        event.preventDefault();this.autoFit=false;this.x+=offsets[event.key][0];this.y+=offsets[event.key][1];this.transform();
      } else if(event.key==='Home'){event.preventDefault();this.fit();}
    }
    dispose(){this.resize.disconnect();this.view.remove();}
  }
  const glyphs={main:'m4 2 12 8-12 8z',program:'M2 4h16v13H2z M2 8h16',function:'M8 4H6L4 7v2l-2 1 2 1v2l2 3h2 M12 4h2l2 3v2l2 1-2 1v2l-2 3h-2',instruction:'M2 5h16M2 10h12M2 15h9',thread:'M1 1h6v6H1z M12 13h6v6h-6z M7 4h4a4 4 0 0 1 0 8H9a3 3 0 0 0 0 6h3',
    msgq:'M1 3h17v5H1z M1 12h17v5H1z',sem:'M4 19V1l12 3-4 3 4 3-12-1',mutex:'M3 9h14v10H3z M6 9V6a4 4 0 0 1 8 0v3'};
  return canvas;
})();
