'use strict';

const buildPathDisplay = globalThis.ZephyrPathDisplay ?? require('./pathDisplay');

const build_path_label = (value,root) => buildPathDisplay.directory(buildPathDisplay.relative(value,root));

function build_method_field(state) {
  const options = ['west', 'CMake'].map(method => {
    return '<label><input type="radio" name="build-method" value="'+method+'"'+
      (state.method === method ? ' checked' : '')+'><span>'+method+'</span></label>';
  }).join('');
  return '<fieldset class="build-method-choice"'+(state.busy || !state.folder || state.trusted === false ? ' disabled' : '')+'><legend>'+
    tr('构建方式', 'Build method')+'</legend><div class="build-options">'+options+
    '</div><small>'+esc(buildMethodHint(state.method))+'</small></fieldset>';
}

function sysbuild_field(state) {
  const locked=state.configured || state.busy || !state.folder || !state.trusted;
  const names=state.images?.map(name=>name===state.defaultImage ? name+' ('+tr('主镜像','main')+')' : name);
  const hint=names?.join(' · ') || (state.configured ? tr('切换构建类型时请选择新的构建目录','Choose a fresh build directory to change the build type') :
    tr('用于构建一个或多个固件镜像','Build one or more firmware images'));
  return '<div class="build-parallel-field"><label><input type="checkbox" name="sysbuild"'+
    (state.system?' checked':'')+(locked?' disabled':'')+'> Sysbuild</label><small>'+esc(hint)+'</small></div>';
}

function parallel_field(state) {
  const limit = state.parallelism;
  if (!limit) return '';
  const suggestions = new Set([1, limit.hostCount, limit.custom].filter(Boolean));
  for (let jobs = 2; jobs < limit.hostCount; jobs *= 2) suggestions.add(jobs);
  const choices = [...suggestions].sort((a,b) => a-b).map(jobs =>
    '<option value="'+jobs+'"'+(jobs === limit.custom ? ' selected' : '')+'>'+jobs+'</option>');
  const inherited = limit.source === 'environment';
  const fallback = limit.invalidEnvironment ? tr('环境值无效','Invalid environment value') : tr('构建工具默认值','Build tool default');
  const automatic = tr('自动','Automatic')+' · '+(limit.automatic ?? fallback);
  const source = (inherited && !limit.custom ? ' · CMAKE_BUILD_PARALLEL_LEVEL' : '');
  const hint = tr('宿主机可用逻辑核心：','Available host logical CPUs: ')+limit.hostCount+source;
  const disabled = state.busy || !state.trusted || !state.folder ? ' disabled' : '';
  return '<form class="build-parallel-field"><label for="build-parallel-jobs">'+tr('并行编译任务数','Parallel build jobs')+
    '</label><select id="build-parallel-jobs" aria-describedby="build-host-cpus"'+disabled+'><option value="">'+esc(automatic)+
    '</option>'+choices.join('')+'<option value="custom">'+tr('自定义…','Custom…')+'</option></select>'+
    '<span class="custom-jobs" hidden><input aria-label="'+tr('自定义并行任务数','Custom job count')+
    '" type="number" min="1" max="2147483647" step="1" required disabled><button type="submit">'+tr('应用','Apply')+
    '</button></span><small id="build-host-cpus">'+esc(hint)+'</small></form>';
}

/** Preset changes apply immediately. A custom count is committed on Enter or Apply. */
function bind_parallel_field(root, state, save) {
  const form = root.querySelector('form.build-parallel-field');
  if (!form) return;
  const select = form.querySelector('select');
  const custom = form.querySelector('.custom-jobs');
  const input = custom.querySelector('input');
  const build = root.querySelector('[data-act="build-run:build"],[data-act="build"]');
  const initially_disabled = build?.disabled;
  const commit = value => {
    if (build) build.disabled = true;
    select.disabled = true;
    input.disabled = true;
    save(value);
  };
  select.onchange = () => {
    const editing = select.value === 'custom';
    custom.hidden = !editing;
    input.disabled = !editing;
    if (build) build.disabled = editing || initially_disabled;
    if (!editing) return commit(select.value);
    input.value = String(state.parallelism.jobs ?? state.parallelism.hostCount);
    input.focus();
    input.select();
  };
  form.onsubmit = event => {
    event.preventDefault();
    if (!input.disabled && input.reportValidity()) commit(String(input.valueAsNumber));
  };
}

