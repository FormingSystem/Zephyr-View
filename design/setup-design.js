'use strict';
// Local fixtures for design review. Status changes never launch tools or access a disk.
const toolSpecs=[
 ['Python','主机工具','运行 Zephyr 的 Python 脚本','PATH','python --version','3.12.8'],
 ['CMake','主机工具','配置构建树','PATH','cmake --version','3.30.5'],
 ['Ninja','主机工具','执行当前生成器的构建规则','PATH','ninja --version','1.12.1'],
 ['Git','主机工具','清单仓库与版本管理','PATH','git --version','2.47.0'],
 ['DTC','主机工具','设备树编译器','PATH','dtc --version','1.7.2'],
 ['venv','Python 环境','应用使用的 Python 虚拟环境','.venv','python -m pip --version','venv'],
 ['packages','Python 环境','当前 Zephyr 版本的 Python 依赖','.venv','python -m pip check','示例依赖集'],
 ['west','Python 环境','west 工作区与命令扩展','.venv','west --version','1.4.0'],
 ['Zephyr','源码与工具链','Zephyr 源码 · ZEPHYR_BASE','zephyr','读取 VERSION 和 CMake 包','4.2.0'],
 ['SDK','源码与工具链','编译器与主机工具 · ZEPHYR_SDK_INSTALL_DIR','toolchains/zephyr-sdk','检查 SDK 元数据和目标编译器','0.17.4']
];
const groupNames=['主机工具','Python 环境','源码与工具链','探针与驱动'];
const envDefaults=()=>({group:0,platform:'Windows',variant:'zephyr',variants:{},scope:'环境默认',offline:true,overrides:{},values:Object.fromEntries(toolSpecs.map(([key,,,source])=>[key,{source,ok:true}]))});
function workspaceFixture(name='zephyr-lab',repo='zephyr',manifest='west.yml',mods=initial.modules){return {name,repo,manifest,mods:structuredClone(mods),last:'尚未检查远端'}}
function workspaceState(){return model.workspaces[model.activeWs]}
function appKey(){return model.source||'samples/'+model.app}
function activeVariant(){return model.env.variants[appKey()]||model.env.variant}
function settingsFor(key){const e=model.env;return e.overrides[appKey()]?.[key]||e.values[key]}
function exampleEnvironment(){
  const origin=k=>settingsFor(k).origin||(model.env.overrides[appKey()]?.[k]?'当前工程覆盖':'环境默认');
  return [
    {name:'ZEPHYR_BASE',value:settingsFor('Zephyr').source,source:origin('Zephyr')},
    {name:'ZEPHYR_TOOLCHAIN_VARIANT',value:activeVariant(),source:model.env.variants[appKey()]?'当前工程覆盖':'环境默认'},
    {name:'ZEPHYR_SDK_INSTALL_DIR',value:settingsFor('SDK').source,source:origin('SDK')},
    {name:'CROSS_COMPILE',value:model.env.workspacePrefix,source:'override'}
  ].filter(row=>row.value);
}
function variablesPanel(){
  const names=[
    'ZEPHYR_BASE','ZEPHYR_TOOLCHAIN_VARIANT','ZEPHYR_SDK_INSTALL_DIR','CROSS_COMPILE',
    'BOARD','BOARD_ROOT','SOC_ROOT','ARCH_ROOT','DTS_ROOT','SHIELD','TOOLCHAIN_ROOT',
    'GNUARMEMB_TOOLCHAIN_PATH','LLVM_TOOLCHAIN_PATH','ZEPHYR_MODULES','EXTRA_ZEPHYR_MODULES','ZEPHYR_EXTRA_MODULES',
    'VIRTUAL_ENV','WEST_PYTHON','CMAKE_GENERATOR','CMAKE_BUILD_TYPE','CMAKE_BUILD_PARALLEL_LEVEL',
    'CMAKE_PREFIX_PATH','CMAKE_TOOLCHAIN_FILE','CONF_FILE','EXTRA_CONF_FILE','DTC_OVERLAY_FILE','EXTRA_DTC_OVERLAY_FILE'
  ];
  const environment=new Map(exampleEnvironment().map(row=>[row.name,row]));
  const cache=matchingExampleCache()?.values||{};
  const rows=names.filter(name=>environment.has(name)||Object.hasOwn(cache,name));
  const unset=names.filter(name=>!rows.includes(name));
  const body=rows.map(name=>{
    const input=environment.get(name),cached=cache[name];
    if(!input)return environmentField(name,cached.value,'CMakeCache.txt','','','进程未设置');
    if(!cached||input.value===cached.value)return environmentField(name,input.value,input.source,'','',cached?'与构建缓存一致':'');
    return exampleVariableRow(name,input,cached);
  }).join('');
  const note=exampleCache()&&!matchingExampleCache()?'<small>缓存属于其他构建目标。</small>':'';
  return panel('构建进程环境',body+exampleVariableDetails('未设置的变量',unset,esc),'<small>示例环境</small>',note);
}
function needed(key){return model.method==='west'||!['west','Git'].includes(key)}
function missingTools(){return toolSpecs.filter(([k])=>needed(k)&&!settingsFor(k).ok)}
function commitDemo(){publish();render()}
function invalidate(){if(model.env)model.env.report='';model.configured=false;model.built=false}
function initDemo(){model.env=envDefaults();model.workspaces={'zephyr-lab':workspaceFixture()};model.activeWs='zephyr-lab';model.bin='';model.image='';model.lastTask='';model.flow='build';model.prefs={}}
function groupTabs(labels,current,cmd){return '<div class="picktabs">'+labels.map((l,i)=>'<button data-act="'+cmd+':'+i+'" aria-pressed="'+(current===i)+'">'+esc(l)+'</button>').join('')+'</div>'}
function environmentPage(){const env=model.env,missing=missingTools(),group=groupNames[env.group];
 const navList='<div class="envgroups">'+groupNames.map((name,i)=>{const items=toolSpecs.filter(s=>s[1]===name);return '<button data-act="envgroup:'+i+'" aria-pressed="'+(env.group===i)+'"><strong>'+name+'</strong>'+(items.length?'<small>'+items.filter(s=>settingsFor(s[0]).ok).length+' / '+items.length+'</small>':'')+'</button>'}).join('')+'</div>';
 function entry(spec){const [k,,purpose,,check,ver]=spec,effective=settingsFor(k),rec=env.scope==='当前工程'?effective:env.values[k],override=model.env.overrides[appKey()]?.[k];
 const purposeText=purpose;
 const source=(env.scope==='环境默认'?'环境默认':override?'工程覆盖':'继承环境默认')+' · '+(rec.ok?ver:'待验证');
 return environmentField(k,ZephyrPathDisplay.path(rec.source)||'未指定',source,b('配置','tool:'+k,'plain'),badge(rec.ok?'可用（示例）':rec.source?'待验证':'待配置',rec.ok?'':'warn'),purposeText);}

 const delivery=panel('环境准备',wrap('<div class="actions">'+b('准备安装方案','envplan')+b('配置工具链','envvariant')+b('使用说明','envhelp','plain')+'</div><small>主机平台：'+esc(env.platform)+' · 工具链：'+esc(activeVariant())+'</small>'));
 const scope=groupTabs(['环境默认','当前工程'],env.scope==='当前工程'?1:0,'envscope');
 const state=demo_environment_state();
 const target_tools=env.group===2?demo_compiler.render(state)+external_prefix_details(state):'';
 const groupContent=env.group===3?panel(group,wrap(b('检测探针与驱动…','demoProbe:open'))):
   panel(group,toolSpecs.filter(s=>s[1]===group).map(entry).join('')+target_tools,scope);
 return workspaceSection('environment','环境搭建',b('切换示例环境','envprofile')+b('验证环境','envcheck','','refresh')+b(model.method==='west'?'west 一键搭建':'本地 CMake 搭建','contextsetup','primary'),
 '<div class="envstrip">'+badge(missing.length?'构建缺 '+missing.length+' 项':'构建工具就绪',missing.length?'warn':'')+'<span>'+esc(model.board)+'</span>'+b(env.offline?'来源策略：离线':'来源策略：允许联网','policy','plain')+'</div>'+environmentSections(navList,groupContent,variablesPanel(),delivery+panel('验证记录',wrap('<p>'+esc(env.report||'尚未运行本轮验证。可逐项查看检测依据。')+'</p><small>'+toolSpecs.filter(s=>s[1]===group).map(s=>esc(s[4])).join('　·　')+'</small>'))))}
