'use strict';

/** A discovered compiler is a choice for the next configure. Only CMake records what a build actually used. */
function compiler_recorded_choice(model) {
  if (!model.overridden) return 'auto';
  return model.options.find(option => option.selected)?.id ?? '';
}

function compiler_reason(model) {
  const messages = {
    explicit: tr('自动模式使用工程参数。可选择其他编译器，仅覆盖当前目标的构建命令。', 'Automatic uses the project definitions. Choose another compiler to override them for this target.'),
    selectBoard: tr('选定开发板后可匹配本机编译器。', 'Choose a board to match local compilers.'),
    architecture: tr('当前板的架构尚未确认。配置工程后可读取实际编译器。', 'The board architecture is unconfirmed. Configure the target to see its actual compiler.'),
    sdk: tr('未发现适用于该目标的 SDK 编译器。请核对所选 SDK 和已安装的架构组件。', 'No matching SDK compiler was found. Check the SDK and its installed architecture components.'),
    unavailable: tr('本次未发现匹配的本机编译器。', 'No matching local compiler was found.'),
    unsupported: tr('请核对当前 Zephyr 版本支持的 SDK 版本与工具链。', 'Check which SDK versions and toolchains your Zephyr version supports.'),
    trust: tr('信任工作区后可检测本机编译器。', 'Trust the workspace to detect local compilers.')
  };
  return messages[model.reason] || '';
}

function toolchain_reading(label, value) {
  if (value === undefined || value === null) return '';
  const display = value === '' ? tr('（空字符串）','(empty string)') : value;
  return '<div class="toolchain-reading"><span>'+esc(label)+'</span><code>'+esc(display)+'</code></div>';
}

function compiler_reading(file, status, source) {
  if (!file) return '';
  const fullPath = ZephyrPathDisplay.path(file);
  const name = fullPath.slice(fullPath.lastIndexOf('/')+1);
  return '<div class="compiler-reading"><div><strong>'+esc(name)+'</strong><small>'+esc(status)+
    (source?' · '+esc(source):'')+'</small></div>'+(name===fullPath?'':'<code>'+esc(fullPath)+'</code>')+'</div>';
}

function candidate_source(candidate) {
  const origin = {sdk:'Zephyr SDK',path:tr('本机扫描','Local scan'),workspace:tr('工作区目录','Workspace directory'),prefix:'CROSS_COMPILE'};
  const evidence = {sdk:tr('SDK 架构组件','SDK architecture component'),
    architecture:tr('架构匹配，待配置验证','Architecture matches, pending configuration'),
    unverified:tr('兼容性待配置验证','Compatibility unverified')};
  return [origin[candidate.source] || candidate.source, evidence[candidate.compatibility]].filter(Boolean).join(' · ');
}

function environment_value_origin(origin) {
  const names = {
    workspace:tr('工作区设置','Workspace settings'), override:tr('工作区覆盖','Workspace override'),
    cache:'CMakeCache.txt', detected:tr('本机识别','Local discovery'), host:tr('继承自 VS Code 进程','Inherited from VS Code')
  };
  return names[origin] ?? origin;
}

function environment_readings(field) {
  if (!field) return '';
  const display = value => ZephyrPathDisplay.variable(field.name, value);
  const current = toolchain_reading(environment_value_origin(field.source || 'host'), display(field.value));
  const cached = field.cached !== undefined && (!field.matches || field.value === undefined) ?
    toolchain_reading(tr('上次配置','Last configured')+' · '+(field.cacheKey || field.name), display(field.cached)) : '';
  return current+cached;
}

function project_compiler_readings(model) {
  const definitions = model.requestedDefinitions || (model.requested ? [model.requested] : []);
  if (!definitions.length) return '';
  const label = model.overridden ? tr('工程原参数 · 恢复自动时使用','Original project definitions · used in Automatic') :
    tr('工程配置输入','Project configuration input');
  return toolchain_reading(label, definitions.join('\n'));
}

class compiler_selection {
  constructor(apply, manual) {
    this.apply = apply;
    this.manual = manual;
    this.drafts = new Map();
    document.addEventListener('change', event => {
      if (event.target.matches('[data-compiler-options]')) this.change(event.target.closest('[data-compiler-form]'));
    });
    document.addEventListener('click', event => {
      const external = event.target.closest('[data-target-compiler]');
      if (external && !external.disabled) return this.manual(this.model.scope, external.dataset.targetCompiler);
      const button = event.target.closest('[data-apply-compiler]');
      if (button && !button.disabled) this.apply(this.model.scope, button.closest('[data-compiler-form]').querySelector('select').value);
    });
  }

