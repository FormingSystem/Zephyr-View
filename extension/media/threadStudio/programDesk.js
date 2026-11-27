'use strict';

globalThis.ZephyrProgramDesk = (() => {
  const {el,button,select} = ThreadStudioUI;
  const mainFile = 'src/main.c';

  /** Keep both panes useful when a floating window is resized or its divider is dragged. */
  function divider(body,t) {
    const grip = el('div','vp-divider');
    grip.tabIndex = 0;
    grip.setAttribute('role','separator');
    grip.setAttribute('aria-orientation','vertical');
    grip.setAttribute('aria-label',t('调整源码栏宽度','Resize source panel'));
    grip.setAttribute('aria-valuemin','25'); grip.setAttribute('aria-valuemax','54');
    let width = 35;
    function resize(value) {
      width = Math.min(54,Math.max(25,value));
      body.style.setProperty('--source-width',width+'%');
      grip.setAttribute('aria-valuenow',String(Math.round(width)));
      grip.setAttribute('aria-valuetext',Math.round(width)+'%');
    }
    resize(width);
    grip.addEventListener('pointerdown',event=>{
      if (event.button!==0) return;
      event.preventDefault();grip.focus();grip.setPointerCapture(event.pointerId);
    });
    grip.addEventListener('pointermove',event=>{
      if (!grip.hasPointerCapture(event.pointerId)) return;
      const box=body.getBoundingClientRect();
      if (box.width) resize((box.right-event.clientX)*100/box.width);
    });
    grip.addEventListener('dblclick',()=>resize(35));
    grip.addEventListener('keydown',event=>{
      const widths={ArrowLeft:width+2,ArrowRight:width-2,Home:25,End:54,Enter:35};
      if (!Object.hasOwn(widths,event.key)) return;
      event.preventDefault();resize(widths[event.key]);
    });
    return grip;
  }

  /** Format the generated text without interpreting source as markup. */
  function renderLine(number,text,highlight) {
    const row=el('span','vp-source-line');
    row.dataset.line=number;
    if (!highlight) {row.textContent=text+'\n';return row;}
    const syntax=/(\/\/.*|\/\*.*?\*\/|"(?:\\.|[^"\\])*"|^\s*#\s*\w+|\b(?:void|static|uint32_t|int|unsigned|struct|enum|const|for|if|else|while|return|sizeof|typedef)\b|\b(?:0x[\da-fA-F]+|\d+)\b)/g;
    let offset=0;
    for (const match of text.matchAll(syntax)) {
      row.append(text.slice(offset,match.index));
      const part=match[0],type=part.startsWith('/')?'comment':part.startsWith('"')?'string':/^\d/.test(part)?'number':'keyword';
      row.append(el('i','vp-syntax-'+type,part));
      offset=match.index+part.length;
    }
    row.append(text.slice(offset)+'\n');
    return row;
  }

  class SourcePane {
    constructor(context) {
      this.context=context;
      this.file=mainFile;
      this.body=el('div','vp-code-body');
      this.location=el('output','vp-line-location');
      this.root=el('section','vp-code',el('header','vp-source-heading',
        el('h2','',context.t('生成源码','Generated source')),this.location),this.body);
    }
    reset(message) {
      this.preview=undefined;
      this.location.textContent='';
      this.body.replaceChildren(...(message?[el('p','vp-muted',message)]:[]));
    }
    show(source,id) {
      const {t,options}=this.context;
      if (!source) return this.reset(t('修正设计中的参数以生成源码。','Correct the design parameters to generate source.'));
      const line=this.file===mainFile ? source.index[id] : undefined;
      if (this.preview?.source!==source || this.preview.file!==this.file) {
        const picker=select(t('预览文件','Preview file'),Object.keys(source.files).map(k=>[k,k]),this.file,v=>{
          this.file=v;this.context.showCode();
        });
        const locate=this.context.command('⌖',()=>{
          this.context.sourceFollowsTrace=false;this.file=mainFile;this.context.showCode();
          const row=this.preview.current;
          if (row) this.preview.pre.scrollTop=Math.max(0,row.offsetTop-this.preview.pre.clientHeight/2);
        },'locate',t('定位所选节点的 C 代码','Locate selected C code'));
        const tools=el('div','vp-code-tools',picker,locate);
        if (options.openSource) tools.append(this.context.command(t('打开源码','Open source'),()=>{
          options.openSource(this.file,this.currentId,this.preview.source.protocol);
        },'openSource',t('在源码编辑器中定位','Reveal in source editor')));
        if (options.breakpoint) {
          this.breakpoint=this.context.command(t('切换断点','Toggle breakpoint'),()=>{
            if (this.preview.current) options.breakpoint(this.file,this.currentId,this.preview.source.protocol);
          },'breakpoint',t('在对应工程源码行切换断点','Toggle a breakpoint on the corresponding project line'));
          tools.append(this.breakpoint);
        }
        const pre=el('pre','');pre.tabIndex=0;
        pre.setAttribute('aria-label',this.file);
        const body=source.files[this.file], highlight=this.file.endsWith('.c') && body.length<=120000;
        const lines=this.file===mainFile?source.cLines:body.split('\n');
        const fragment=document.createDocumentFragment();
        lines.forEach((value,index)=>fragment.append(renderLine(index+1,value,highlight)));
        pre.append(fragment);
        this.body.replaceChildren(tools,pre);
        this.preview={source,file:this.file,pre};
      }
      const {pre,current}=this.preview;
      const next=line?pre.children[line-1]:undefined;
      this.currentId=id;
      if (this.breakpoint) this.breakpoint.disabled=!next;
      this.location.textContent=next ? t('第 '+line+' 行','Line '+line) : '';
      if (next===current) return;
      current?.classList.remove('current');
      this.preview.current=next;
      if (!next) return;
      next.classList.add('current');
      const top=next.offsetTop,bottom=top+next.offsetHeight;
      if (top<pre.scrollTop || bottom>pre.scrollTop+pre.clientHeight) pre.scrollTop=Math.max(0,top-pre.clientHeight/2);
    }
  }

  function inspectorDock(editor,panels) {
    const {t}=editor;
    const choices=[['properties',t('属性','Properties')],['checks',t('检查','Checks')],['playback',t('回放','Playback')]];
    const toolbar=el('div','vp-dock-tools');
    toolbar.setAttribute('role','group');toolbar.setAttribute('aria-label',t('检查器视图','Inspector views'));
    const pages=Object.entries(panels).map(([key,pane])=>[key,el('div','vp-dock-page',pane)]);
    const content=el('div','vp-dock-content',...pages.map(([,page])=>page));
    function activate(id) {
      for (const [key,page] of pages) page.hidden=id!==key;
      for (const item of toolbar.children) item.setAttribute('aria-pressed',String(item.dataset.dock===id));
    }
    for (const [key,label] of choices) {
      const item=button(label,()=>activate(key));item.dataset.dock=key;
      toolbar.append(item);
    }
    activate('properties');
    return {root:el('section','vp-dock',toolbar,content),activate};
  }
  return {divider,renderLine,SourcePane,inspectorDock};
})();