function settingRecord(key,value){const e=model.env;if(e.scope==='当前工程'){(e.overrides[appKey()]??={})[key]=value}else e.values[key]=value;invalidate()}
function toolDialog(k){const spec=toolSpecs.find(s=>s[0]===k),env=model.env,rec=settingsFor(k);
 show(k+' · '+env.scope,'<p>'+esc(spec[2])+'</p><small>当前应用实际采用</small><code>'+esc(ZephyrPathDisplay.path(rec.source)||'未配置')+'</code><small>验证依据：'+esc(spec[4])+'</small>'+
 b('采用示例中已发现的本地工具','known:'+k)+b('指定本地位置…','local:'+k)+(['SDK','packages','west','venv','Zephyr'].includes(k)?b('查看离线准备与在线安装','prepare:'+k):'')+
 (env.scope==='当前工程'&&env.overrides[appKey()]?.[k]?b('恢复继承','inherit:'+k):''))}
const recipes={
 venv:['python -m venv .venv','选用虚拟环境内的解释器，Windows 使用 Scripts，Ubuntu 和 macOS 使用 bin。'],
 packages:['python -m pip install --no-index --find-links <wheelhouse> -r <当前源码的依赖文件>','先由当前 checkout 确认依赖集合和约束，需要的 wheel 必须匹配平台、架构与 Python 版本。'],
 west:['python -m pip install --no-index --find-links <wheelhouse> west','在选定的虚拟环境安装。已有可运行的 west 可以直接选择。'],
 Zephyr:['ZEPHYR_BASE=<已解包的源码目录>','也可使用已经导出的 Zephyr CMake 包。选择源码路径本身不会下载模块。'],
 SDK:['ZEPHYR_TOOLCHAIN_VARIANT=zephyr\nZEPHYR_SDK_INSTALL_DIR=<已安装的 SDK 目录>','从本地包安装或解包到独立目录，按所选版本执行 SDK setup，核对目标架构。使用外部工具链时改选对应 variant 及工具链目录。']};
