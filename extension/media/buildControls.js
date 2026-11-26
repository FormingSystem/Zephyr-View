'use strict';

/** Labels and recovery actions for the build planner's prerequisite codes. */
const build_issues = {
  systemSource: ['请指定包含 share/sysbuild 的 Zephyr 源码目录。','Locate the Zephyr source containing share/sysbuild.','配置 Zephyr 源码…','Locate Zephyr source…'],
  'files-dts': ['请选择此目标的板级 DTS 文件。','Choose a board DTS for this target.','选择设备树…','Choose DTS…'],
  'files-kconfig': ['请选择此应用要合并的配置文件。','Choose the configuration files for this application.','选择配置文件…','Choose configuration files…'],
  'files-overlay': ['请确认此目标要使用的设备树覆盖文件。','Choose the devicetree overlays for this target.','选择覆盖文件…','Choose overlays…'],
  folder: ['请先打开工程文件夹。', 'Open a project folder first.', '打开文件夹…', 'Open folder…'],
  trust: ['工作区处于受限模式。', 'This workspace is in restricted mode.', '管理信任', 'Manage trust'],
  cmake: ['未找到 CMake。', 'CMake was not found.', '定位 CMake…', 'Locate CMake…'],
  west: ['未找到 west。', 'west was not found.', '定位 west…', 'Locate west…'],
  ninja: ['当前生成器的构建工具不可用。', 'The build tool for this generator is unavailable.', '检查主机工具', 'Check host tools'],
  workspace: ['还未关联 west 工作区。', 'No west workspace is associated with this project.', '打开工作区…', 'Open workspace…'],
  manifest: ['west 清单缺失或无效。', 'The west manifest is missing or invalid.', '查看 west 配置', 'View west configuration'],
  application: ['请选择包含 CMakeLists.txt 的应用。', 'Choose an application containing CMakeLists.txt.', '选择应用', 'Choose application'],
  board: ['请选择开发板和 CPU 目标。', 'Choose a board and CPU target.', '选择目标', 'Choose target'],
  directory: ['请选择与当前应用和开发板匹配的构建目录。', 'Choose a build directory for this application and board.', '选择构建目录…', 'Choose build folder…'],
  compilerDirectory: ['现有构建目录使用了其他编译器。请选择一个新的构建目录。','The existing build directory uses a different compiler. Choose a new build directory.','选择构建目录…','Choose build folder…'],
  sourceCheckout: ['现有构建目录属于另一份 Zephyr 源码。请选择新的构建目录，或切回原先的源码。','This build directory belongs to another Zephyr checkout. Choose a fresh build directory or switch back to its source.','选择构建目录…','Choose build folder…'],
  modules: ['指定的模块目录缺失。', 'Configured module directories are missing.', '管理模块', 'Manage modules'],
  arguments: ['请修正附加 CMake 参数。', 'Correct the additional CMake definitions.', '编辑参数', 'Edit definitions'],
  parallelJobs: ['CMAKE_BUILD_PARALLEL_LEVEL 需要正整数。可在此为构建指定并行任务数。', 'CMAKE_BUILD_PARALLEL_LEVEL needs a positive integer. Choose a job limit for this build.', '设置并行任务数', 'Set build jobs'],
  configureFirst: ['先配置当前目标，生成构建文件。', 'Configure this target to generate its build files.', '现在配置', 'Configure now'],
  configureFailed: ['上次配置失败，请查看输出并重新配置。', 'Configuration failed. Check the output, then configure again.', '重新配置', 'Configure again'],
  reconfigure: ['配置输入已更改，请重新配置。', 'The configuration inputs changed. Configure again.', '重新配置', 'Configure again']
};

function build_prerequisites(state, action) {
  if (!state.folder) return ['folder'];
  const issues = state.readiness?.[action] || [];
  return state.trusted ? issues : ['trust', ...issues.filter(key => key !== 'trust')];
}

function build_issue_row(key, state) {
  const description = build_issues[key];
  if (!description) return '<li>'+esc(key)+'</li>';
  const [cn, en, action_cn, action_en] = description;
  const message = key === 'arguments' && state.error || tr(cn, en);
  const configure = ['configureFirst', 'configureFailed', 'reconfigure'].includes(key);
  const available = (!configure || !build_prerequisites(state, 'configure').length) && (state.trusted || ['folder', 'trust'].includes(key));
  const remedy = available ? b(tr(action_cn, action_en), 'build-fix:'+key, 'plain', '', state.busy) : '';
  const missing = key === 'modules' ? (state.missingModules || []).map(path => '<li><code>'+esc(ZephyrPathDisplay.path(path))+'</code></li>').join('') : '';
  return '<li>'+esc(message)+remedy+(missing ? '<ul>'+missing+'</ul>' : '')+'</li>';
}

function build_recovery(key, root) {
  if (key==='systemSource') return send('environment','ZEPHYR_BASE');
  if (key.startsWith('files-')) {
    const row = root.querySelector('[data-file-group="'+key.slice(6)+'"]');
    return (row?.querySelector('[data-input-action="list"]:enabled') || row?.querySelector('[data-input-action="browse"]'))?.click();
  }
  if (key === 'parallelJobs') return root.querySelector('#build-parallel-jobs')?.focus();
  const targets = {application:'search:app', board:'search:board', directory:'browse:build',compilerDirectory:'browse:build',sourceCheckout:'browse:build'};
  if (targets[key]) return root.querySelector('[data-act="target:'+targets[key]+'"]')?.click();
  if (key === 'arguments') {
    const input = root.querySelector('#build-arguments');
    input.closest('details').open = true;
    input.focus();
    return;
  }
  if (key === 'cmake' || key === 'west') return send('environment', key);
  if (key === 'ninja' || key === 'modules') return send('page', key === 'ninja' ? 'workspace' : 'modules');
  const route = {folder:'folder', workspace:'folder', trust:'manageTrust', manifest:'westConfig',
    configureFirst:'configure', configureFailed:'configure', reconfigure:'configure', terminal:'showTerminal'};
  if (route[key]) send(route[key]);
}

if (typeof module !== 'undefined') module.exports = {build_prerequisites};

