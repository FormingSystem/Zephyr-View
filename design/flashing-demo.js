'use strict';

// These records describe sample builds. The design preview has no process or USB bridge.
const probeExamples={
  pyocd:['CMSIS-DAP · pyOCD','pyocd','DAPLink','https://pyocd.io/docs/installing.html'],
  jlink:['J-Link · SEGGER','JLink','J-Link','https://www.segger.com/downloads/jlink/'],
  stm32cubeprogrammer:['ST-LINK · STM32CubeProgrammer','STM32_Programmer_CLI','ST-LINK','https://www.st.com/en/development-tools/stm32cubeprog.html'],
  'dfu-util':['USB DFU · dfu-util','dfu-util','USB DFU','https://dfu-util.sourceforge.net/'],
  serial:['USB 串口 · UART / CDC ACM','','CDC ACM','https://docs.zephyrproject.org/latest/develop/flash_debug/host-tools.html']
};
let pendingDemoFlash;

function demoFlashModel() {
  if (!model.configured) return;
  const root=dir(), nordic=model.board.startsWith('nrf5340dk/nrf5340/');
  const system=Boolean(model.system && nordic && model.board.endsWith('/cpuapp'));
  const runners=nordic ? ['nrfutil','nrfjprog','jlink'] : model.board==='mps2/an386' ? ['pyocd'] : [];
  const order=system?['remote',model.app]:[model.app];
  const images=order.map(name=>{
    const directory=system?root+'/'+name:root;
    const board=name==='remote'?'nrf5340dk/nrf5340/cpunet':model.board;
    return {name,board,dir:directory,runners,defaultRunner:runners[0],deviceIds:{},
      args:runners[0]==='pyocd'?{pyocd:['--target=cortex_m']}:{},
      files:model.built?['elf','hex','bin'].map(ext=>({file:directory+'/zephyr/zephyr.'+ext})):[]};
  });
  return {id:JSON.stringify([model.board,appKey(),root,system,model.built,settingsFor('west').ok]),images,system,root,order,
    west:settingsFor('west').ok?'west':undefined,domainFlag:true,noRebuild:'--no-rebuild',
    caps:Object.fromEntries(runners.map(name=>[name,{flash:true,device:true}]))};
}

function demoFlashAction(action,selection) {
  const sample=demoFlashModel();
  if (action!=='flashAction' || !sample || sample.id!==selection.id) return;
  const request=ZephyrFlashPlan.plan(sample,selection);
  if (selection.op==='support') return openDemoProbeList(request.names[0]);
  if (selection.op==='scan') {
    const probes=demoProbeDevices('pyocd').map(device=>({id:device.id,label:device.name}));
    flashPanel.receive({flashProbes:sample.id,probes});
    return notify(probes.length?'已找到 2 个示例探针，可在设备 ID 中选择。':'当前示例未连接探针。');
  }
  if (selection.op==='task') {
    pendingDemoFlash={id:sample.id,name:'工程任务 · vendor flash'};
    return show('工程烧写任务 · 示例', '<p>当前工程的 .vscode/tasks.json</p><code>vendor flash</code>'+
      b('确认演示','demoFlash:finish','primary'));
  }
  if (selection.op!=='run' || !request.args) return;
  const command=ZephyrFlashPlan.command(sample.west,request.args);
  pendingDemoFlash={id:sample.id,name:'烧写 · '+(selection.device || '运行器默认设备')};
  const images=request.images.map((image,i)=>'<li>'+esc([image.name,image.board,request.names[i]].join(' · '))+'</li>');
  show('确认烧写 · 示例','<ol>'+images.join('')+'</ol><code>'+esc(command)+'</code>'+
    b('确认演示','demoFlash:finish','primary'));
}

function demoFlashConfirm(op) {
  if (op!=='finish' || !pendingDemoFlash) return;
  const pending=pendingDemoFlash;
  pendingDemoFlash=undefined;
  $('#dialog').close();
  if (pending.id!==demoFlashModel()?.id) return notify('目标已更改，请重新查看预览。');
  model.lastTask=pending.name;
  commitDemo();
  notify('演示任务完成 · 退出码 0');
}

