'use strict';

const probeListView = (() => {
  const deviceStates = {
    present: ['系统已识别', 'Detected by OS'],
    accessible: ['可读写', 'Accessible'],
    driver: ['缺少驱动', 'Driver missing'],
    permission: ['需要访问权限', 'Permission required'],
    unknown: ['状态未知', 'Status unknown']
  };
  function action(id, op, label, disabled, kind = '') {
    return b(label, 'probe:' + op + ':' + id, kind, '', disabled);
  }
  function driverControls(row, locked) {
    let buttons = '';
    if (row.canDeployDriver) {
      const readOnlyDownload = row.canInstallLocalDriver && locked;
      buttons += action(row.id, readOnlyDownload ? 'guide' : 'driver', row.driverLabel, locked && !readOnlyDownload, 'plain');
    }
    if (row.canInstallLocalDriver) {
      buttons += action(row.id, 'localDriver', tr('安装本地驱动…','Install local driver…'), locked, 'plain');
    }
    return buttons;
  }
  function controls(row, editable) {
    const locked = !editable || row.busy;
    let primary = '';
    if (row.program) primary += action(row.id, 'directory', tr('选择目录…', 'Choose folder…'), locked);
    if (row.canDeploy) primary += action(row.id, 'deploy', row.deployLabel, locked, 'primary');
    else if (row.program) primary += action(row.id, 'download', tr('官方下载', 'Official download'));
    let secondary = '';
    if (row.program) secondary += action(row.id, 'typedDirectory', tr('输入目录…', 'Enter folder…'), locked, 'plain');
    if (row.program) secondary += action(row.id, 'executable', tr('选择可执行文件…', 'Choose executable…'), locked, 'plain');
    if (row.source === 'selected') secondary += action(row.id, 'reset', tr('恢复自动识别', 'Use auto-detection'), locked, 'plain');
    if (row.canInstallLocal) {
      const installer = action(row.id, 'localInstaller', tr('运行本地安装包…', 'Run local installer…'), locked);
      if (row.canDeploy) secondary += installer;
      else primary += installer;
    }
    const driver = driverControls(row, locked);
    const needsDriver = row.devices?.some(device=>['driver','permission'].includes(device.status));
    if (row.canDeploy) secondary += action(row.id, 'download', tr('官方下载', 'Official download'), false, 'plain');
    if (!row.canInstallLocalDriver) {
      const guide = action(row.id, 'guide', tr('驱动与权限说明', 'Driver and access guide'), false, 'plain');
      if (!row.program || needsDriver) primary += guide;
      else secondary += guide;
    }
    return {primary, driver, secondary};
  }
  function programStatus(row) {
    if (!row.program) return tr('系统串口', 'System serial port');
    if (row.path) return row.source === 'selected' ? tr('已指定', 'Selected') : tr('已识别', 'Detected');
    if (row.selectedPath) return tr('指定路径无效', 'Selected path unavailable');
    return tr('未找到工具', 'Tool not found');
  }
  function devices(row, scanning, trusted) {
    if (!trusted) return '';
    if (row.deviceError) return '<p class="probe-warning">'+esc(row.deviceError)+'</p>';
    if (!Array.isArray(row.devices)) return scanning ? '' :
      '<small>'+tr('当前主机未提供设备信息','Device information unavailable on this host')+'</small>';
    if (!row.devices.length) return '<small>'+tr('未发现匹配设备','No matching device')+'</small>';
    return '<ul class="probe-devices">'+row.devices.map(device=>{
      const status = deviceStates[device.status] || deviceStates.unknown;
      const alert = ['driver','permission'].includes(device.status) ? ' class="probe-warning"' : '';
      const detail = [device.id,device.detail].filter(Boolean).join(' · ');
      return '<li><strong>'+esc(device.name)+'</strong> <span'+alert+'>'+tr(...status)+'</span>'+
        (detail?' <small>'+esc(detail)+'</small>':'')+'</li>';
    }).join('')+'</ul>';
  }
  function item(row, view) {
    const {primary,driver,secondary} = controls(row, view.editable);
    const unresolved = row.program && !row.path;
    const pending = unresolved && !row.selectedPath && (!view.trusted || (view.scanning && !row.toolChecked));
    const status = pending ? tr('尚未识别','Not checked') : programStatus(row);
    const path = ZephyrPathDisplay.path(row.path || row.selectedPath || '');
    const caption = path || row.program;
    return '<li class="probe-row" tabindex="-1" data-probe-id="'+esc(row.id)+'">'+
      '<div class="probe-heading"><strong>'+esc(row.label)+'</strong>'+badge(status,
        pending || !row.program ? 'neutral' : unresolved ? 'warn' : '')+
      '<div class="probe-actions">'+primary+'</div></div>'+
      '<div class="probe-meta">'+(caption?'<code class="probe-path">'+esc(caption)+'</code>':'')+
      devices(row, view.scanning, view.trusted)+
      driver+
      (secondary?'<details data-probe-details="'+esc(row.id)+'"><summary>'+
        tr('更多选项与说明','More options and guidance')+'</summary>'+
        (row.accessHint?'<p>'+esc(row.accessHint)+'</p>':'')+
        '<div class="probe-options">'+secondary+'</div></details>':row.accessHint?'<small>'+esc(row.accessHint)+'</small>':'')+
      '</div>'+(row.statusMessage?'<p role="status">'+esc(row.statusMessage)+'</p>':'')+'</li>';
  }
  function render(view) {
    const refresh = b(tr('重新识别','Detect again'),'probe:refresh','','refresh',view.scanning || !view.trusted);
    const note = !view.trusted ? tr('信任工作区后可检测设备并部署工具。','Trust this workspace to detect devices and deploy tools.') :
      view.scanning ? tr('正在识别本机工具与设备…','Detecting local tools and devices…') : '';
    return '<section class="panel probe-panel" id="probe-panel" aria-labelledby="probe-title">'+
      '<div class="ph"><h2 id="probe-title">'+tr('探针与驱动','Probes and drivers')+'</h2>'+refresh+'</div>'+
      (note?'<p class="probe-note" role="status">'+esc(note)+'</p>':'')+
      (view.error?'<p class="probe-note probe-warning" role="alert">'+esc(view.error)+'</p>':'')+
      '<ul class="probe-list">'+view.rows.map(row=>item(row,view)).join('')+'</ul></section>';
  }
  return {render};
})();
