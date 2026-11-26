'use strict';

const target_compiler = new compiler_selection(
  (scope,id) => host.postMessage({action:'compiler',id,scope,version:live?.version}),
  (scope,action) => host.postMessage({action,scope,version:live?.version})
);

/** Render host-derived inputs, files and commands for the selected Zephyr target. */
function build_target_fields(state) {
  const disabled = state.busy || !state.folder || !state.trusted;
  const field = (kind, label, value) => build_target_row(kind, label, value, build_path_label(value, state.folder),
    {search:'target:search:'+kind, browse:'target:browse:'+kind, path:'target:path:'+kind}, disabled);
  const rows = [
    field('app', tr('应用目录 · -S', 'Application · -S'), state.app),
    field('board', tr('开发板与 CPU', 'Board and CPU'), state.projectBoard ?
      [tr('工程设置','Project settings'),state.board].filter(Boolean).join(' · ') : state.board),
    board_root_details(state),
    target_compiler.render(state),
    configuration_input_rows(state, ['dts','kconfig','overlay']) || boardDevicetreeRow(state.board, state.devicetree),
    field('build', tr('构建目录 · -B', 'Build directory · -B'), state.build)
  ];
  return targetFields(rows.join(''));
}

function build_typical_action(state) {
  return build_prerequisites(state, 'build').length ? 'configure' : 'build';
}

function build_status(state, action) {
  const configure = action === 'configure';
  const count = build_prerequisites(state, action).length;
  if (!count) return configure ? tr('可配置', 'Ready to configure') : tr('可构建', 'Ready to build');
  return (configure ? tr('配置缺项', 'Configure prerequisites') : tr('构建缺项', 'Build prerequisites'))+' ('+count+')';
}

function build_workflow(state) {
  const next = build_typical_action(state);
  const button = (label, action) => b(label, 'build-run:'+action, next === action ? 'primary' : '', '', state.busy);
  const actions = button(tr('配置', 'Configure'), 'configure')+button(tr('构建', 'Build'), 'build')+
    b(tr('配置 Kconfig', 'Configure Kconfig'), 'build-open:kconfig', 'plain', '', !state.folder)+
    b(tr('启动调试…', 'Start debugging…'), 'build-open:debug', 'plain', '', state.busy || !state.trusted || !state.folder);
  const status = state.busy ? tr('任务运行中', 'Task running') :
    [build_status(state, 'configure'), build_status(state, 'build')].join(' · ');
  return build_action_bar(actions, status);
}

function build_problem_details(state, action) {
  const keys = build_prerequisites(state, action);
  if (!keys.length) return '';
  const title = action === 'configure' ? tr('配置前需要处理', 'Before configuring') : tr('构建前需要处理', 'Before building');
  return '<details id="build-readiness" data-build-section="readiness"><summary>'+title+
    ' ('+keys.length+')</summary><ul>'+keys.map(key => build_issue_row(key, state)).join('')+'</ul></details>';
}

function build_last_failure(state) {
  const failure = state.lastFailure;
  if (!failure) return '';
  const label = failure.action === 'configure' ? tr('配置失败', 'Configuration failed') : tr('构建失败', 'Build failed');
  return '<p class="build-failure">'+esc(failure.method)+' · '+label+' ('+esc(failure.code)+') '+
    b(tr('查看任务输出','View task output'),'build-fix:terminal','plain')+'</p>';
}

function build_arguments(state) {
  const args = studioArgumentDrafts.get(state.app) ?? state.argsText ?? '';
  return build_argument_form(args, state.busy || !state.trusted || !state.folder, studioArgumentDrafts.has(state.app));
}

