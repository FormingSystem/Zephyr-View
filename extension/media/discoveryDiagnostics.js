'use strict';

/** Show the source of a discovery failure beside the results that are still usable. */
function discovery_diagnostics(issues) {
  if (!issues?.length) return '';
  const advice = {
    boardFile: ['对照本版本的板卡定义检查报错位置、板名和 SoC 引用。', 'Check the reported location, board name and SoC reference against this checkout’s board schema.'],
    socFile: ['检查 SoC 定义中的系列、SoC 名和 CPU 集群引用。', 'Check the family, SoC name and CPU cluster references in the SoC definition.'],
    manifestFile: ['检查清单中的 YAML、projects 和 import 路径。', 'Check the manifest YAML, project entries and import paths.'],
    moduleFile: ['检查模块的 YAML 和 build.settings 中相对于模块目录的路径。', 'Check the module YAML and resolve build.settings paths relative to the module directory.'],
    westConfig: ['检查 [manifest] 下的 path 和 file 是否指向当前工作区的清单。', 'Verify that path and file under [manifest] identify the manifest in this workspace.'],
    west: ['在当前工作区运行 west boards 核对错误，并检查选用的 Python 环境。', 'Run west boards in this workspace and check the selected Python environment.'],
    python: ['选择当前工程的 Python 环境，并安装此 Zephyr 版本声明的 Python 依赖。', 'Select the project’s Python environment and install the requirements listed by this Zephyr checkout.'],
    source: ['选择包含 scripts/list_boards.py 的 Zephyr 源码目录。', 'Choose the Zephyr checkout containing scripts/list_boards.py.']
  };
  const fallback = ['检查当前 Zephyr 源码、板卡搜索目录和报告的错误。', 'Check the selected Zephyr checkout, board roots and reported error.'];
  const rows = issues.map(issue => {
    const file = issue.path ? '<code>'+esc(ZephyrPathDisplay.path(issue.path))+'</code>' : '';
    const open = issue.path ? '<button type="button" class="plain" data-discovery-file="'+esc(issue.path)+'">'+tr('打开文件','Open file')+'</button>' : '';
    const kind = issue.kind === 'manifest' ? 'manifestFile' : issue.kind;
    return '<li>'+file+open+'<div>'+esc(issue.message)+'</div><small>'+tr(...(advice[kind] || fallback))+'</small></li>';
  });
  return '<details class="discovery-diagnostics"'+(issues.length < 3 ? ' open' : '')+'><summary>'+tr('识别问题','Discovery issues')+' · '+issues.length+
    '</summary><ul>'+rows.join('')+'</ul></details>';
}

document.addEventListener('click', event => {
  const button = event.target.closest('[data-discovery-file]');
  if (button) send('openDiscoveryFile', button.dataset.discoveryFile);
});
