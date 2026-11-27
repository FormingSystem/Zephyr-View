'use strict';

globalThis.ZephyrStudioProjectSource = (() => {
  const {el,button} = ThreadStudioUI;
  const page_size = 80;

  class source_reader {
    constructor(t,send) {
      this.t=t; this.send=send; this.selected=1; this.points=new Set();
      this.heading=el('h2','',t('工程源码','Project source'));
      this.back=button(t('← 返回来源','← Back to source'),()=>this.onBack?.());
      this.back.hidden=true;
      this.position=el('output','ps-location');
      this.code=el('pre','ps-listing');
      this.code.tabIndex=0;
      this.code.setAttribute('aria-label',t('工程源码','Project source'));
      this.code.addEventListener('click',event=>{
        const row=event.target.closest('[data-line]');
        if (row) this.locate(Number(row.dataset.line));
      });
      this.code.addEventListener('keydown',event=>{
        if (!['ArrowUp','ArrowDown'].includes(event.key)) return;
        event.preventDefault();this.locate(this.selected+(event.key==='ArrowDown'?1:-1));
      });
      this.previous=button('‹',()=>this.locate(this.selected-page_size));
      this.next=button('›',()=>this.locate(this.selected+page_size));
      for (const [control,label] of [[this.previous,t('上一段源码','Previous lines')],[this.next,t('下一段源码','Next lines')]]) {
        control.title=label;control.setAttribute('aria-label',label);
      }
      this.edit=button(t('编辑源码','Edit source'),()=>this.act('edit'));
      this.breakpoint=button(t('切换断点','Toggle breakpoint'),()=>this.act('breakpoint'));
      this.root=el('section','ps-reader',
        el('header','ps-heading',this.heading,this.position,this.back,this.edit,this.breakpoint),
        this.code,el('footer','ps-pager',this.previous,this.next));
    }

    act(op) {
      if (this.source) this.send(op,{...this.context,uri:this.source.uri,version:this.source.current,line:this.selected});
    }

    update(source,points,trusted,context) {
      const changed = source?.uri!==this.source?.uri;
      this.source=source;
      this.context=context;
      this.heading.textContent=source?.name || this.t('工程源码','Project source');
      this.heading.title=source?.displayPath || '';
      this.back.hidden=!context;
      this.lines=source && source.issue!=='size' ? source.text.split(/\r\n|\r|\n/) : [];
      this.points=new Set(points);
      this.trusted=trusted;
      this.start=undefined;
      this.locate(changed ? 1 : this.selected,false);
    }

    locate(line,scroll=true) {
      const count=this.lines?.length || 0;
      this.selected=Math.min(count,Math.max(1,line));
      const start=count ? Math.floor((this.selected-1)/page_size)*page_size : 0;
      if (start!==this.start) {
        this.start=start;
        this.code.replaceChildren(...(this.lines || []).slice(start,start+page_size).map((text,index)=>{
          const number=start+index+1, row=ZephyrProgramDesk.renderLine(number,text,true);
          row.classList.toggle('ps-break',this.points.has(number));
          return row;
        }));
      }
      this.code.querySelector('.current')?.classList.remove('current');
      const row=this.code.querySelector('[data-line="'+this.selected+'"]');
      row?.classList.add('current');
      if (scroll && row) {
        const offset=row.getBoundingClientRect().top-this.code.getBoundingClientRect().top;
        if (offset<0 || offset+row.offsetHeight>this.code.clientHeight) this.code.scrollTop+=offset-this.code.clientHeight/2;
      }
      this.position.textContent=count?'L'+this.selected+' / '+count:'';
      this.previous.disabled=start===0;
      this.next.disabled=start+page_size>=count;
      this.edit.disabled=!count;
      this.breakpoint.disabled=!count || !this.trusted || !/^(file|vscode-remote):/.test(this.source?.uri || '');
      this.breakpoint.setAttribute('aria-pressed',String(this.points.has(this.selected)));
    }
  }

  // The left diagram stays bound to its source while the reader follows a header declaration.
  class source_navigation {
    constructor(reader,send) {
      this.reader=reader;
      this.send=send;
      this.serial=0;
      reader.onBack=()=>this.show_root(this.returnLine);
    }
    reset() {
      this.request=undefined;
      this.root=undefined;
      this.returnLine=1;
    }
    update(message) {
      const file=message.source, last=this.root?.source;
      const sameFile=file && last?.uri===file.uri;
      const sameRevision=sameFile && last.graphRevision===file.graphRevision && last.current===file.current && !file.issue;
      const restore=this.request && sameFile ? this.returnLine : undefined;
      this.root=message;
      if (!sameRevision) this.request=undefined;
      if (!this.request || this.reader.source?.uri===file?.uri) {
        this.reader.update(file,message.breakpoints,message.trusted);
        if (!sameRevision && restore) this.reader.locate(restore,false);
      }
    }
    root_fields() {
      const file=this.root?.source;
      return file && {uri:file.uri,version:file.current,graphRevision:file.graphRevision};
    }
    show_root(line) {
      if (!this.root) return;
      if (this.request) {
        this.send('leaveHeader',this.root_fields());
        this.request=undefined;
        this.reader.update(this.root.source,this.root.breakpoints,this.root.trusted);
      }
      this.reader.locate(line);
    }
    select(line,file) {
      const root=this.root_fields();
      if (!root || !file || file===root.uri) return this.show_root(line);
      if (!this.request) this.returnLine=this.reader.selected;
      const request={...root,file,line,navigationId:++this.serial};
      this.request=request;
      this.send('revealHeader',request);
    }
    show_header(message) {
      const request=this.request, file=message.source;
      if (!request || message.rootUri!==request.uri || request.graphRevision!==message.graphRevision ||
          request.navigationId!==message.navigationId || file?.uri!==request.file || message.line!==request.line) return;
      const refresh=request.shown;
      request.shown=true;
      this.reader.update(file,message.breakpoints,message.trusted,{rootUri:request.uri,graphRevision:request.graphRevision});
      if (!refresh) this.reader.locate(message.line);
    }
    export() {
      const fields=this.root_fields();
      if (fields) this.send('exportClassDiagram',fields);
    }
  }

  function bind(host,design,toolbar,t) {
    const send=(op,fields={})=>host.postMessage({action:'projectSource',op,...fields});
    const nav=el('nav',''), data=el('div','ps-relations'), label=el('strong',''), status=el('span','ps-status');
    const pick=button(t('选择文件…','Choose file…'),()=>send('pick'));
    const reader=new source_reader(t,send);
    const navigation=new source_navigation(reader,send);
    const relations=ZephyrSourceRelations.mount({nav,container:data,t,onLine:(line,file)=>navigation.select(line,file),
      onExportClassDiagram:()=>navigation.export()});
    const view=el('div','ps-grid');
    const side=el('section','ps-graph',el('header','ps-heading',label,status,pick),nav,data);
    view.append(side,ZephyrProgramDesk.divider(view,t),reader.root);
    view.id='project-source';view.hidden=true;
    design.after(view);
    let open=false;
    const modes=el('div','ps-modes');
    modes.setAttribute('role','group');modes.setAttribute('aria-label',t('工作模式','Studio mode'));
    const graph=button(t('设计图','Design'),()=>switch_view(false)),source=button(t('工程源码','Project source'),()=>switch_view(true));
    graph.dataset.studioMode='design';source.dataset.studioMode='source';
    modes.append(graph,source);toolbar.prepend(modes);
    function switch_view(visible) {
      if (visible===open) return;
      open=visible; design.hidden=open;view.hidden=!open;
      if (!open) {
        navigation.reset();
        reader.update(undefined,[],false);
        relations.update({current:0});
        label.textContent='';label.title='';status.textContent='';
      }
      reflect();send(open?'enter':'leave');
    }
    function reflect() {
      graph.setAttribute('aria-pressed',String(!open));source.setAttribute('aria-pressed',String(open));
      const file_menu=toolbar.querySelector('[data-command="new"]')?.closest('details');
      if (file_menu) file_menu.hidden=open;
    }
    function receive({data:message}) {
      if (!open) return;
      if (message?.type==='projectHeader') return navigation.show_header(message);
      if (message?.type!=='projectSource') return;
      const file=message.source;
      label.textContent=file?.name || t('选择 C 源文件或头文件','Choose a C source or header file');
      label.title=file?.displayPath || '';
      status.textContent=file ? file.issue==='size' ? t('超过 256 KiB','Exceeds 256 KiB') :
        file.issue ? t('输入未完成','Incomplete input')+' · L'+file.line :
        file.dirty?t('未保存','Unsaved'):'' : '';
      navigation.update(message);
      relations.update(file || {current:0});
    }
    reflect();
    window.addEventListener('message',receive);
  }

  return {bind};
})();
