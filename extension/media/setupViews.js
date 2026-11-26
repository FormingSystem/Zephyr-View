'use strict';
const target_compiler = new compiler_selection(
  (scope,id) => host.postMessage({action:'compiler',id,scope,version:live?.version}),
  (scope,action) => host.postMessage({action,scope,version:live?.version})
);
const setupViews=(()=>{
  let data,group=0;
  const expanded_prefixes = new Map();
  const sections=()=>[
    [tr('主机工具','Host tools'),data.hostPrograms.filter(name=>!['python','west'].includes(name))],
    [tr('Python 环境','Python environment'),['python','west']],
    [tr('源码与工具链','Source and toolchain'),['ZEPHYR_BASE','ZEPHYR_TOOLCHAIN_VARIANT']],
    [tr('探针与驱动','Probes and drivers'),[]]
  ];
  const variable=name=>data.environmentRows.find(field=>field.name===name);
  function value(name){
    const field=variable(name);
    return data.tools[name]??field?.value??field?.cached;
  }
  function origin(name){
    const field=variable(name);
    if(field?.value!==undefined)return environment_value_origin(field.source);
    if(field?.cached!==undefined)return tr('进程未设置','Unset in process')+' · CMakeCache.txt';
    if(data.overrides.includes(name))return environment_value_origin('override');
    return data.tools[name]?tr('本机发现','Discovered'):'';
  }
  function entry(name){
    const v=value(name),override=data.overrides.includes(name);
    const field=variable(name),cacheOnly=field?.value===undefined&&field?.cached!==undefined;
    const label=name;
    const source=origin(name);
    const variant=name==='ZEPHYR_TOOLCHAIN_VARIANT';
    const variants = new Set(data.variants);
    if(field?.value)variants.add(field.value);
    const pick='<select id="variant-select" aria-label="ZEPHYR_TOOLCHAIN_VARIANT" '+(!data.folder||!data.trusted||data.busy?'disabled':'')+'><option value="">'+tr('自动选择','Automatic selection')+'</option>'+[...variants].map(v=>'<option '+(v===field?.value?'selected':'')+'>'+esc(v)+'</option>').join('')+'</select>';
    const disabled=!data.folder||!data.trusted||data.busy;
    const directory=['ZEPHYR_BASE','ZEPHYR_SDK_INSTALL_DIR'].includes(name);
    const manual=directory?b(tr('输入路径…','Enter path…'),'setup:path:'+name,'plain','',disabled):'';
    const installable=data.hostPrograms.includes(name)||name==='ZEPHYR_SDK_INSTALL_DIR';
    const sourceAction=name==='ZEPHYR_BASE'?b(tr('获取源码…','Get source…'),'setup:acquireSource','plain','',disabled):'';
    const actions=(variant?pick:b(tr('配置','Configure'),'setup:edit:'+name,'plain','',disabled))+manual+sourceAction+
      (installable?installActions(name,disabled):'')+(override?b(tr('恢复继承','Inherit'),'setup:inherit:'+name,'plain','',disabled):'');
    const status=cacheOnly?tr('构建缓存','Build cache'):v?tr('已识别','Detected'):variant?tr('自动','Automatic'):tr('未指定','Unset');
    const display = data.tools[name] ? ZephyrPathDisplay.path(v) : v;
    return environmentField(label,display||(variant?tr('由 Zephyr 选择','Selected by Zephyr'):'—'),source,actions,badge(status,v?'':'neutral'));
  }
  function installActions(name,disabled){
    return b(tr('安装…','Install…'),'setup:installComponent:'+name,'plain','',disabled)+
      b(tr('官方来源','Official source'),'setup:componentSource:'+name,'plain');
  }
  function runtimeVariable(field){
    const {name,value,source,cached,cacheKey,matches}=field;
    const shown=text=>text===''?tr('（空字符串）','(empty string)'):text;
    const recorded='CMakeCache.txt · '+cacheKey;
    if(value===undefined)return environmentField(name,shown(cached),recorded,'','',tr('进程未设置','Unset in process'));
    const same=matches&&source!=='cache'?tr('与构建缓存一致','Matches build cache'):'';
    const current=environmentField(name,shown(value),environment_value_origin(source),'','',same);
    if(cached===undefined||matches)return current;
    return current+environmentField(cacheKey,shown(cached),recorded,'','',tr('上次配置值','Last configured value'));
  }
  function processVariables(fields,cacheStatus){
    const visible=fields.filter(f=>f.value!==undefined||f.cached!==undefined);
    const unset=fields.filter(f=>f.value===undefined&&f.cached===undefined);
    const missing=unset.length?'<details class="detected-modules"><summary>'+
      tr('未设置的变量','Unset variables')+' · '+unset.length+'</summary><div class="environment-field"><div>'+
      unset.map(f=>'<code>'+esc(f.name)+'</code>').join(' · ')+'</div></div></details>':'';
    const empty=tr('当前构建环境和缓存中均未发现这些变量的值。','No values were found in the build environment or cache.');
    const notes={
      conflict:tr('缓存属于其他构建目标','Cache belongs to another target'),
      unknown:tr('缓存缺少目标信息','Cache target is unidentified')
    };
    return panel(tr('构建进程环境','Build environment'),(visible.map(runtimeVariable).join('')||wrap(empty))+missing,
      (notes[cacheStatus]?'<small>'+notes[cacheStatus]+'</small>':'')+
      (data.trusted&&data.folder&&data.environmentRegistration?
        b(tr('注册环境变量…','Register variable…'),'setup:registerEnvironment','plain'):''));
  }
  function environment(s){
    data=s;
    const groups=sections(),[title,names]=groups[group];
    const nav=groups.map(([label,entries],i)=>'<button data-act="setup:group:'+i+'" aria-pressed="'+(group===i)+'"><strong>'+esc(label)+'</strong>'+(i<2?'<small>'+entries.filter(value).length+' / '+entries.length+'</small>':'')+'</button>').join('');
    let content=names.map(entry).join('');
    if(group===0)content+=wrap(b(tr('工具搜索目录…','Tool search directories…'),'setup:toolDirectories','plain','',!s.folder||!s.trusted));
    if(group===3)content=wrap(b(tr('检测探针与驱动…','Inspect probes and drivers…'),'setup:probeSupport'));
    if(group===1)content+=environmentField(tr('Zephyr 构建依赖','Zephyr build dependencies'),'scripts/requirements-base.txt','',
      installActions('dependencies',!s.folder||!s.trusted||s.busy));
    if(group===2){
      content+=entry('ZEPHYR_SDK_INSTALL_DIR');
      let prefix=external_prefix_details(s);
      if(expanded_prefixes.get(s.folder))prefix=prefix.replace('<details ','<details open ');
      content+=target_compiler.render(s)+prefix;
    }
    const setup=b(tr('补齐缺失组件…','Set up missing components…'),'setup:installMissing','primary','',!s.folder||!s.trusted||s.busy);
    return workspaceSection('environment',tr('环境搭建','Environment setup'),setup+b(tr('重新检测','Detect again'),'setup:refresh','','refresh'),
      environmentSections('<div class="envgroups">'+nav+'</div>',panel(title,content),
        processVariables(s.environmentRows,s.environmentCacheStatus)));
  }
  function west(s){
    const open=b(tr('打开已有工作区','Open existing workspace'),'setup:folder','','folder')+(s.folder?b(tr('输入路径…','Enter path…'),'setup:folder:typed','plain'):'');
    let content;
    if(s.root){
      const details=row('topdir',ZephyrPathDisplay.path(s.root))+row('manifest',ZephyrPathDisplay.path(s.manifest)||'—','setup:manifest',tr('打开','Open'))+
        row(tr('本地配置','Local configuration'),'.west/config','setup:westConfig',tr('打开','Open'));
      const revisions=s.projects.slice(0,5).map(p=>row(esc(p.name),p.revision)).join('');
      const empty=s.invalid?tr('无法解析清单，请打开文件检查。','The manifest could not be parsed. Open the file to check it.')
        :tr('当前文件未读到直接声明的项目。','No project entries were read directly from this file.');
      const title=s.manifestScope==='effective'?tr('清单项目（含导入）','Resolved manifest projects'):
        tr('当前清单直接声明的项目','Projects declared in this manifest');
      const note=s.manifestScope==='partial'?wrap(tr('导入清单未解析，当前列表只包含直接声明的项目。','Imports are unresolved. Only directly declared projects are listed.')):'';
      content=panel(esc(s.root.split(/[\\/]/).pop()),wrap(details),b(tr('检查清单','Inspect manifest'),'setup:list','','',!s.tools.west||!s.trusted))+
        panel(title+' · '+s.projects.length,note+wrap(revisions||esc(empty)),b(tr('管理模块','Manage modules'),'page:modules','plain'));
    }else{
      content=panel(tr('尚未关联 west 工作区','No linked west workspace'),wrap(tr('可打开含 .west/config 的目录。独立应用可直接使用 CMake。','Open a directory containing .west/config, or build a standalone application with CMake.')));
    }
    return workspaceSection('west-workspace',tr('west 工作区','west workspace'),open,content);
  }
  function foundLocation(group){
    const label=group.key==='application'?tr('应用','Application'):group.key.replace(/^module:/,'');
    if(group.options.length===1){
      const item=group.options[0];
      return environmentField(label,ZephyrPathDisplay.directory(item.path),item.evidence);
    }
    const placeholder='<option value="">'+tr('选择一个候选项','Select a candidate')+'</option>';
    const items=group.options.map(item=>'<option value="'+esc(item.path)+'" '+(item.path===group.selected?'selected':'')+'>'+esc(ZephyrPathDisplay.directory(item.path))+'</option>');
    return '<label class="detected-choice"><strong>'+esc(label)+'</strong><select data-location="'+esc(group.key)+'">'+placeholder+items.join('')+
      '</select><small>'+esc(group.options[0].evidence)+'</small></label>';
  }
  function discoveryPanel(detected){
    if(!detected || detected.hidden || (!detected.groups.length&&!detected.conflicts?.length))return '';
    const modules=detected.groups.filter(g=>g.key.startsWith('module:'));
    const fields=detected.groups.filter(g=>!g.key.startsWith('module:')).map(foundLocation);
    if(modules.length)fields.push('<details class="detected-modules" '+(modules.some(g=>!g.selected)?'open':'')+'><summary>'+
      tr('本地模块','Local modules')+' · '+modules.length+'</summary>'+modules.map(foundLocation).join('')+'</details>');
    if(detected.conflicts?.length)fields.push('<details class="detected-modules"><summary>'+
      tr('同名模块沿用清单路径','Manifest paths used for duplicate modules')+'</summary>'+
      detected.conflicts.map(c=>environmentField(c.name,ZephyrPathDisplay.directory(c.path),tr('另一个本地目录：','Other local directory: ')+ZephyrPathDisplay.directory(c.other))).join('')+'</details>');
    if(!detected.groups.length)return fields.join('');
    const complete=detected.groups.every(g=>g.selected);
    const question=complete?tr('已临时采用能唯一识别的路径，是否保存到当前工作区？','Unambiguous paths are in use for this session. Save them to this workspace?'):tr('部分项目有多个候选。选定后可保存整组路径。','Some locations have multiple candidates. Select one for each before saving.');
    const save=b(tr('保存到工作区','Save to workspace'),'setup:locations:save','primary','',!complete);
    return panel(tr('自动识别','Detected locations'),fields.join(''),'',wrap('<p>'+question+'</p><div class="actions">'+save+
      b(tr('暂不保存','Not now'),'setup:locations:dismiss','plain')+'</div>'));
  }
  function workspace(s){
    const jump=b(tr('定位 west 工作区','Go to west workspace'),'setup:west');
    return heading(ZephyrPathDisplay.path(s.folder)||'Zephyr Extension',tr('工作区','Workspace'),'',jump)+
      discovery_diagnostics(s.discoveryIssues)+discoveryPanel(s.detected)+environment(s)+west(s);
  }
  document.addEventListener('click',e=>{
    const remove=e.target.closest('[data-remove-board-root]');
    if(remove&&!remove.disabled)return send('boardRootRemove',remove.dataset.removeBoardRoot);
    const item=e.target.closest('[data-act^="setup:"]');if(!item)return;
    const [,action,key]=item.dataset.act.split(':');
    if(action==='path')return send('environment',{name:key,typed:true});
    if(action==='group'){
      group=Number(key);
      document.getElementById('environment').outerHTML=environment(data);
      document.querySelector('[data-act="setup:group:'+group+'"]').focus({preventScroll:true});
    }else if(action==='west'){
      const section=document.getElementById('west-workspace');
      section.querySelector('button')?.focus({preventScroll:true});
      section.scrollIntoView({block:'start'});
    }
    else send(action==='edit'?'environment':action,key);
  });
  document.addEventListener('toggle',e=>{
    if(e.target.matches?.('[data-toolchain-details="prefix"]')&&e.target.isConnected)expanded_prefixes.set(data.folder,e.target.open);
  },true);
  document.addEventListener('change',e=>{
    if(e.target.dataset.location&&e.target.value)return send('locations',{key:e.target.dataset.location,value:e.target.value});
    if(e.target.id==='variant-select'){
      if(e.target.value)send('environment',{name:'ZEPHYR_TOOLCHAIN_VARIANT',value:e.target.value});
      else send('inherit','ZEPHYR_TOOLCHAIN_VARIANT');
    }
  });
  return {workspace};
})();
