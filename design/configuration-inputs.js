'use strict';

function configuration_input_title(kind) {
  return {dts: tr('板级设备树', 'Board devicetree'), kconfig: tr('应用配置', 'Application configuration'),
    overlay: tr('设备树覆盖', 'Devicetree overlays')}[kind];
}

function configuration_input_status(group) {
  switch (group.status) {
    case 'missing': return tr('文件缺失', 'Missing file');
    case 'choose': return tr('多个候选，可手动选择', 'Multiple candidates · override available');
    case 'suggested': return tr('候选文件，尚未选用', 'Suggested file · not selected');
    case 'optional': return tr('可选', 'Optional');
    case 'configure': return tr('配置后确认', 'Configure to resolve');
    default: return {manual: tr('手动选择', 'Selected'), argument: tr('CMake 参数', 'CMake definition'),
      configured: tr('构建已确认', 'Confirmed by build'), environment: tr('环境变量', 'Environment'),
      automatic: tr('自动识别', 'Detected')}[group.source] || '';
  }
}

function configuration_input_row(kind, group, app, disabled) {
  const title = configuration_input_title(kind);
  const input_path = file => {
    const missing = group.missing.includes(file);
    const name = ZephyrPathDisplay.relative(file, app);
    return missing ? '<code class="missing-input" title="'+esc(ZephyrPathDisplay.path(file))+'">'+esc(name)+'</code>' :
      '<button type="button" class="plain input-path" data-input-path="'+esc(file)+'" title="'+esc(ZephyrPathDisplay.path(file))+'">'+esc(name)+'</button>';
  };
  const files = [...new Set([...group.files, ...group.missing])].map(input_path);
  const status = '<small>'+esc(configuration_input_status(group))+'</small>';
  const value = files.length > 1 ? '<details data-build-section="input-'+kind+'"><summary>'+
    esc(tr('共 '+files.length+' 个文件', files.length+' files'))+'</summary><ol>'+files.map(file=>'<li>'+file+'</li>').join('')+'</ol></details>' :
    files[0] || (group.suggestedFile ? '<code>'+esc(ZephyrPathDisplay.relative(group.suggestedFile,app))+'</code>' : '');
  const recorded = group.confirmedFiles;
  const previous = recorded ? '<details data-build-section="recorded-'+kind+'"><summary>'+tr('上次构建采用','Last configured inputs')+
    '</summary>'+(recorded.length ? '<ol>'+recorded.map(file=>'<li>'+input_path(file)+'</li>').join('')+'</ol>' :
      '<small>'+tr('未使用文件','No files used')+'</small>')+'</details>' : '';
  function control(action, label, unavailable = false) {
    return '<button type="button" data-input-kind="'+kind+'" data-input-action="'+action+'" title="'+
      esc(title+' · '+label)+'" aria-label="'+esc(title+' · '+label)+'"'+(disabled || unavailable ? ' disabled' : '')+'>'+esc(label)+'</button>';
  }
  const count = new Set([...group.candidates,...group.files].filter(file=>!group.missing.includes(file))).size;
  const buttons = control('list', tr('从列表选…','Choose from list…'), !count)+control('browse', tr('浏览…','Browse…'))+
    (kind !== 'dts' && files.length > 1 && !group.missing.length ? control('order', tr('调整顺序…','Merge order…')) : '')+
    (group.source === 'manual' ? control('reset', tr('恢复工程设置','Use project settings')) : '');
  return '<div class="target-field config-input" data-file-group="'+kind+'"><span class="target-label" title="'+esc(group.variable)+'">'+
    esc(title)+'</span><div class="config-input-value">'+value+status+previous+'</div><div class="config-input-actions">'+buttons+'</div></div>';
}

function configuration_input_rows(state, kinds) {
  const detected = state.configurationFiles;
  if (!detected) return '';
  const disabled = state.busy || !state.trusted || !state.folder || (!state.board && !state.projectBoard);
  return kinds.filter(kind => detected[kind]).map(kind =>
    configuration_input_row(kind, detected[kind], state.app, disabled)).join('');
}