const installHosts = {
 Windows:['Windows 10 / 11','WinGet、官方安装包或已有工具','.venv/Scripts/python.exe'],
 Linux:['Ubuntu','APT、本地 DEB 或已有工具','.venv/bin/python'],
 macOS:['macOS','Homebrew、官方 PKG / DMG 或已有工具','.venv/bin/python']
};
function installPlan(env) {
 const keys=Object.keys(installHosts),current=Object.hasOwn(installHosts,env.platform)?env.platform:'Windows';
 const [,tools,python]=installHosts[current];
 const steps=['主机工具：'+tools,'Python 环境：'+python,'Python 包：匹配当前源码的依赖集',
  'Zephyr 源码：本地目录或清单仓库','SDK：所选版本须提供匹配主机系统和 CPU 的包，并包含开发板所需工具链'];
 const mode=env.offline?'离线准备：选择本地安装包、Python wheels 和 SDK。':'在线准备：选择版本和来源，核对安装位置。';
 return show('环境安装方案',groupTabs(keys.map(key=>installHosts[key][0]),keys.indexOf(current),'envos')+
  '<p>'+esc(mode)+'</p><div class="planlist">'+steps.map(step=>'<div>'+esc(step)+'</div>').join('')+'</div>'+b('演示应用此方案','envapply','primary'));
}
function envAction(a,v){const env=model.env;
 if(a==='envmethod'){model.method=Number(v)?'CMake':'west';invalidate();commitDemo();return true}
 if(a==='envhelp')return show('环境搭建指南','<ol><li>发现或指定 Python、CMake、Ninja 等主机工具。</li><li>选择本地 Zephyr 源码和 Python 环境，按该版本安装依赖。</li><li>选择 SDK 或外部工具链，核对板所需架构。</li><li>使用 west 时关联工作区；独立应用可直接用 CMake。</li><li>验证后为当前应用配置并编译，最后验证探针与运行器。</li></ol>');
 if(a==='envplan')return installPlan(env);
 if(a==='envos'){env.platform=Object.keys(installHosts)[Number(v)]||'Windows';$('#dialog').close();return installPlan(env)}
 if(a==='envapply'){for(const spec of toolSpecs.filter(s=>needed(s[0])))settingRecord(spec[0],{source:spec[3],ok:true});env.report='示例准备完成 · '+env.platform+'。请运行环境验证后配置应用。';$('#dialog').close();commitDemo();return true}
 if(a==='envvariant'){show('工作区工具链','<label>ZEPHYR_TOOLCHAIN_VARIANT<select id="variant"><option>zephyr</option><option>cross-compile</option></select></label>'+b('应用','envsetvariant','primary'));$('#variant').value=activeVariant();return true}
 if(a==='envsetvariant'){const variant=$('#variant').value;if(env.scope==='当前工程')env.variants[appKey()]=variant;else env.variant=variant;$('#dialog').close();invalidate();commitDemo();return true}

 if(a==='envgroup')env.group=Number(v);
 else if(a==='envscope')env.scope=['环境默认','当前工程'][Number(v)];
 else if(a==='policy')env.offline=!env.offline;
 else if(a==='envprofile')return show('选择评审场景',b('新机器 · 从零搭建','profile:empty')+b('现有环境 · 本地工具已发现','profile:ready'));
 else if(a==='profile'){$('#dialog').close();model.env=envDefaults();if(v==='empty'){for(const r of Object.values(model.env.values)){r.source='';r.ok=false}model.activeWs='';model.method='CMake'}else{model.activeWs=Object.keys(model.workspaces)[0];model.method='west'}invalidate()}
 else if(a==='envcheck'){const gaps=missingTools().map(s=>s[0]);env.report=gaps.length?'仍需处理：'+gaps.join('、'):'示例工具链完整。生产版随后对当前应用做配置和编译冒烟测试。';notify('示例验证已完成')}
 else if(a==='tool')return toolDialog(v);
 else if(a==='prepare'){const [cmd,hint]=recipes[v];$('#dialog').close();return show(v+' · 安装方案','<p>'+hint+'</p><pre class="terminal">'+esc(cmd)+'</pre><small>'+esc(env.offline?'离线模式：选择已准备的包或安装目录。':'允许联网：按选择的版本、平台和来源预览下载计划，确认后获取。')+'</small>'+b('使用本地位置…','local:'+v))}
 else if(a==='local'){$('#dialog').close();return show(v+' · 本地来源',locationInput('local-path','本地位置','',!['SDK','venv','packages','Zephyr'].includes(v))+b('采用位置','source:'+v,'primary'))}
 else if(a==='known'||a==='source'){const spec=toolSpecs.find(s=>s[0]===v);const source=a==='known'?spec[3]:$('#local-path').value.trim();if(!source)return;settingRecord(v,{source,ok:a==='known'||source===spec[3]});$('#dialog').close()}
 else if(a==='inherit'){delete env.overrides[appKey()][v];if(v==='SDK')delete env.variants[appKey()];invalidate();$('#dialog').close()}
 else if(a==='projecttools'){env.scope='当前工程';return go('workspace')}
 else return false;
 commitDemo();return true}