/** Use the field's label for context and keep each action intelligible to assistive technology. */
function build_target_row(kind, label, value, display, routes, disabled = false) {
  const button = (route, text, full_name) => '<button type="button" data-act="'+esc(route)+'" title="'+
    esc(full_name)+'" aria-label="'+esc(full_name)+'"'+(disabled ? ' disabled' : '')+'>'+esc(text)+'</button>';
  if (kind === 'board') {
    return targetFieldRow(label, value, display, button(routes.search, tr('选择目标', 'Select target'), tr('选择开发板与 CPU 目标', 'Select target board and CPU')));
  }
  const app = kind === 'app';
  const browse = button(routes.browse, tr('浏览…', 'Browse…'), app ? tr('浏览应用目录', 'Browse application directories') : tr('浏览构建目录', 'Browse build directories'));
  const search = button(routes.search, tr('搜索…', 'Search…'), app ? tr('搜索应用目录', 'Search application directories') : tr('搜索构建目录', 'Search build directories'));
  const path = button(routes.path, tr('输入路径…', 'Enter path…'), app ? tr('输入应用目录路径', 'Enter path to application directory') : tr('输入构建目录路径', 'Enter path to build directory'));
  return targetFieldRow(label, value, buildPathDisplay.directory(display), browse+search+path);
}

function build_disclosure(id, title, content, note = '') {
  return '<details class="build-section" data-build-section="'+id+'"><summary><strong>'+esc(title)+
    '</strong>'+(note ? '<small>'+esc(note)+'</small>' : '')+'</summary><div class="build-section-body">'+content+'</div></details>';
}

function build_variable_value(name, entry) {
  if (entry.hidden) return tr('值已隐藏', 'Value hidden');
  return entry.value === '' ? tr('空字符串', 'Empty string') : buildPathDisplay.variable(name, entry.value, entry.type);
}

function build_variable_lines(row) {
  function line(source, entry) {
    const label = [source, entry.type].filter(Boolean).join(' · ');
    return '<div><small>'+esc(label)+'</small><code>'+esc(build_variable_value(row.name, entry))+'</code></div>';
  }
  const values = [];
  if (row.planned) {
    const source = row.planned.source === 'env' ? tr('进程环境', 'Process environment') :
      row.planned.source === 'west config' ? 'west config · build.generator' : tr('配置输入', 'Input')+' · '+row.planned.source;
    values.push(line(source, row.planned));
  }
  if (row.configured) {
    const key = row.configured.source === row.name ? '' : ' · '+row.configured.source;
    values.push(line(tr('上次配置', 'Last configuration')+key, row.configured));
  }
  const defaults = {BOARD:tr('待选择', 'Select a target'),
    DTC_OVERLAY_FILE:tr('可选 · Zephyr 自动查找应用覆盖文件', 'Optional · Zephyr discovers application overlays automatically')};
  const fallback = '<small>'+esc(defaults[row.name] || tr('配置时确定', 'Resolved during configuration'))+'</small>';
  return '<div class="build-variable" data-variable="'+esc(row.name)+'"><strong>'+esc(row.name)+'</strong>'+
    (values.join('') || fallback)+'</div>';
}

function build_variables(variables) {
  if (!variables) return '';
  const origin = {
    current:tr('上次配置值来自此目标的 CMakeCache.txt。', 'Last configured values come from this target’s CMakeCache.txt.'),
    conflict:tr('现有缓存属于其他目标；此处显示本次输入。', 'The cache belongs to another target. Showing the current inputs.'),
    unknown:tr('缓存未记录完整目标；此处显示本次输入。', 'The cache does not identify the full target. Showing the current inputs.'),
    absent:tr('配置后可核对 CMakeCache.txt 中的值。', 'Configure the target to inspect its CMakeCache.txt values.')
  };
  const summary = variables.rows.filter(row => ['BOARD','CMAKE_GENERATOR'].includes(row.name) && (row.planned || row.configured))
    .map(row => row.name+'='+build_variable_value(row.name, row.planned || row.configured)).join(' · ');
  const body = '<p class="subtle">'+esc(origin[variables.status] || '')+'</p>'+variables.rows.map(build_variable_lines).join('');
  return build_disclosure('variables', tr('构建变量', 'Build variables'), body, summary);
}

function build_invocation(state) {
  if (!state.plan) return;
  return {cwd:state.root || state.folder, executable:state.plan.executable,
    configure:state.plan.configure, build:state.plan.build};
}

function build_command_preview(state) {
  const plan = build_invocation(state);
  let content = '<p>'+tr('选择应用和开发板后可预览命令。', 'Choose an application and board to preview commands.')+'</p>';
  if (plan) {
    content = '<small>'+tr('任务工作目录', 'Working directory')+'</small><code>'+esc(buildPathDisplay.path(plan.cwd) || '—')+'</code>'+
      '<small>'+tr('可执行文件', 'Executable')+'</small><code>'+esc(buildPathDisplay.path(plan.executable) || tr('未找到', 'Not found'))+'</code>';
    for (const action of ['configure', 'build']) {
      const label = action === 'configure' ? tr('配置参数', 'Configure arguments') : tr('构建参数', 'Build arguments');
      const args = plan[action].map(argument => argument === '' ?
        '<code data-build-arg data-empty title="'+tr('空参数','Empty argument')+'" aria-label="'+tr('空参数','Empty argument')+'"></code>' :
        '<code data-build-arg>'+esc(argument)+'</code>');
      content += '<small>'+label+'</small><div class="build-invocation">'+args.join(' ')+'</div>';
    }
  }
  return build_disclosure('commands', tr('命令预览', 'Command preview'), content);
}

