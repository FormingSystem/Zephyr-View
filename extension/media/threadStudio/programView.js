'use strict';

globalThis.ZephyrProgramView = (() => {
  const {el,button,select}=ThreadStudioUI;
  const model=ZephyrProgramModel, flow=ZephyrProgramFlow;
  let nextView=0;
  const apis={send:'k_msgq_put',receive:'k_msgq_get',give:'k_sem_give',take:'k_sem_take',increment:'k_mutex_lock / unlock'};
  const clone=value=>JSON.parse(JSON.stringify(value));
  const kinds={main:['主程序','Main program'],function:['函数','Function'],instruction:['指令','Instruction'],program:['应用','Application'],thread:['线程','Thread'],msgq:['消息队列','Message queue'],sem:['信号量','Semaphore'],mutex:['互斥量','Mutex']};
  const problems={size:['设计的嵌套深度或数据量超出可视化编辑范围','Design exceeds the nesting or data size limit'],schema:['图文件格式或版本错误','Unsupported graph format or version'],name:['请输入有效 C 标识符','Enter a valid C identifier'],
    id:['节点或操作 ID 无效或重复','Invalid or duplicate ID'],duplicate:['名称重复','Duplicate name'],
    count:['数量超出支持范围','Unsupported item count'],range:['数值超出范围或对齐要求','Value outside the range or alignment'],
    creation:['请选择线程创建方式','Choose a thread creation mode'],kind:['未知的内核对象类型','Unknown kernel object type'],
    operation:['此对象不支持该操作','Operation unsupported by the object'],reference:['请选择存在的对象或函数','Select an existing object or function'],cycle:['函数调用出现递归环','Recursive function call cycle']};
  // Check the entire JSON tree, including extension fields, before cloning or serializing it.
  function bounded(value) {
    const seen=new WeakSet();
    let entries=0,characters=0;
    function visit(item,depth) {
      if(++entries>30000 || depth>36)return false;
      if(typeof item==='string')characters+=item.length;
      if(characters>2*1024*1024)return false;
      if(!item || typeof item!=='object')return true;
      if(seen.has(item) || (Array.isArray(item) && item.length>4096))return false;
      seen.add(item);
      for(const key in item) {
        if(!Object.hasOwn(item,key))continue;
        if(key==='__proto__')return false;
        characters+=key.length;
        if(!visit(item[key],depth+1))return false;
      }
      return true;
    }
    return visit(value,0);
  }
  function safe_structure(g) {
    const item=n=>n && typeof n.id==='string' && typeof n.name==='string';
    const scalar=v=>v==null || ['number','string','boolean'].includes(typeof v);
    let total=0;
    const steps=(items,depth=0)=>Array.isArray(items) && depth<=8 && items.length<=64 && items.every(s=>
      s && typeof s.id==='string' && typeof s.op==='string' &&
      ['object','function','symbol','test','value','count'].every(k=>scalar(s[k])) && ++total<=1024 && ['steps','elseSteps'].every(k=>s[k]===undefined||steps(s[k],depth+1)));
    return g?.version===1 && typeof g.name==='string' && Array.isArray(g.objects) && g.objects.length<=64 && g.objects.every(n=>item(n) && Object.hasOwn(model.operations,n.kind)) &&
      Array.isArray(g.threads) && g.threads.length<=32 && g.threads.every(n=>item(n)&&steps(n.steps)) && steps(g.mainSteps??[]) && Array.isArray(g.functions??[]) && (g.functions??[]).length<=32 && (g.functions??[]).every(n=>item(n)&&steps(n.steps));
  }
  class editor {
    constructor(root,options) {
      this.root=root; this.options=options;
      this.t=(zh,en)=>String(options.language||document.documentElement.lang).startsWith('zh')?zh:en;
      this.kind=key=>this.t(...(kinds[key]||kinds.thread));
      this.api=op=>Object.hasOwn(apis,op)?apis[op]:op;
      const initial=options.graph===undefined?model.example():options.graph;
      this.tooLarge=!bounded(initial);
      this.graph=this.tooLarge?null:clone(initial);
      this.file='src/main.c';this.objectKind='msgq';this.mode='architecture';this.selected=flow.mainId;
      this.build();
      this.refresh();
    }
    command(label,fn,id,title) {
      const b=button(label,fn,'vp-action');
      b.dataset.action=id;
      b.title=title||label;b.setAttribute('aria-label',b.title);
      return b;
    }
    build() {
      const t=this.t;
      this.shell=el('div','vp-editor');
      this.title=el('input','vp-title');this.title.dataset.field='graphName';
      this.title.setAttribute('aria-label',t('工程名称','Project name'));
      this.title.addEventListener('input',()=>this.change(g=>{g.name=this.title.value;},true));
      this.creation=select(t('线程创建','Thread creation'),[['static',t('静态定义','Static definition')],['dynamic',t('运行时创建','Create at run time')]],
        'static',v=>this.change(g=>{g.creation=v;}));
      this.errors=el('div','vp-warnings');this.errors.setAttribute('role','status');
      const frame=el('div','vp-viewport');
      this.status=el('p','vp-caption');this.status.setAttribute('aria-live','polite');
      this.zoomLevel=el('output','vp-percent','100%');
      this.inspector=el('section','vp-inspector');
      this.library=el('aside','vp-library');this.right=el('aside','vp-right');this.traceRoot=el('div','vp-trace');
      this.codeBody=el('div','vp-code-body');
      this.code=el('details','vp-code',el('summary','',t('生成的工程代码','Generated project code')),this.codeBody);
      this.code.addEventListener('toggle',()=>{if(this.code.open)this.showCode();});
      this.leftToggle=this.command(t('组件库','Library'),()=>this.drawer('left'),'library');
      this.rightToggle=this.command(t('检查器','Inspector'),()=>this.drawer('right'),'inspector');
      const suffix='-'+(++nextView);
      for(const [toggle,panel,name] of [[this.leftToggle,this.library,'library'],[this.rightToggle,this.right,'inspector']]){
        panel.id='vp-'+name+suffix;toggle.setAttribute('aria-controls',panel.id);
      }
      this.setDrawer('');
      this.shell.addEventListener('keydown',event=>{
        const side=this.shell.dataset.drawer;
        if(event.key!=='Escape' || !side)return;
        const toggle=side==='left'?this.leftToggle:this.rightToggle;
        if(!toggle.getClientRects().length)return;
        this.setDrawer('');toggle.focus();event.preventDefault();
      });
      const project=el('div','vp-project',this.title,el('label','vp-creation',t('线程创建','Thread creation'),this.creation),
        el('div','vp-toggles',this.leftToggle,this.rightToggle));
      const graph=el('section','vp-graph',this.tools(),frame,this.status);
      this.right.append(this.inspector,this.code,this.traceRoot);
      this.shell.append(project,this.errors,el('div','vp-body',this.library,graph,this.right));
      this.root.replaceChildren(this.shell);
      this.canvas=new ZephyrProgramCanvas(frame,{t,kind:this.kind,api:this.api,
        scale:value=>{const percent=value*100;this.zoomLevel.value=(percent<1?Number(percent.toPrecision(2)):Math.round(percent))+'%';},
        select:(id,edit)=>this.choose(id,edit),edge:id=>this.selectStep(id),
        move:(id,position)=>this.position(id,position)});
    }
    drawer(side){this.setDrawer(this.shell.dataset.drawer===side?'':side);}
    setDrawer(side){
      this.shell.dataset.drawer=side;
      this.leftToggle.setAttribute('aria-expanded',this.shell.dataset.drawer==='left');
      this.rightToggle.setAttribute('aria-expanded',this.shell.dataset.drawer==='right');
    }
    tools() {
      const t=this.t;
      const type=select(t('新增对象类型','New object type'),Object.keys(model.operations).map(k=>[k,this.kind(k)]),this.objectKind,v=>{this.objectKind=v;});
      type.dataset.field='objectKind';
      this.addButtons=el('div','vp-add-buttons',
        this.command(t('＋ 线程','＋ Thread'),()=>this.add('thread'),'thread'),
        this.command(t('＋ 函数','＋ Function'),()=>this.add('function'),'function'),
        el('div','vp-object-tools',type,this.command('＋',()=>this.add(this.objectKind),'object',t('添加所选内核对象','Add selected kernel object'))));
      const add=el('div','vp-map-modes');
      for(const [id,label] of [['architecture',t('架构','Architecture')],['flow',t('执行流程','Control flow')]]){
        add.append(this.command(label,()=>{this.mode=id;this.connecting=null;this.refresh();this.canvas.fit();},id));
      }
      this.join=this.command(t('连接节点','Connect nodes'),()=>{
        this.mode='architecture';this.connecting=this.connecting?null:{};this.refresh();
        this.updateMode();
      },'connect');
      const zoom=el('div','vp-tools-group vp-zoom',
        this.command('−',()=>this.canvas.zoom(1/1.25),'zoomOut',t('缩小','Zoom out')),this.zoomLevel,
        this.command('+',()=>this.canvas.zoom(1.25),'zoomIn',t('放大','Zoom in')),
        this.command('⌖',()=>this.canvas.fit(),'fit',t('定位全图 (Home)','Fit graph (Home)')),
        this.command('◎',()=>this.canvas.center(this.stepId||this.selected),'center',t('聚焦选中节点','Center selected node')));
      return el('div','vp-tools',add,this.join,zoom);
    }
    updateMode() {
      const t=this.t;
      this.join.setAttribute('aria-pressed',Boolean(this.connecting));
      this.status.textContent=this.connecting?(this.connecting.thread ?
        t('选择要连接的内核对象。','Select a kernel object to connect.') :
        t('选择发起操作的线程。','Select the thread that performs the operation.')):
        t('拖动空白处平移，Ctrl + 滚轮缩放；双击节点编辑。','Drag the background to pan. Ctrl + wheel to zoom. Double-click a node to edit.');
    }
    nodes(){return [...flow.owners(this.graph),...this.graph.objects];}
    id(prefix) {
      const nodes=this.nodes(),used=new Set(nodes.flatMap(n=>[n.id,n.name]));
      for(const owner of flow.owners(this.graph))flow.walk(owner.steps,s=>used.add(s.id));
      let index=1;
      while (used.has(prefix+'_'+index)) index++;
      return prefix+'_'+index;
    }
    add(kind) {
      const id=this.id(kind==='thread'?'worker':kind);
      this.selected=id;this.stepId=null;this.connecting=null;
      this.change(g=>{
        if(kind==='thread') g.threads.push({id,name:id,stack:1024,priority:3,initialValue:42,steps:[]});
        else if(kind==='function')(g.functions||(g.functions=[])).push({id,name:id,steps:[]});
        else g.objects.push({id,name:id,kind,...(kind==='mutex'?{}:{capacity:kind==='sem'?1:4})});
      });
      this.setDrawer('right');this.canvas.fit();this.focusName();
    }
    focusName() {
      const input=this.inspector.querySelector('[data-field=name]')||this.inspector.querySelector('[data-field=operation]');
      input?.focus();if(input?.tagName==='INPUT')input.select();
    }
    choose(id,edit) {
      if(id==='$program')id=flow.mainId;
      if(this.mode==='flow' && flow.findStep(this.graph,id)){
        this.selectStep(id);
        if(edit){this.setDrawer('right');this.inspector.querySelector('[data-field=operation]')?.focus();}
        return;
      }
      const node=this.nodes().find(n=>n.id===id);
      if(!node)return;
      if(this.connecting) {
        if(!node.kind) {
          this.connecting.thread=id; this.selectNode(id);
        } else if(this.connecting.thread) {
          const thread=this.connecting.thread;
          this.connecting=null;this.targetObject=id;this.selectNode(thread);
          this.inspector.querySelector('[data-field=operation]')?.focus();
          return;
        }
        this.updateMode();return;
      }
      this.selectNode(id);
      if(edit){this.setDrawer('right');this.focusName();}
    }
    selectNode(id) {
      this.selected=id;this.stepId=null;this.deleting=null;this.editing=false;
      if(this.mode==='flow' && this.graph.objects.some(o=>o.id===id))this.mode='architecture';
      this.refresh();
    }
    selectStep(id) {
      const m=flow.findStep(this.graph,id);
      if(!m){this.choose(id);return;}
      this.selected=m.owner.id;this.stepId=id;this.editing=true;this.deleting=null;this.targetObject=null;this.refresh();
    }
    change(edit,typing=false) {
      this.source=null;
      edit(this.graph);
      this.refresh(typing);
      this.options.onChange?.(clone(this.graph));
    }
    editNode(id,fields,typing=false) {
      const node=flow.reference(this.graph,id);if(node)this.change(()=>Object.assign(node,fields),typing);
    }
    position(id,position){
      if(id===flow.mainId || id==='$program'){
        this.change(g=>{g.layout={...g.layout,[id===flow.mainId?'main':'program']:position};});
        return;
      }
      const node=flow.reference(this.graph,id)||flow.findStep(this.graph,id)?.step;
      if(node)this.change(()=>Object.assign(node,position));
    }
    askDelete(id) {this.deleting=id;this.refresh();}
    removeNode(id) {
      this.deleting=null;this.selected=null;this.stepId=null;this.connecting=null;
      this.change(g=>{
        g.threads=g.threads.filter(th=>th.id!==id);g.objects=g.objects.filter(o=>o.id!==id);
        if(g.functions)g.functions=g.functions.filter(n=>n.id!==id);
        for(const owner of flow.owners(g)){
          const doomed=[];flow.walk(owner.steps,(s,steps)=>{if(s.object===id||s.function===id)doomed.push([steps,s]);});
          for(const [list,s] of doomed)list.splice(list.indexOf(s),1);
        }
      });
    }

    addStep(owner,current,place,fields) {
      const id=this.id('op');
      this.stepId=id;this.targetObject=null;this.editing=false;
      this.change(()=>{
        const step={id,...fields};
        if(place==='after' && current)current.steps.splice(current.index+1,0,step);
        else if(current && ['steps','elseSteps'].includes(place))(current.step[place]||(current.step[place]=[])).push(step);
        else flow.ownerSteps(this.graph,owner).push(step);
      });
    }
    updateStep(current,fields) {
      this.change(()=>{const {id,x,y}=current.step;current.steps[current.index]={id,...(x==null?{}:{x,y}),...fields};});
    }
    removeStep(current) {
      this.stepId=null;this.editing=false;
      this.change(()=>current.steps.splice(current.index,1));
    }
    reorder({steps,index},delta) {
      if(index+delta<0 || index+delta>=steps.length)return;
      this.change(()=>{const [step]=steps.splice(index,1);steps.splice(index+delta,0,step);});
    }
    refresh(typing=false) {
      this.diagnostics=this.tooLarge?[{field:'JSON',code:'size'}]:model.validate(this.graph);
      const safe=safe_structure(this.graph) && !this.diagnostics.some(issue=>issue.code==='id');
      this.errors.replaceChildren(...this.diagnostics.slice(0,8).map(issue=>el('p','',el('code','',issue.field),' · ',this.t(...(problems[issue.code]||[issue.code,issue.code])))));
      this.shell.querySelector('.vp-graph').hidden=!safe;this.inspector.hidden=!safe;this.library.hidden=!safe;
      this.title.disabled=this.creation.disabled=!safe;
      if(!safe){
        const t=this.t;
        this.errors.append(el('p','',t('无法绘制这个设计。请在 JSON 文本编辑器中修复上述字段，或缩减超出限制的嵌套与条目，再重新打开。','Cannot draw this design. Fix the fields above in a JSON text editor, or reduce the nesting and item count, then reopen it.')));
        this.title.value='';this.codeBody.replaceChildren();this.right.hidden=true;
        return;
      }
      this.right.hidden=false;
      this.title.value=this.graph.name;this.creation.value=this.graph.creation;
      const nodes=this.nodes();
      if(!nodes.some(n=>n.id===this.selected))this.selected=nodes[0]?.id;
      this.addButtons.querySelector('[data-action=thread]').disabled=this.graph.threads.length>=32;
      this.addButtons.querySelector('[data-action=object]').disabled=this.graph.objects.length>=64;
      this.addButtons.querySelector('[data-action=function]').disabled=(this.graph.functions?.length||0)>=32;
      this.libraryContent();
      const owner=flow.owners(this.graph).find(o=>o.id===this.selected)||flow.owners(this.graph)[0];
      const diagram=this.mode==='flow'?flow.flow(this.graph,owner,this.api,this.t):flow.architecture(this.graph,this.t);
      this.canvas.show(diagram,this.selected,this.stepId);this.updateMode();
      this.shell.querySelectorAll('.vp-map-modes button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.action===this.mode));
      if(!typing)this.inspector.replaceChildren(ZephyrProgramInspector.render(this,nodes.find(n=>n.id===this.selected)));
      if(this.code.open)this.showCode();
    }
    libraryContent(){
      const t=this.t,nodes=this.nodes();
      const focused=this.library.contains(document.activeElement)?document.activeElement.dataset.pick:null;
      const groups=[['main',t('入口','Entry point')],['thread',t('线程','Threads')],['function',t('函数','Functions')],['object',t('内核对象','Kernel objects')]];
      const list=el('nav','vp-tree');list.setAttribute('aria-label',t('程序结构','Program structure'));
      for(const [role,title] of groups){
        const items=nodes.filter(n=>(n.kind?'object':n.role)===role);
        if(!items.length)continue;
        const group=el('section','',el('h3','',title));
        for(const n of items){
          const b=button(n.name||n.id,()=>{this.choose(n.id);if(!this.connecting)this.setDrawer('right');},'vp-tree-node');
          b.dataset.pick=n.id;b.setAttribute('aria-pressed',n.id===this.selected);
          group.append(b);
        }
        list.append(group);
      }
      this.library.replaceChildren(el('h2','',t('组件库','Component library')),this.addButtons,list);
      if(focused)Array.from(list.querySelectorAll('[data-pick]')).find(b=>b.dataset.pick===focused)?.focus({preventScroll:true});
    }
    showTrace(event){
      if(event && this.diagnostics.length)return;
      const owner=event && flow.findStep(this.graph,event.stepId)?.owner;
      this.observed=owner?{...event,ownerId:owner.id}:null;
      if(this.observed && this.mode==='flow'){
        if(owner && owner.id!==this.selected){this.selected=owner.id;this.stepId=null;this.refresh();}
      }
      this.canvas.trace(this.observed);
      if(!this.observed){this.updateMode();if(this.code.open)this.showCode();return;}
      const source=this.sources(),line=source?.index[event.stepId];
      const excerpt=line?source.cLines[line-1].trim():'';
      this.status.replaceChildren(el('strong','',this.t('执行记录','Execution trace')+' · '+event.contextId+' → '+event.op+
        (event.value!=null?' · '+this.t('局部 value','Local value')+' = '+event.value:'')),line?el('code','vp-trace-source','src/main.c:'+line+'  '+excerpt):'');
      if(this.code.open){this.file='src/main.c';this.showCode();this.scrollLine();}
    }
    sources(){
      if(this.diagnostics.length)return;
      if(!this.source){
        const files=model.generate(this.graph);
        this.source={files,index:model.describe(this.graph).lines,cLines:files['src/main.c'].split('\n')};
      }
      return this.source;
    }
    scrollLine(){
      const target=this.codeBody.querySelector('.current');
      if(target){const box=target.parentElement;box.scrollTop=target.offsetTop-box.clientHeight/2;}
    }
    showCode() {
      if(this.diagnostics.length){this.codeBody.replaceChildren(el('p','vp-muted',this.t('修正上面的参数后即可查看生成代码。','Correct the highlighted parameters to preview code.')));return;}
      const source=this.sources(), {files,index}=source;
      const line=this.file==='src/main.c'?index[this.observed?.stepId||this.stepId||this.selected]:null;
      if(this.preview?.source===source && this.preview.file===this.file){
        this.markLine(line);return;
      }
      const picker=select(this.t('预览文件','Preview file'),Object.keys(files).map(k=>[k,k]),this.file,v=>{this.file=v;this.showCode();});
      const pre=el('pre','');pre.tabIndex=0;
      for(const text of this.file==='src/main.c'?source.cLines:files[this.file].split('\n'))pre.append(el('span','',text+'\n'));
      const focus=this.command(this.t('定位所选节点的 C 代码','Locate selected C code'),()=>{
        this.file='src/main.c';this.showCode();this.scrollLine();
      },'locate');
      this.codeBody.replaceChildren(el('div','vp-code-tools',picker,focus),pre);
      this.preview={source,file:this.file,pre};this.markLine(line);
    }
    markLine(line){
      const preview=this.preview;
      preview.current?.classList.remove('current');
      preview.current=preview.pre.children[line-1];
      preview.current?.classList.add('current');
    }
    setGraph(graph) {
      const tooLarge=!bounded(graph),next=graph!==undefined && !tooLarge?graph:null;
      if(tooLarge===this.tooLarge && JSON.stringify(next)===JSON.stringify(this.graph))return;
      this.tooLarge=tooLarge;
      this.source=null;this.observed=null;this.canvas.trace(null);this.graph=clone(next);this.connecting=null;this.deleting=null;
      this.refresh();
    }
    dispose(){this.canvas.dispose();this.shell.remove();}
  }
  return {bounded,mount:(root,options={})=>new editor(root,options)};
})();