function workspacePage(){
 return heading(ZephyrPathDisplay.path(workspaceState()?.name||model.app),'工作区','',b('定位 west 工作区','wsjump'))+discoveredWorkspace()+environmentPage()+westWorkspaceSection();
}
function westWorkspaceSection(){const w=workspaceState();
 const missing=['west','Git'].filter(k=>!settingsFor(k).ok);const setupWarning=missing.length?'<div class="envstrip">'+badge('初始化缺少 '+missing.join('、'),'warn')+b('配置工作区工具','wssetup','plain')+'</div>':'';
 const buttons=b('打开已有','wsopen','','folder')+b('初始化…','wsinit','primary');
 const section=content=>workspaceSection('west-workspace','west 工作区',buttons,setupWarning+content);
 if(!w)return section(panel('尚未关联工作区',wrap('<p>打开含 .west 的已有目录，或从本地清单仓库初始化。</p>'),badge('未关联','neutral')));
 return section('<div class="layout"><div class="stack">'+panel(esc(ZephyrPathDisplay.path(w.name)),wrap(row('根目录 · topdir',ZephyrPathDisplay.path(w.name))+row('清单仓库',ZephyrPathDisplay.path(w.repo))+row('清单文件',ZephyrPathDisplay.path(w.repo+'/'+w.manifest),'wsedit','编辑')+row('本地配置','.west/config')),badge('当前工作区'))+
 panel('工作区操作',wrap('<div class="actions">'+b('检查清单','wsinspect')+b('预览全量更新','wsupdate')+b('解除关联','wsleave','plain')+'</div>'))+'</div><div class="stack">'+panel('清单模块',wrap(row('清单记录',String(w.mods.filter(m=>!m[5]||m[5].kind==='workspace').length))+row('已选模块',String(w.mods.filter(m=>m[4]&&(!m[5]||m[5].kind==='workspace')).length))+b('读入本工作区的清单…','wsfile','plain')+'<input type="file" id="workspace-manifest-file" hidden accept=".yaml,.yml">'),b('管理模块','page:modules','plain','modules'))+panel('检查结果',wrap('<p>'+esc(w.last)+'</p>'))+'</div></div>')}