function demoProbeDevices(id) {
  if (id!=='pyocd') return [];
  return [{name:'DAPLink · 演示板 A',id:'DEMO-001',status:'present'},
    {name:'DAPLink · 演示板 B',id:'DEMO-002',status:'present'}];
}
function openDemoProbeList(id) {
  model.env.group=3;
  go('workspace');
  const target=Object.hasOwn(probeExamples,id)?$('[data-probe-id="'+id+'"]'):$('#probe-panel');
  target?.focus({preventScroll:true});
  target?.scrollIntoView({block:'nearest'});
}
function demoProbeList() {
  const rows=Object.entries(probeExamples).map(([id,[label,program]])=>{
    const choice=model.env.probeSelections?.[id];
    const canInstallLocal=['jlink','stm32cubeprogrammer'].includes(id);
    const available=id==='pyocd'||model.env.deployedProbes?.includes(id);
    const stDriver=id==='stm32cubeprogrammer'&&model.env.platform==='Windows';
    return {id,label,program,source:choice?'selected':'auto',devices:demoProbeDevices(id),
      path:choice || (available?'example/tools/'+program:undefined),
      canDeploy:['pyocd','dfu-util'].includes(id)||(id==='jlink'&&['Windows','macOS'].includes(model.env.platform)),
      deployLabel:tr('下载并部署','Download and install'),canInstallLocal,
      canDeployDriver:stDriver||(['pyocd','stm32cubeprogrammer'].includes(id)&&model.env.platform==='Ubuntu'),
      driverLabel:stDriver?'下载 ST-LINK 驱动':'安装 USB 访问规则',canInstallLocalDriver:stDriver};
  });
  return probeListView.render({rows,editable:true,trusted:true});
}
function pickDemoProbeLocation(op,id) {
  const input=document.createElement('input');
  input.type='file';
  if(op==='directory'||op==='localDriver')input.webkitdirectory=true;
  input.onchange=()=>{
    const file=input.files[0]; if(!file)return;
    if(op==='localInstaller') return deployDemoProbe(id);
    if(op==='localDriver')return notify('本地驱动包部署完成（示例）');
    const program=probeExamples[id][1];
    if(op==='directory') {
      const match=[...input.files].find(item=>item.name.toLowerCase().replace(/\.exe$/,'')===program.toLowerCase());
      if(!match)return notify('所选目录中未找到 '+program);
      (model.env.probeSelections??={})[id]=match.webkitRelativePath;
    } else (model.env.probeSelections??={})[id]=file.name;
    commitDemo();
  };
  input.click();
}
function deployDemoProbe(id) {
  model.env.deployedProbes=[...new Set([...(model.env.deployedProbes||[]),id])];
  commitDemo();
  notify('示例部署完成');
}
function demoProbeAction(op,id) {
  if(op==='refresh') {render();return notify('已重新识别示例探针与工具');}
  if(!Object.hasOwn(probeExamples,id))return;
  if(op==='download'||op==='guide')return window.open(op==='guide'?demoProbeGuides[id]:probeExamples[id][3],'_blank','noopener,noreferrer');
  if(op==='deploy')return deployDemoProbe(id);
  if(op==='driver')return id==='stm32cubeprogrammer'&&model.env.platform==='Windows'
    ?window.open(demoProbeGuides[id],'_blank','noopener,noreferrer'):notify('设备权限规则已部署（示例）');
  if(op==='typedDirectory') {
    const directory=window.prompt('工具目录（绝对路径或工作区相对路径）')?.trim();
    if(directory) {
      (model.env.probeSelections??={})[id]=directory.replace(/[\\/]+$/,'')+'/'+probeExamples[id][1];
      commitDemo();
    }
    return;
  }
  if(op==='reset'){delete model.env.probeSelections?.[id];return commitDemo();}
  if(['directory','executable','localInstaller','localDriver'].includes(op))return pickDemoProbeLocation(op,id);
}
const demoProbeGuides={
  pyocd:'https://pyocd.io/docs/debug_probes.html',jlink:'https://kb.segger.com/J-Link_Troubleshooting',
  stm32cubeprogrammer:'https://www.st.com/en/development-tools/stsw-link009.html',
  'dfu-util':'https://dfu-util.sourceforge.net/dfu-util.1.html',
  serial:'https://docs.zephyrproject.org/latest/hardware/peripherals/uart.html'
};