  render(state) {
    const model = state.compilerChoices || (state.folder && state.trusted === false ? {reason:'trust',options:[]} : undefined);
    if (!model) return '';
    this.model = model;
    const current = compiler_recorded_choice(model);
    const saved = this.drafts.get(model.scope);
    const available = id => id === 'auto' || model.options.some(option => option.id === id);
    const choice = saved !== undefined && available(saved) ? saved : current;
    if (choice === current || !available(saved)) this.drafts.delete(model.scope);
    const disabled = !state.trusted || !state.folder || state.busy || !model.scope || model.reason==='selectBoard';
    const option = (id, label) => '<option value="'+esc(id)+'"'+(id===choice?' selected':'')+'>'+esc(label)+'</option>';
    const choices = option('auto',tr('自动 · 采用工程或 Zephyr 的选择','Automatic · use project or Zephyr selection'))+
      (current === '' ? '<option value="" disabled'+(choice===''?' selected':'')+'>'+tr('已保存的选择当前不可用','Saved selection currently unavailable')+'</option>' : '')+
      model.options.map(item => {
        const duplicate = model.options.some(other=>other.id!==item.id && other.label===item.label);
        const display = ZephyrPathDisplay.path(item.label)+(duplicate?' · '+ZephyrPathDisplay.path(item.path):'');
        const recommended = model.reason !== 'explicit' && item.id === model.recommendedId;
        return option(item.id, display+(recommended?tr(' · 推荐',' · recommended'):''));
      }).join('');
    const select = '<select data-compiler-options aria-label="'+tr('当前目标的编译器','Compiler for this target')+'"'+(disabled?' disabled':'')+'>'+choices+'</select>';
    const button = '<button type="button" data-apply-compiler'+(disabled || choice===current?' disabled':'')+'>'+tr('应用','Apply')+'</button>';
    const source = model.architecture_source === '.config' ? '.config' : model.architecture_source ? tr('开发板元数据','Board metadata') : '';
    const architecture = [state.page==='workspace'?state.board:'',model.architecture, source].filter(Boolean).join(' · ');
    const reason = compiler_reason(model);
    return '<div class="target-compiler" data-compiler-form><div class="compiler-caption"><strong>'+tr('目标编译器','Target compiler')+
      '</strong>'+(architecture?'<small>'+esc(architecture)+'</small>':'')+'</div><div data-compiler-path aria-live="polite">'+this.path(choice)+
      '</div><div class="compiler-controls">'+select+button+'</div>'+
      project_compiler_readings(model)+(reason ? '<small>'+esc(reason)+'</small>' : '')+this.external_tools(disabled)+'</div>';
  }

  external_tools(disabled) {
    const option = (route, label) => '<button type="button" data-target-compiler="'+route+'"'+(disabled?' disabled':'')+'>'+label+'</button>';
    return '<details class="toolchain-details" data-build-section="compiler-manual" data-toolchain-details="compiler-manual"><summary>'+
      tr('指定其他外部 GNU 编译器','Choose another external GNU compiler')+'</summary><div><p>'+
      tr('选定的工具链用于此应用和开发板。','The selection applies to this application and board.')+'</p><div class="actions">'+
      option('compilerBrowse',tr('从文件选择 GCC…','Browse for GCC…'))+
      option('compilerPrefix',tr('输入工具名前缀…','Enter executable prefix…'))+'</div></div></details>';
  }

  path(id) {
    const auto = id === 'auto';
    const model = this.model;
    const candidate = !(auto && model.requested) && model.options.find(option => option.id === (auto ? model.recommendedId : id));
    const cacheSource = 'CMakeCache.txt · CMAKE_C_COMPILER';
    const confirmed = tr('CMake 已选用','Configured by CMake');
    const configured = compiler_reading(model.configured, confirmed, cacheSource) ||
      compiler_reading(model.incompleteCompiler, tr('缓存记录，尚未完成配置','Cache entry from incomplete configuration'), cacheSource);
    if (!candidate) return configured || (model.reason ? '' : '<small>'+tr('完成配置后将显示 CMake 选用的编译器。','Configure to see the compiler selected by CMake.')+'</small>');
    const status = auto ? tr('自动推荐','Local recommendation') : candidate.selected ? tr('当前目标已选','Selected for this target') : tr('待应用','Pending selection');
    const source = candidate_source(candidate);
    const matches = candidate.compatibility==='configured' && model.configured;
    const reading = matches ? compiler_reading(model.configured,confirmed,[cacheSource,status,source].filter(Boolean).join(' · ')) :
      configured+compiler_reading(candidate.path,status,source);
    const hint = auto && this.model.mode==='cross' && candidate.compatibility==='architecture' ?
      tr('若尚未指定外部前缀，请选中该候选并应用。','If no external prefix is set, select and apply this candidate.') : '';
    const detail = auto ? hint : candidate.setting;
    return reading+(detail ? '<small>'+esc(detail)+'</small>' : '');
  }

  change(form) {
    const choice = form.querySelector('select').value;
    const applied = choice === compiler_recorded_choice(this.model);
    if (applied) this.drafts.delete(this.model.scope);
    else this.drafts.set(this.model.scope, choice);
    form.querySelector('[data-apply-compiler]').disabled = applied;
    form.querySelector('[data-compiler-path]').innerHTML = this.path(choice);
  }
}