function wsAction(a,v){const w=workspaceState();
 if(a==='wsjump'){const section=$('#west-workspace');section.querySelector('button')?.focus({preventScroll:true});section.scrollIntoView({block:'start'});return;}
 if(a==='wsfile')return $('#workspace-manifest-file').click();
 if(a==='wssetup'){model.method='west';model.env.group=!settingsFor('west').ok?1:0;return go('workspace')}
 if(a==='wsopen')return show('打开已有工作区',b('浏览本机工作区…','wsbrowse','','folder')+'<p>或切换到已登记的示例工作区。</p>'+Object.keys(model.workspaces).map(n=>b(ZephyrPathDisplay.path(n),'wschoose:'+encodeURIComponent(n))).join(''));
 else if(a==='wsbrowse')return browseWestWorkspace();
 else if(a==='wschoose'){model.activeWs=decodeURIComponent(v);invalidate();$('#dialog').close()}
 else if(a==='wsinit'&&['west','Git'].some(k=>!settingsFor(k).ok))return show('先准备工作区工具','<p>创建工作区需要可用的 west 和 Git。当前应用仍可使用 CMake。</p>'+b('配置工作区工具','wssetupfromdialog','primary'));
 else if(a==='wssetupfromdialog'){$('#dialog').close();return wsAction('wssetup')}
 else if(a==='wsinit')return show('初始化 west 工作区',b('使用本地清单仓库','wsform:local')+b('从 Git URL 获取清单','wsform:remote','', '',model.env.offline)+'<small>'+esc(model.env.offline?'离线策略已启用。在线初始化需先允许联网。':'在线初始化会克隆清单仓库。')+'</small>');
 else if(a==='wsform'){$('#dialog').close();return show('初始化 · '+(v==='local'?'本地清单':'远端清单'),'<label>'+ (v==='local'?'本地清单仓库':'清单仓库 URL')+'<input id="wsrepo" class="input" value="'+(v==='local'?'lab-new/manifest':'https://github.com/zephyrproject-rtos/zephyr')+'"></label>'+(v==='local'?b('浏览目录…','pathfield:wsrepo:directory','plain'):'')+(v==='remote'?locationInput('wsroot','新工作区目录','lab-new')+'<label>清单分支或标签<input id="wsrev" class="input" value="main"></label>':'')+locationInput('wsfile','清单文件','west.yml',true)+b('预览初始化','wspreview:'+v,'primary'))}
 else if(a==='wspreview'){const repo=$('#wsrepo').value.trim().replaceAll('\\','/').replace(/\/+$/,''),file=$('#wsfile').value.trim(),local=v==='local',root=local?repo.slice(0,repo.lastIndexOf('/')):$('#wsroot').value.trim(),rev=local?'':$('#wsrev').value.trim();if(!repo||!file||!root||(local&&!repo.includes('/'))||(!local&&!rev)){notify('请填写清单和工作区位置');return}if(Object.hasOwn(model.workspaces,root)||['__proto__','constructor','prototype'].includes(root)){notify('此工作区名称已存在或不可用');return}const command=local?'west init -l --mf "'+file+'" "'+repo+'"':'west init -m "'+repo+'" --mr "'+rev+'" --mf "'+file+'" "'+root+'"';const sample=(local&&repo==='lab-new/manifest'&&file==='west.yml')||(!local&&repo==='https://github.com/zephyrproject-rtos/zephyr'&&file==='west.yml');pendingWorkspace=workspaceFixture(root,repo.split('/').pop().replace(/\.git$/,''),file,sample?initial.modules.map(m=>[m[0],'示例清单',m[2],'未下载',false]):[]);pendingWorkspace.last=sample?'示例清单已解析。模块尚未下载。':'自定义位置待实际读取。';$('#dialog').close();return show('确认初始化', '<pre class="terminal">'+esc(command)+'</pre><p>新根目录：'+esc(ZephyrPathDisplay.path(root))+'。初始化后检查有效清单，再选择需要同步的模块。</p>'+b('应用到示例','wscreate','primary'))}
 else if(a==='wscreate'&&pendingWorkspace){const n=pendingWorkspace.name;model.workspaces[n]=pendingWorkspace;model.activeWs=n;pendingWorkspace=null;invalidate();$('#dialog').close()}
 else if(a==='wsedit'){return show('修改工作区清单',locationInput('manifestrepo','manifest.path · 相对工作区根',w.repo)+locationInput('manifestfile','manifest.file · 相对清单仓库',w.manifest,true)+'<small>只演示修改本地 .west/config。切换清单后需重新解析模块。</small>'+b('预览变更','wseditpreview','primary'))}
 else if(a==='wseditpreview'){const repo=$('#manifestrepo').value.trim(),manifest=$('#manifestfile').value.trim();if(![repo,manifest].every(v=>v&&!/^([a-z]:|[/\\\\])/i.test(v)&&!v.split(/[/\\\\]/).includes('..'))){notify('请使用工作区内的相对路径');return}pendingManifest={repo,manifest};$('#dialog').close();return show('确认清单变更','<pre class="terminal">'+esc('west config --local manifest.path "'+repo+'"\nwest config --local manifest.file "'+manifest+'"')+'</pre>'+b('采用配置','wseditsave','primary'))}
 else if(a==='wseditsave'){if(w.repo!==pendingManifest.repo||w.manifest!==pendingManifest.manifest){Object.assign(w,pendingManifest);delete w.importedManifest;w.mods=[];w.last='清单已变更，等待解析。';invalidate()}pendingManifest=null;$('#dialog').close()}
 else if(a==='wsinspect'){w.last='示例清单已检查 · '+w.mods.length+' 条模块记录。生产版通过 west topdir、west manifest --path 和 west list 核对。'}
 else if(a==='wsupdate')return openSyncPlan(w.mods.filter(m=>!m[5]||m[5].kind==='workspace'),true);
 else if(a==='wsleave'){model.activeWs='';model.method='CMake';invalidate()}
 else return false;
 commitDemo();return true}