function build_section_layout(app, target, inspections) {
  return '<div class="build-page" data-build-view><h1>'+esc(app)+'</h1>'+
    panel(tr('构建目标', 'Build target'), wrap(target))+'<div class="build-inspection">'+inspections+'</div></div>';
}

function build_action_bar(buttons, status) {
  return '<div class="build-workflow"><div class="actions">'+buttons+'</div><span role="status">'+esc(status)+'</span></div>';
}

function build_argument_form(text, disabled, changed) {
  const field = '<label for="build-arguments">'+tr('每行一个 NAME=value', 'One NAME=value per line')+'</label>'+
    '<textarea id="build-arguments" rows="3" spellcheck="false"'+(disabled ? ' disabled' : '')+'>'+esc(text)+'</textarea>'+
    b(tr('应用参数', 'Apply definitions'), 'build-apply', '', '', disabled);
  return build_disclosure('arguments', tr('附加 CMake 参数', 'Additional CMake definitions'), field,
    changed ? tr('未应用', 'Unapplied') : '');
}

function build_target_key(state) {
  return JSON.stringify([state.folder, state.app, state.board, state.build, state.method]);
}

/** Keep the user's disclosures and focused field as the host refreshes a target. */
class build_view_state {
  constructor() {
    this.targets = new Map();
  }

  target(state) {
    const key = build_target_key(state);
    if (!this.targets.has(key)) this.targets.set(key, {open: new Set()});
    return this.targets.get(key);
  }

  capture(root, state, picker) {
    if (!root?.isConnected || !state) return;
    const current = this.target(state);
    const details = root.querySelectorAll('details[data-build-section]');
    current.open = new Set([...details].filter(d => d.open).map(d => d.dataset.buildSection));
    const active = document.activeElement;
    current.focus = root.contains(active) ? this.focused_field(active) : undefined;
    this.method_focus = current.focus?.method && current.focus.method !== state.method ?
      build_target_key({...state, method:current.focus.method}) : undefined;
    current.picker = root.querySelector('.target-picker') ? picker.snapshot() : undefined;
  }

  focused_field(field) {
    if (field.id === 'build-parallel-jobs') return {id:field.id};
    if (field.id === 'build-arguments') return {id: field.id, start: field.selectionStart, end: field.selectionEnd};
    if (field.name === 'build-method') return {method: field.value};
    if (field.dataset.inputAction) return {inputKind:field.dataset.inputKind, inputAction:field.dataset.inputAction};
    if (field.dataset.act) return {action: field.dataset.act};
    if (field.matches('summary')) return {summary: field.parentElement.dataset.buildSection};
    return undefined;
  }

  restore(root, state, picker) {
    const current = this.target(state);
    for (const details of root.querySelectorAll('[data-build-section]')) details.open = current.open.has(details.dataset.buildSection);
    if (this.method_focus === build_target_key(state)) {
      this.method_focus = undefined;
      root.querySelector('[name="build-method"]:checked')?.focus({preventScroll:true});
      return;
    }
    if (current.picker) {
      const anchor = this.control(root, current.picker.action);
      if (anchor && !anchor.disabled) {
        anchor.click();
        picker.restoreInput(current.picker);
        return;
      }
    }
    const focus = current.focus;
    if (!focus) return;
    const element = this.focus_target(root, focus);
    element?.focus({preventScroll: true});
    if (element && focus.start != null) element.setSelectionRange(focus.start, focus.end);
  }

  focus_target(root, focus) {
    if (focus.inputKind) return root.querySelector('[data-input-kind="'+CSS.escape(focus.inputKind)+'"][data-input-action="'+CSS.escape(focus.inputAction)+'"]');
    if (focus.id) return root.querySelector('#'+CSS.escape(focus.id));
    if (focus.method) return root.querySelector('[name="build-method"][value="'+CSS.escape(focus.method)+'"]');
    if (focus.summary) return root.querySelector('[data-build-section="'+CSS.escape(focus.summary)+'"] summary');
    return this.control(root, focus.action);
  }

  control(root, action) {
    return action ? root.querySelector('[data-act="'+CSS.escape(action)+'"]') : null;
  }
}

if (typeof module !== 'undefined') module.exports = {build_invocation, build_path_label, build_target_key, build_view_state};
