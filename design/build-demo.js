'use strict';

const demo_build_view = new build_view_state();
const demo_argument_drafts = new Map();
let last_demo_target;

function demo_build_target() {
  const hostCount = navigator.hardwareConcurrency || 1;
  const custom = model.parallelJobs?.[model.activeWs || appKey()];
  return {folder:model.activeWs || appKey(), app:appKey(), board:model.board,projectBoard:model.projectBoard,
    system:model.system,configured:model.configured,
    build:dir(), method:model.method, trusted:true, parallelism:{hostCount, custom,
      automatic:hostCount, jobs:custom ?? hostCount, source:'host'}};
}

function demo_invocation(target, inputs) {
  const west = target.method === 'west';
  const configure = west ? ['build', '--cmake-only', '-d', target.build, target.app] :
    ['-S', target.system ? '<ZEPHYR_BASE>/share/sysbuild' : target.app, '-B', target.build];
  if (!target.projectBoard) configure.push(...(west ? ['-b',target.board] : ['-DBOARD='+target.board]));
  if (west && target.system) configure.push('--sysbuild');
  if (!west && inputs.generator) configure.push('-G', inputs.generator);
  if (west && (inputs.definitions.length || target.system)) configure.push('--');
  if (target.system) configure.push('-DAPP_DIR:PATH='+target.app);
  configure.push(...inputs.definitions.map(definition => definition.argument));
  const count = String(target.parallelism.jobs);
  const build = west ? ['build', '-d', target.build, '-o=-j'+count] : ['--build', target.build, '--parallel', count];
  return {...target, plan:{executable:west ? 'west' : 'cmake', configure, build}};
}

function demo_build_problems(requirements, action) {
  const issues = requirements[action];
  if (!issues.length) return '';
  const rows = issues.map(issue => {
    const can_fix = issue.action !== 'configure' || !requirements.configure.length;
    return '<li>'+esc(issue.message)+(can_fix ? b(issue.label, issue.action, 'plain') : '')+'</li>';
  });
  const title = action === 'configure' ? '配置前需要处理' : '构建前需要处理';
  return '<div class="build-feedback"><details data-build-section="readiness" id="build-readiness"><summary>'+
    title+' ('+issues.length+')</summary><ul>'+rows.join('')+'</ul></details></div>';
}

function demo_build_actions(requirements) {
  const counts = requirements.configure.length ? '配置缺项 ('+requirements.configure.length+')' : '可配置';
  const status = counts+' · '+(requirements.build.length ? '构建缺项 ('+requirements.build.length+')' : '可构建');
  const buttons = b('配置','configure',requirements.build.length ? 'primary' : '')+
    b('构建','build',requirements.build.length ? '' : 'primary')+b('配置 Kconfig','node:kconfig','plain')+
    b('启动调试…','side:start','plain');
  return build_action_bar(buttons, status);
}

function demo_file_sections() {
  const inputs = file('prj.conf', '软件配置 · CONF_FILE', 'node:kconfig', '编辑');
  const outputs = model.configured ? file('.config', 'Kconfig 合并结果', 'result:.config')+
    (model.built ? file('zephyr.elf', '可执行映像', 'result:zephyr.elf') : '') : '<p>完成配置后可查看 .config。</p>';
  return build_disclosure('inputs', '应用配置文件', inputs, '1')+
    build_disclosure('outputs', '构建产物', outputs, String(model.configured ? 1+Number(model.built) : 0));
}

function buildPage() {
  const state = demo_build_target();
  const plan = exampleBuildInputs();
  const requirements = buildRequirements(plan);
  const field = (kind, label, value) => build_target_row(kind, label, value, value,
    {search:kind==='build'?'projdir':kind, browse:'pathbrowse:'+kind, path:'pathtype:'+kind});
  const tools=demo_environment_state();
  const board_roots=plan.inputs.get('BOARD_ROOT');
  if(board_roots)tools.buildVariables={rows:[{name:'BOARD_ROOT',planned:{source:'-D',value:board_roots.value}}]};
  const board=state.projectBoard ? ['工程设置',state.board].filter(Boolean).join(' · ') : state.board;
  const fields = targetFields(field('app','应用目录 · -S',state.app)+field('board','开发板与 CPU',board)+
    board_root_details(tools)+demo_compiler.render(tools)+
    configuration_input_rows({...state,configurationFiles:demo_input_groups()},['dts','kconfig','overlay'])+
    field('build','构建目录 · -B',state.build));
  const target = build_method_field(state)+fields+sysbuild_field(state)+parallel_field(state)+demo_build_actions(requirements)+
    demo_build_problems(requirements, demo_build_view.target(state).action || 'build');
  const args = demo_argument_drafts.get(exampleAppId()) ?? exampleArguments();
  const inspections = flashPanel.render({flash:demoFlashModel(),flashLoaded:true})+
    build_argument_form(args, false, demo_argument_drafts.has(exampleAppId()))+
    exampleBuildVariables(plan)+demo_file_sections()+build_command_preview(demo_invocation(state, plan))+
    build_disclosure('demo-tools', '工程工具', projectActions());
  return build_section_layout(model.app, target, inspections);
}

function capture_demo_build() {
  demo_build_view.capture(document.querySelector('[data-build-view]'),last_demo_target,designPicker);
}

function restore_demo_build() {
  const root = document.querySelector('[data-build-view]');
  if (!root) return;
  last_demo_target = demo_build_target();
  bind_parallel_field(root,last_demo_target,value => {
    model.parallelJobs ??= {};
    if (value) model.parallelJobs[last_demo_target.folder] = Number(value);
    else delete model.parallelJobs[last_demo_target.folder];
    commitDemo();
  });
  const dts = root.querySelector('.target-tree-details');
  if (dts) dts.dataset.buildSection = 'devicetree';
  demo_build_view.restore(root,last_demo_target,designPicker);
}

function apply_demo_arguments() {
  const field = $('#build-arguments');
  field.setCustomValidity('');
  try {userExampleDefinitions(field.value);}
  catch (error) {field.setCustomValidity(error.message);field.reportValidity();return;}
  (model.argumentsByApplication ??= {})[exampleAppId()] = field.value;
  demo_argument_drafts.delete(exampleAppId());
  invalidate();
  commitDemo();
}

document.addEventListener('input', event => {
  if (event.target.dataset.flash==='device') flashPanel.deviceInput($('#main'),event.target,false);
  if (event.target.id === 'build-arguments') demo_argument_drafts.set(exampleAppId(), event.target.value);
});
document.addEventListener('change', event => {
  if (event.target.dataset.flash) flashPanel.change($('#main'),event.target,false);
  if (event.target.name === 'build-method' && event.target.checked) handle('method:'+event.target.value);
  if (event.target.name === 'sysbuild') {model.system=event.target.checked;invalidate();commitDemo();}
});