let pendingWorkspace,pendingManifest;

async function browseWestWorkspace(){
  const handle=await chooseBrowserEntry(true);
  if(!handle)return;
  if(!handle.getDirectoryHandle)return notify('此浏览器仅返回目录名，请在 VS Code 打开已有工作区。');
  try{
    const west=await handle.getDirectoryHandle('.west');
    const config=await (await west.getFileHandle('config')).getFile();
    if(config.size>1024*1024)throw Error('工作区配置文件过大。');
    const text=await config.text();
    const section=/^\s*\[manifest\][^\n]*\n((?:(?!^[ \t]*\[)[\s\S])*)/im.exec(text)?.[1]||'';
    const repo=/^[ \t]*path[ \t]*=[ \t]*(.+?)\s*$/im.exec(section)?.[1];
    const filename=/^[ \t]*file[ \t]*=[ \t]*(.+?)\s*$/im.exec(section)?.[1]||'west.yml';
    if(!repo)return notify('所选目录缺少有效的 .west/config manifest.path。');
    const record=workspaceFixture(handle.name,repo,filename,[]);
    record.last='已读取 .west/config；可在下方读取清单以查看项目。';
    Object.defineProperty(model.workspaces,handle.name,{value:record,writable:true,enumerable:true,configurable:true});
    model.activeWs=handle.name;$('#dialog').close();invalidate();commitDemo();
  }catch(error){notify(error.name==='NotFoundError'?'所选目录缺少 .west/config。':error.message);}
}


// These candidates describe one illustrative project tree; the browser does not traverse the host.
const discoveryExample=[
  ['source','Zephyr 源码','VERSION + share/zephyr-package/cmake/ZephyrConfig.cmake',['zephyr']],
  ['sdk','Zephyr SDK','sdk_version + cmake/Zephyr-sdkConfig.cmake',['toolchains/zephyr-sdk']],
  ['app','应用','CMakeLists.txt → find_package(Zephyr)',['samples/hello_world','samples/synchronization']],
  ['module','本地模块','zephyr/module.yml',['modules/hal/example_sensor']]
];
function discoveredWorkspace(){
  const active=model.activeDiscovery;
  const rows=discoveryExample.map(([key,title,evidence,paths])=>
    '<div class="environment-field"><label>'+esc(title)+' <small>'+esc(evidence)+'</small><select data-discovery="'+key+'">'+
    paths.map(path=>'<option value="'+esc(path)+'" '+(active?.[key]===path?'selected':'')+'>'+esc(ZephyrPathDisplay.path(path))+'</option>').join('')+'</select></label></div>').join('');
  const saved=active&&JSON.stringify(active)===JSON.stringify(model.savedDiscovery);
  const status=saved?'已保存至演示工作区':active?'临时使用':'待选择';
  return '<details class="panel"><summary>初始工作区识别 · 示例数据 · '+status+'</summary>'+rows+
    wrap('<div class="actions">'+b('临时使用','discoveryapply')+b('保存到演示工作区','discoverysave')+'</div>')+'</details>';
}
function applyDiscovery(save){
  const pick=Object.fromEntries([...document.querySelectorAll('[data-discovery]')].map(input=>[input.dataset.discovery,input.value]));
  if(!pick.app)return;
  if(pick.app!==appKey()&&Object.keys(draft).length)return notify('请先处理当前工程配置草稿。');
  model.source=pick.app;model.app=pick.app.split('/').pop();
  const overrides=model.env.overrides[appKey()]??={};
  const origin=save?'工作区设置 · 已保存识别结果':'自动识别 · 临时使用';
  overrides.Zephyr={source:pick.source,ok:true,origin};
  overrides.SDK={source:pick.sdk,ok:true,origin};
  const modules=currentModules(),name=pick.module.split('/').pop();
  if(!modules.some(item=>item[0]===name))modules.push([name,'工作区识别 · 示例','本地目录','本地已识别',true,{kind:'local',path:pick.module}]);
  model.activeDiscovery=pick;
  if(save)model.savedDiscovery={...pick};
  invalidate();commitDemo();
  notify(save?'已保存到演示工作区，刷新页面会复位。':'当前演示临时采用此组候选。');
}

