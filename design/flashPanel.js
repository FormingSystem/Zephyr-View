'use strict';

const flashPanel = (() => {
  let model, selection={}, probes=[];
  const label=(cn,en)=>tr(cn,en);
  const option=(value,name,selected)=>'<option value="'+esc(value)+'"'+(value===selected?' selected':'')+'>'+esc(name)+'</option>';
  const status={
    runner:['当前镜像没有共同可用的烧写方式','No applicable flash runner for these images'],
    mixed:['请选单个镜像，为其指定目标设备','Select an individual image to choose its device'],
    device:['请选择探针或输入完整设备 ID','Select a probe or enter its complete device ID'],
    pinned:['设备 ID 与当前板配置不同','Device ID differs from the board configuration'],
    west:['可使用工程烧写任务，或安装并配置 west','Choose a workspace flashing task or configure west'],
    domain:['此版本的 west 仅支持逐一烧写镜像','This west version can flash one image at a time'],
    image:['请先构建固件','Build the firmware first']
  };
  function body(busy) {
    const result=ZephyrFlashPlan.plan(model,selection);
    const choose=(title,id,items,value)=>'<label>'+title+' <select data-flash="'+id+'">'+items.map(item=>option(...item,value)).join('')+'</select></label>';
    const domain=model.system ? choose(label('镜像','Image'),'domain',[
      ['',label('整机 · 工程顺序','System · project order')],...model.images.map(({name})=>[name,name])],selection.domain) : '';
    const defaults=[...new Set(result.images.map(image=>image.defaultRunner).filter(Boolean))];
    const runner=choose(label('烧写方式','Flash runner'),'runner',[['',label('工程默认','Project default')+
      (defaults.length?' · '+defaults.join(' / '):'')],...result.runners.map(name=>[name,name])],selection.runner);
    const list=probes.map(p=>option(p.id,p.label,'')).join('');
    const device=result.device ? '<label>'+label('设备 ID','Device ID')+
      ' <input data-flash="device" list="flash-probes" maxlength="512" placeholder="'+
      label('留空使用运行器默认设备','Leave empty for runner default')+'" value="'+esc(selection.device)+'"></label><datalist id="flash-probes">'+list+'</datalist>'+
      (result.names.every(name=>name==='pyocd')?b(label('扫描探针','Scan probes'),'flash:scan','plain','',busy):'') : '';
    const images=result.images.map((img,i)=>{
      const args=img.args?.[result.names[i]] || [];
      return '<li><b>'+esc(img.name)+'</b> · '+esc(img.board || '')+'<br><small>'+
        img.files.map(entry=>esc(ZephyrPathDisplay.path(entry.file))).join(' · ')+
        (args.length?'<br>'+label('板级参数','Board arguments')+' · '+esc(args.join(' ')):'')+'</small></li>';
    }).join('');
    const hint=result.issue ? label(...status[result.issue]) : '';
    return '<div class="flash-panel"><div class="flash-choices">'+domain+runner+device+'</div>'+
      (images?'<details><summary>'+label('镜像顺序与可用产物','Image order and available files')+'</summary><ol>'+images+'</ol></details>':'')+
      '<code class="flash-preview">'+esc(result.args ? ZephyrFlashPlan.command(model.west,result.args) : hint)+'</code>'+
      '<div class="flash-choices">'+b(label('烧写固件…','Flash firmware…'),'flash:run','primary','',busy||!result.args)+
      b(label('使用工程任务…','Use workspace task…'),'flash:task','','',busy)+
      b(label('探针与驱动…','Probe and driver…'),'flash:support','plain','',busy)+'</div></div>';
  }
  function render(state) {
    if (model?.id!==state.flash?.id) {selection={domain:'',runner:'',device:''}; probes=[];}
    model=state.flash;
    return '<details data-build-section="flash"><summary>'+label('固件烧写','Firmware flashing')+'</summary>'+
      (model ? body(state.busy) : '<p>'+(!state.flashLoaded && state.environmentCacheStatus==='current' && state.trusted ?
        label('正在读取运行器和固件…','Reading runners and firmware…') :
        label('配置并构建当前目标后，可在这里选择烧写方式。','Configure and build this target to choose a flash runner.'))+'</p>')+'</details>';
  }
  function redraw(root,busy) {
    const node=root.querySelector('[data-build-section="flash"] .flash-panel');
    if(node && model) node.outerHTML=body(busy);
  }
  function change(root, field, busy) {
    const key=field.dataset.flash;
    if (!model || !['runner','domain','device'].includes(key)) return;
    if (key==='device') return deviceInput(root,field,busy);
    selection[key]=field.value;
    if (key==='domain') selection.runner='';
    selection.device='';probes=[];
    redraw(root,busy);
  }
  function deviceInput(root,input,busy) {
    if (!model || input.dataset.flash!=='device') return;
    selection.device=input.value.trim();
    const result=ZephyrFlashPlan.plan(model,selection);
    root.querySelector('[data-act="flash:run"]').disabled=busy || !result.args;
    root.querySelector('.flash-preview').textContent=result.args ? ZephyrFlashPlan.command(model.west,result.args) : label(...status[result.issue]);
  }
  function action(key,dispatch=send) {
    if(!model) return;
    dispatch('flashAction',{...selection,id:model.id,op:key});
  }
  function receive(data) {
    if (data?.flashProbes!==model?.id || !Array.isArray(data?.probes)) return;
    probes=data.probes;
    const list=document.querySelector('#flash-probes');
    if(list)list.innerHTML=probes.map(p=>option(p.id,p.label,'')).join('');
    document.querySelector('[data-flash="device"]')?.focus();
  }
  window.addEventListener('message',({data})=>receive(data));
  return {render,change,deviceInput,action,receive};
})();
