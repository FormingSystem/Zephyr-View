'use strict';

// These records describe sample builds. The design preview has no process or USB bridge.
const probeExamples={
  pyocd:['CMSIS-DAP · pyOCD','pyocd','DAPLink','https://pyocd.io/docs/installing.html'],
  jlink:['J-Link · SEGGER','J-Link Commander','J-Link','https://www.segger.com/downloads/jlink/'],
  stm32cubeprogrammer:['ST-LINK · STM32CubeProgrammer','STM32_Programmer_CLI','ST-LINK','https://www.st.com/en/development-tools/stm32cubeprog.html'],
  'dfu-util':['USB DFU · dfu-util','dfu-util','USB DFU','https://dfu-util.sourceforge.net/'],
  serial:['USB 串口 · UART / CDC ACM','','CDC ACM','https://docs.zephyrproject.org/latest/develop/flash_debug/host-tools.html']
};
let reviewedProbe='pyocd', pendingDemoFlash;
const probeScenarios=new Map();

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
  if (selection.op==='support') return demoProbeAction('open',request.names[0]);
  if (selection.op==='scan') {
    const probes=probeScenarios.get('pyocd')==='disconnected'?[]:
      [{id:'DEMO-001',label:'DAPLink · 演示板 A'},{id:'DEMO-002',label:'DAPLink · 演示板 B'}];
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

function demoProbeAction(op,runner) {
  if (op==='open') reviewedProbe=Object.hasOwn(probeExamples,runner)?runner:'pyocd';
  if (op==='select') reviewedProbe=$('#demo-probe-profile').value;
  if (op==='check') probeScenarios.set(reviewedProbe,$('#demo-probe-connection').value);
  const [,tool,usb,url]=probeExamples[reviewedProbe],scenario=probeScenarios.get(reviewedProbe);
  const options=Object.entries(probeExamples).map(([id,[name]])=>'<option value="'+esc(id)+'"'+
    (id===reviewedProbe?' selected':'')+'>'+esc(name)+'</option>').join('');
  const choice=(id,name)=>'<option value="'+id+'"'+(scenario===id?' selected':'')+'>'+name+'</option>';
  const select='<label>探针类型<select id="demo-probe-profile">'+options+'</select></label>'+
    '<label>示例场景<select id="demo-probe-connection">'+choice('connected','已连接')+
    choice('disconnected','未连接')+choice('missing','缺少主机工具或系统支持')+'</select></label>';
  let report='';
  if(scenario) {
    const found=scenario!=='disconnected',ready=scenario==='connected';
    const rows=[['主机工具',tool ? tool+(scenario==='missing'?' · 未发现':' · 已发现'):'系统串口'],
      ['USB 设备',found?usb:'未检测到'],[model.env.platform==='Windows'?'驱动状态':'设备访问',
        ready?'已就绪':found?'需要检查':'等待连接']];
    report='<dl class="demo-probe-report">'+rows.map(([key,value])=>'<dt>'+esc(key)+'</dt><dd>'+esc(value)+'</dd>').join('')+'</dl>';
  }
  return show('探针与驱动 · 示例',select+wrap(b('检查示例状态','demoProbe:check','primary'))+report+
    '<a href="'+url+'" target="_blank" rel="noopener noreferrer">官方工具与说明 ↗</a>');
}

document.addEventListener('change',event=>{
  if(event.target.id==='demo-probe-profile')demoProbeAction('select');
});