function build_files(state) {
  const generated = file => /[\\/]zephyr[\\/](?:\.config|zephyr\.dts|zephyr\.elf)$/.test(file);
  const tree = state.devicetree || {};
  const files = (state.files || []).map((path, index) => ({path, index}));
  function display(title, id, entries) {
    const content = entries.map(({path, index}) => '<div class="build-file"><code title="'+esc(ZephyrPathDisplay.path(path))+'">'+
      esc(build_path_label(path, state.app))+'</code>'+b(tr('查看', 'Open'), 'build-file:'+index, 'plain')+'</div>').join('');
    return build_disclosure(id, title, content || '<p class="subtle">'+tr('当前目标未发现文件。', 'No files found for this target.')+'</p>', String(entries.length));
  }
  const inputs = files.filter(({path}) => !generated(path) && tree.boardFile !== path && !tree.overlays?.includes(path));
  return display(tr('应用配置文件', 'Application inputs'), 'inputs', inputs)+
    display(tr('构建产物', 'Build outputs'), 'outputs', files.filter(({path}) => generated(path)));
}

/** One controller owns the visible build form, validation request, and focus restoration. */
class build_page {
  constructor() {
    this.view = new build_view_state();
  }

  capture() {
    this.view.capture(this.root, this.state, targetPicker);
  }

  render(parent, state) {
    this.state = state;
    const view = this.view.target(state);
    const app = state.app?.split(/[\\/]/).filter(Boolean).pop() || tr('构建', 'Build');
    const action = view.action && build_prerequisites(state, view.action).length ? view.action : 'build';
    const readiness = build_problem_details(state, action);
    const target = build_method_field(state)+build_target_fields(state)+sysbuild_field(state)+parallel_field(state)+build_workflow(state)+
      '<div class="build-feedback" aria-live="polite">'+readiness+build_last_failure(state)+'</div>';
    parent.innerHTML = build_section_layout(app, target, flashPanel.render(state)+build_arguments(state)+build_variables(state.buildVariables)+
      build_files(state)+build_command_preview(state));
    this.root = parent.querySelector('[data-build-view]');
    bind_parallel_field(this.root,state,value => send('parallelJobs',value));
    this.root.onclick = event => this.click(event);
    this.root.onchange = event => {
      if (event.target.dataset.flash) return flashPanel.change(this.root,event.target,state.busy);
      if (event.target.name === 'build-method' && event.target.checked) send('method', event.target.value);
      if (event.target.name === 'sysbuild') send('sysbuild',event.target.checked);
    };
    this.root.oninput = event => {
      if (event.target.dataset.flash==='device') return flashPanel.deviceInput(this.root,event.target,state.busy);
      if (event.target.id !== 'build-arguments') return;
      const summary = event.target.closest('details').querySelector('summary');
      if (event.target.value === (state.argsText ?? '')) {
        studioArgumentDrafts.delete(state.app);
        summary.querySelector('small')?.remove();
      } else {
        studioArgumentDrafts.set(state.app, event.target.value);
        if (!summary.querySelector('small')) summary.insertAdjacentHTML('beforeend', '<small>'+tr('未应用', 'Unapplied')+'</small>');
      }
    };
    const dts = this.root.querySelector('.target-tree-details');
    if (dts) dts.dataset.buildSection = 'devicetree';
    this.view.restore(this.root, state, targetPicker);
    const flash=this.root.querySelector('[data-build-section="flash"]');
    if (flash && state.environmentCacheStatus==='current' && state.trusted && !state.flashLoaded) {
      flash.ontoggle=()=>{if(flash.open) send('flashLoad');};
    }
  }

  click(event) {
    const action = event.target.closest('[data-act]')?.dataset.act;
    if (!action) return;
    const [group, key] = action.split(':');
    if (group==='flash') return flashPanel.action(key);
    if (group === 'build-run') return this.attempt(key);
    if (group === 'build-fix') return build_recovery(key, this.root);
    if (group === 'build-open') return key === 'kconfig' ? studioView.showKconfig() : send('launch');
    if (group === 'build-file') return send('file', Number(key));
    if (group === 'build-apply') send('arguments', this.root.querySelector('#build-arguments').value);
  }

  attempt(action) {
    const issues = build_prerequisites(this.state, action);
    if (!issues.length) return send(action);
    const target = this.view.target(this.state);
    target.action = action;
    const feedback = this.root.querySelector('.build-feedback');
    feedback.innerHTML = build_problem_details(this.state, action)+build_last_failure(this.state);
    const details = feedback.querySelector('details');
    details.open = true;
    details.querySelector('summary').focus();
  }
}