function external_prefix_details(state) {
  const field = state.environmentRows?.find(row => row.name === 'CROSS_COMPILE');
  const variant = state.environmentRows?.find(row => row.name === 'ZEPHYR_TOOLCHAIN_VARIANT');
  const cross = variant?.value === 'cross-compile';
  const override = state.overrides?.includes('CROSS_COMPILE');
  if (!cross && !override && field?.value === undefined && field?.cached === undefined) return '';
  const disabled = !state.trusted || !state.folder || state.busy;
  const manual = cross ? '<div class="actions">'+b(tr('选择 GCC 可执行文件…','Browse for GCC…'),'setup:edit:CROSS_COMPILE','','',disabled)+
    b(tr('输入工具名前缀…','Enter executable prefix…'),'setup:path:CROSS_COMPILE','','',disabled)+'</div>' : '';
  const inherit = override ? b(tr('恢复继承','Restore inherited prefix'),'setup:inherit:CROSS_COMPILE','plain','',disabled) : '';
  const hint = cross ? tr('可选择外部 GNU 编译器或输入工具名前缀，例如 arm-none-eabi-。此项设置为工作区工具链提供默认值。',
    'Choose an external GNU compiler or enter its executable prefix, such as arm-none-eabi-. This sets the workspace toolchain default.') :
    tr('此值供 cross-compile 工具链使用。','This value belongs to the cross-compile toolchain.');
  return '<details class="toolchain-details" data-toolchain-details="prefix"><summary>'+
    (cross ? tr('工作区工具名前缀','Workspace executable prefix') : tr('已记录的外部工具链前缀','Recorded external toolchain prefix'))+
    '</summary><div><p>'+esc(hint)+'</p><small>CROSS_COMPILE</small>'+environment_readings(field)+manual+inherit+'</div></details>';
}

function board_root_readings(roots, variable, environment) {
  const values = new Map();
  const display = value => ZephyrPathDisplay.variable('BOARD_ROOT', value);
  const added = roots.map(path => ZephyrPathDisplay.path(path)).join(';');
  function record(label, value) {
    if (value === undefined) return;
    const key = display(value);
    values.set(key, [...(values.get(key) || []), label]);
  }
  if (roots.length) record(tr('工作区已添加','Added to workspace'), roots.join(';'));
  if (variable?.planned?.source === '-D') record('-DBOARD_ROOT', variable.planned.value);
  if (environment?.value !== undefined) record(environment_value_origin(environment.source || 'host'), environment.value);
  record(tr('上次配置','Last configured'), environment?.cached ?? variable?.configured?.value);
  return [...values].map(([value, labels]) => {
    const source = labels.join(' · ');
    if (roots.length && value === added) return '<small>'+esc(source)+'</small>';
    return toolchain_reading(source, value);
  }).join('');
}

function board_root_details(state) {
  const roots = state.extraRoots || [];
  const variable = state.buildVariables?.rows.find(row => row.name === 'BOARD_ROOT');
  const environment = state.environmentRows?.find(row => row.name === 'BOARD_ROOT');
  const disabled = !state.trusted || !state.folder || state.busy;
  const hint = tr('内置开发板会自动发现。使用自定义板时，可添加包含 boards/ 的目录。','Built-in boards are discovered automatically. For a custom board, add the directory containing boards/.');
  const list = roots.map(path => '<li><code>'+esc(ZephyrPathDisplay.path(path))+'</code> <button type="button" data-remove-board-root="'+esc(path)+'"'+
    (disabled?' disabled':'')+' aria-label="'+esc(tr('移除 ','Remove ')+ZephyrPathDisplay.path(path))+'">'+tr('移除','Remove')+'</button></li>').join('');
  const sources = board_root_readings(roots, variable, environment);
  const buttons = b(tr('添加目录…','Add directory…'),'setup:edit:BOARD_ROOT','','',disabled)+b(tr('输入路径…','Enter path…'),'setup:path:BOARD_ROOT','','',disabled)+
    (roots.length || state.overrides?.includes('BOARD_ROOT') ? b(tr('恢复继承','Restore inherited roots'),'setup:inherit:BOARD_ROOT','plain','',disabled) : '');
  return '<details class="toolchain-details" data-build-section="board-roots"><summary>'+tr('自定义开发板目录','Custom board directories')+
    (roots.length ? ' ('+roots.length+')' : '')+'</summary><div><p>'+esc(hint)+'</p><small>BOARD_ROOT</small>'+
    (list?'<ul>'+list+'</ul>':'')+sources+'<div class="actions">'+buttons+'</div></div></details>';
}

if (typeof module !== 'undefined') module.exports = {compiler_selection, external_prefix_details, board_root_details};

