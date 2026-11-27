'use strict';

globalThis.ZephyrClassDiagram = (() => {
  const {el,button,select}=ThreadStudioUI;
  const ns='http://www.w3.org/2000/svg';
  const perPage=4;
  const compactMembers=5;

  function svg(tag,attrs) {
    const item=document.createElementNS(ns,tag);
    for (const [key,value] of Object.entries(attrs)) item.setAttribute(key,String(value));
    return item;
  }

  function neighborGroups(diagram,focus) {
    const groups=new Map();
    diagram.edges.forEach((edge,index)=>{
      if (edge.from!==focus && edge.to!==focus) return;
      const other=edge.from===focus ? edge.to : edge.from;
      if (!groups.has(other)) groups.set(other,[]);
      groups.get(other).push({edge,index});
    });
    return [...groups.entries()];
  }

  function initialType(diagram) {
    const counts=new Map();
    for (const {from,to} of diagram.edges) {
      counts.set(from,(counts.get(from)||0)+1);
      if (from!==to) counts.set(to,(counts.get(to)||0)+1);
    }
    return diagram.nodes.reduce((best,node)=>(counts.get(best.id)||0)>=(counts.get(node.id)||0) ? best : node).id;
  }

  function marker(id,kind,ink,paper) {
    const start=kind==='composition';
    const shape=svg('marker',{id,viewBox:'0 0 14 12',refX:start?0:13,refY:6,markerWidth:13,markerHeight:11,
      orient:'auto',markerUnits:'userSpaceOnUse'});
    const paths={composition:'M0 6 6 1 13 6 6 11Z',association:'M4 1 13 6 4 11',inheritance:'M1 1 13 6 1 11Z'};
    shape.append(svg('path',{d:paths[kind],fill:start?ink:kind==='inheritance'?paper:'none',stroke:ink,'stroke-width':1.3}));
    return shape;
  }

  class ClassDiagram {
    constructor({t,onLine,onExportClassDiagram}) {
      this.t=t;this.onLine=onLine;this.export=onExportClassDiagram;this.scale=1;this.page=0;
      this.openCards=new Set();this.connections=[];
      this.toolbar=el('div','uml-tools');this.grid=el('div','uml-layout');
      this.canvas=el('div','uml-canvas',this.grid);this.canvas.tabIndex=0;
      this.canvas.setAttribute('aria-label',t('类图画布','Class diagram canvas'));
      this.foot=el('footer','uml-footer');this.root=el('section','uml-workspace',this.toolbar,this.canvas,this.foot);
      this.resize=new ResizeObserver(()=>this.drawWires());this.resize.observe(this.grid);
      this.diagramId='uml-'+Math.random().toString(36).slice(2);
      this.bindCanvas();
    }

    dispose() { this.resize.disconnect(); }

    bindCanvas() {
      const view=this.canvas;
      let drag;
      view.addEventListener('pointerdown',e=>{
        if(e.button || e.target.closest('button,select,path[data-uml-edge]')) return;
        drag={x:e.clientX,y:e.clientY,left:view.scrollLeft,top:view.scrollTop};
        view.setPointerCapture(e.pointerId);view.classList.add('dragging');
      });
      view.addEventListener('pointermove',e=>{
        if (drag) view.scrollTo(drag.left+drag.x-e.clientX,drag.top+drag.y-e.clientY);
      });
      view.addEventListener('lostpointercapture',()=>{drag=undefined;view.classList.remove('dragging');});
      view.addEventListener('wheel',e=>{
        if (!e.ctrlKey) return;
        e.preventDefault();this.zoom(this.scale+(e.deltaY<0?.15:-.15));
      },{passive:false});
    }

    zoom(value) {
      this.scale=Math.max(.55,Math.min(1.75,value));
      this.grid.style.zoom=String(this.scale);
      this.percent.textContent=Math.round(this.scale*100)+'%';
      this.drawWires();
    }

    update(diagram,stale,uri,version) {
      if (!diagram.nodes.length) {
        this.diagram=diagram;this.focus=undefined;this.connections=[];this.selected=undefined;this.openCards.clear();
        this.toolbar.replaceChildren();this.foot.replaceChildren();
        this.grid.classList.add('empty');
        this.grid.replaceChildren(el('p','',this.t('当前文件没有可绘制的类型定义。','No type definitions to diagram in this file.')));
        return;
      }
      this.grid.classList.remove('empty');
      if (this.uri!==uri || this.version!==version || !diagram.nodes.some(n=>n.id===this.focus)) {
        const previous=this.uri===uri && this.diagram?.nodes.find(n=>n.id===this.focus);
        const matches=previous?diagram.nodes.filter(n=>n.kind===previous.kind && n.name===previous.name && n.file===previous.file):[];
        if (matches.length===1) this.focus=matches[0].id;
        else {
          this.focus=initialType(diagram);this.page=0;this.scale=1;
          this.canvas.scrollTo(0,0);
        }
        this.selected=undefined;this.openCards.clear();
      }
      this.uri=uri;this.version=version;this.diagram=diagram;this.stale=stale;this.render();
    }

    action(label,title,click) {
      const item=button(label,click);item.title=title;item.setAttribute('aria-label',title);return item;
    }

    controls(groups) {
      const t=this.t;
      const picker=select(t('聚焦类型','Focus type'),this.diagram.nodes.map(n=>[n.id,n.name]),this.focus,id=>{
        this.focus=id;this.page=0;this.selected=undefined;this.canvas.scrollTo(0,0);this.render();
        this.toolbar.querySelector('select').focus();
      });
      picker.dataset.umlFocus='';
      const fit=this.action('⊙',t('定位当前类型','Center current type'),()=>{
        this.zoom(1);
        this.canvas.scrollTo(0,0);
      });
      this.percent=el('output','',Math.round(this.scale*100)+'%');
      const tools=el('div','uml-zoom',
        this.action('−',t('缩小','Zoom out'),()=>this.zoom(this.scale-.15)),this.percent,
        this.action('+',t('放大','Zoom in'),()=>this.zoom(this.scale+.15)),fit);
      const children=[picker,tools];
      if (this.export) {
        const item=button(t('导出 PlantUML…','Export PlantUML…'),()=>{if (!this.stale) this.export();});
        item.dataset.command='export-class-diagram';item.disabled=this.stale;children.push(item);
      }
      this.toolbar.replaceChildren(...children);
      const last=Math.max(0,Math.ceil(groups.length/perPage)-1);
      this.page=Math.min(this.page,last);
      const notes=[];
      if (last) {
        const move=by=>{this.page+=by;this.canvas.scrollTo(0,0);this.render();this.foot.querySelector('button:enabled')?.focus();};
        const prev=this.action('‹',t('上一组关系','Previous relationships'),()=>move(-1));prev.disabled=!this.page;
        const next=this.action('›',t('下一组关系','Next relationships'),()=>move(1));next.disabled=this.page===last;
        notes.push(prev,el('span','',(this.page+1)+' / '+(last+1)),next);
      }
      const omitted=Object.values(this.diagram.omitted||{}).some(Boolean);
      if (omitted) notes.push(el('small','',t('已达到分析数量上限。','Diagram analysis limit reached.')));
      if (this.diagram.ambiguous) notes.push(el('small','',t('未连线的歧义引用','Ambiguous references without edges')+' · '+this.diagram.ambiguous));
      this.foot.replaceChildren(...notes);this.foot.hidden=!notes.length;
    }

    pick(key,line,file) {
      if (this.stale) return;
      this.selected=key;
      this.highlight();
      this.onLine(line,file);
    }

    highlight() {
      const key=this.selected;
      const edge=key?.startsWith('edge:') ? this.diagram.edges[Number(key.slice(5))] : undefined;
      for (const item of this.grid.querySelectorAll('[data-pick]')) {
        const picked=item.dataset.pick===key;
        item.classList.toggle('picked',picked);
        const declaration=edge && item.hasAttribute('data-uml-member') && Number(item.dataset.line)===edge.line &&
          item.closest('.uml-card')?.dataset.owner===edge.from &&
          item.dataset.umlMember.split(/[^\w]+/).includes(edge.label);
        item.classList.toggle('uml-evidence',Boolean(declaration));
        if (item.tagName==='BUTTON') item.setAttribute('aria-pressed',String(picked));
      }
    }

    link(text,kind,value,line,key,conditional,file) {
      const item=button(text,()=>this.pick(key,line,file));
      item.dataset['uml'+kind]=value;item.dataset.line=line;item.dataset.pick=key;
      item.classList.toggle('picked',this.selected===key);
      item.setAttribute('aria-pressed',String(this.selected===key));item.disabled=this.stale;
      const evidence=this.t('源码第 ','Source line ')+line;
      item.title=(conditional?this.t('条件编译','Conditional')+' · ':'')+text+' · '+evidence;
      if (conditional) item.append(el('small','uml-conditional',this.t('条件','if')));
      return item;
    }

    card(node) {
      const title=this.link(node.name,'Type',node.id,node.line,'type:'+node.id,node.conditional,node.file);
      const sub=el('small','uml-stereotype',node.kind);
      if (node.file) {
        const name=node.file.split('/').pop();
        let filename=name;
        try {filename=decodeURIComponent(name);} catch {}
        const origin=el('span','uml-origin',filename);
        origin.title=node.file;
        sub.append(origin);
        title.title+=' · '+filename;
      }
      title.prepend(sub);
      const card=el('article','uml-card',title);
      card.dataset.owner=node.id;
      card.classList.toggle('uml-focus',node.id===this.focus);
      const members=node.members||[], expanded=this.openCards.has(node.id);
      for (const [i,member] of members.slice(0,expanded?undefined:compactMembers).entries()) {
        card.append(this.link(member.name,'Member',member.name,member.line,node.id+':member:'+i,member.conditional,node.file));
      }
      if (members.length>compactMembers) {
        const more=button(expanded?this.t('收起成员','Collapse members'):
          this.t('展开其余成员','Show remaining members')+' · '+(members.length-compactMembers),()=>{
            if (expanded) this.openCards.delete(node.id);else this.openCards.add(node.id);
            this.render();[...this.grid.querySelectorAll('[data-more]')].find(b=>b.dataset.more===node.id)?.focus();
          });
        more.dataset.more=node.id;more.setAttribute('aria-expanded',String(expanded));card.append(more);
      }
      return card;
    }

    groupRow([other,relations],row,focusCard,nodes) {
      const self=other===this.focus;
      const target=self?focusCard:this.card(nodes.get(other));
      const lane=el('div','uml-lane');lane.style.gridRow=String(row);
      for (const {edge,index} of relations) {
        const key='edge:'+index, name=edge.label || nodes.get(edge.to).name;
        const label=this.link(name,'Edge',String(index),edge.line,key,edge.conditional);
        const terms={association:this.t('关联','Association'),composition:this.t('组合','Composition'),inheritance:this.t('继承','Inheritance')};
        label.title=nodes.get(edge.from).name+' · '+terms[edge.kind]+' → '+nodes.get(edge.to).name+' · '+label.title;
        label.setAttribute('aria-label',label.title);
        label.prepend(el('small','uml-kind',terms[edge.kind]));
        lane.append(label);
        this.connections.push({edge,index,label,focusCard,target,self,order:lane.children.length-1,total:relations.length});
      }
      this.grid.append(lane);
      if (!self) {target.style.gridRow=String(row);this.grid.append(target);}
    }

    render() {
      const active=this.grid.contains(document.activeElement) && document.activeElement.dataset.pick;
      const diagram=this.diagram,nodes=new Map(diagram.nodes.map(n=>[n.id,n]));
      const groups=neighborGroups(diagram,this.focus);
      this.controls(groups);
      this.grid.replaceChildren();this.connections=[];
      const focus=this.card(nodes.get(this.focus));this.grid.append(focus);
      const visible=groups.slice(this.page*perPage,(this.page+1)*perPage);
      focus.style.gridRow='1 / span '+Math.max(1,visible.length);
      this.grid.classList.toggle('uml-single',!visible.length);
      visible.forEach((group,index)=>this.groupRow(group,index+1,focus,nodes));
      this.wires=svg('svg',{'class':'uml-wires','aria-hidden':'true'});
      this.grid.prepend(this.wires);this.zoom(this.scale);this.highlight();
      if(active) [...this.grid.querySelectorAll('button[data-pick]')].find(b=>b.dataset.pick===active)?.focus({preventScroll:true});
    }

    drawWires() {
      if (!this.wires?.isConnected || !this.connections.length) return;
      const rect=this.grid.getBoundingClientRect(),scale=this.scale;
      if (!rect.width) return;
      const dims=element=>{
        const box=element.getBoundingClientRect();
        return {x:(box.left-rect.left)/scale,y:(box.top-rect.top)/scale,w:box.width/scale,h:box.height/scale};
      };
      const defs=svg('defs',{});
      const ink='var(--uml-wire)',paper='var(--vscode-editor-background)';
      for (const kind of ['composition','inheritance','association']) defs.append(marker(this.diagramId+kind,kind,ink,paper));
      this.wires.replaceChildren(defs);
      this.connections.forEach((connection,i)=>this.wire(connection,dims,i));
    }

    wire({edge,index,label,focusCard,target,self,order,total},dims,slot) {
      const a=dims(focusCard),b=dims(target),mid=dims(label);
      const sy=a.y+10+(a.h-20)*(slot+1)/(this.connections.length+1);
      const ey=self?Math.min(a.y+a.h-3,sy+12):b.y+10+(b.h-20)*(order+1)/(total+1);
      const lx=a.x+a.w,rx=self?lx:b.x,cy=mid.y+mid.h/2;
      // Keep long vertical segments on separate tracks so parallel relations never read as a shared bus.
      const lane=(this.connections.length-slot)/(this.connections.length+1);
      const turn=lx+(mid.x-lx)*(.18+.64*lane);
      const other=self?mid.x+mid.w+16:mid.x+mid.w+(rx-mid.x-mid.w)*(.2+.6*(order+1)/(total+1));
      const points=self?[[lx,sy],[turn,sy],[turn,cy],[other,cy],[other,ey],[lx,ey]]:
        [[lx,sy],[turn,sy],[turn,cy],[other,cy],[other,ey],[rx,ey]];
      if (edge.from!==this.focus) points.reverse();
      const d=points.map(([x,y],i)=>(i?'L':'M')+x.toFixed(1)+' '+y.toFixed(1)).join(' ');
      const path=svg('path',{d,'class':'uml-wire'+(edge.conditional?' conditional':'')});
      path.setAttribute(edge.kind==='composition'?'marker-start':'marker-end','url(#'+this.diagramId+edge.kind+')');
      const hit=svg('path',{d,'class':'uml-hit','data-uml-edge':index,'data-line':edge.line,'data-pick':'edge:'+index});
      hit.classList.toggle('picked',this.selected==='edge:'+index);
      const title=svg('title',{});title.textContent=label.title;hit.append(title);
      if (!this.stale) hit.addEventListener('click',()=>this.pick('edge:'+index,edge.line));
      this.wires.append(path,hit);
    }
  }

  return {mount:options=>new ClassDiagram(options)};
})();