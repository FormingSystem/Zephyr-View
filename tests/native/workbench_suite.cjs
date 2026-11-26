'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const vscode = require('vscode');
const execute = promisify(execFile);

async function verify_cmake(tools, directory) {
  assert.ok(tools.cmake && path.isAbsolute(tools.cmake), 'CMake must resolve on the extension host');
  assert.ok(tools.ninja && path.isAbsolute(tools.ninja), 'Ninja must resolve on the extension host');
  const options = {cwd: directory};
  const {stdout} = await execute(tools.cmake, ['--version'], options);
  const build = path.join(directory, 'native build');
  await fs.writeFile(path.join(directory, 'CMakeLists.txt'), [
    'cmake_minimum_required(VERSION 3.20)', 'project(host_check NONE)',
    'add_custom_target(check_host ALL COMMAND "${CMAKE_COMMAND}" -E touch "${CMAKE_BINARY_DIR}/host.ok" VERBATIM)'
  ].join('\n'));
  await execute(tools.cmake, ['-S', directory, '-B', build, '-G', 'Ninja', '-DCMAKE_MAKE_PROGRAM=' + tools.ninja], options);
  await execute(tools.cmake, ['--build', build, '--parallel', '2'], options);
  await fs.access(path.join(build, 'host.ok'));
  return stdout.split(/\r?\n/)[0];
}

exports.run = async function run() {
  const extension = vscode.extensions.getExtension('zephyr-workbench-preview.zephyr-workbench-preview');
  assert.ok(extension, 'The VSIX must be discovered in the isolated profile');
  const installed = await fs.realpath(extension.extensionPath);
  assert.equal(installed, await fs.realpath(process.env.ZEPHYR_TEST_INSTALLED));
  assert.equal(extension.packageJSON.version, process.env.ZEPHYR_TEST_VERSION);
  for (const name of Object.keys(extension.packageJSON.dependencies || {})) {
    const resolved = await fs.realpath(require.resolve(name, {paths: [extension.extensionPath]}));
    assert.ok(path.relative(installed, resolved).startsWith('node_modules' + path.sep),
      name + ' must resolve inside the installed VSIX');
  }
  const {target} = await extension.activate();
  await vscode.commands.executeCommand('zephyrWorkbench.refresh');
  assert.equal(target.folder().name, 'Zephyr project 工程');
  const {inspectWorkspace} = require(path.join(extension.extensionPath, 'workspace.js'));
  const {tools} = await inspectWorkspace(target);
  const cmake = await verify_cmake(tools, target.folder().uri.fsPath);
  await vscode.commands.executeCommand('zephyrWorkbench.show', 'workspace');
  await vscode.commands.executeCommand('zephyrWorkbench.probeSupport', 'jlink');
  const tabs = () => vscode.window.tabGroups.all.flatMap(group => group.tabs);
  for (let attempt = 0; attempt < 100; attempt++) {
    const workbenchTabs = tabs().filter(tab => tab.input instanceof vscode.TabInputWebview && tab.label === 'Zephyr Extension');
    assert.ok(workbenchTabs.length <= 1, 'Probe support should open inside the same workbench');
    if (workbenchTabs.length === 1) {
      const result = {extension: extension.packageJSON.version, vscode: vscode.version,
        platform: process.platform, arch: process.arch, cmake, hostBuild: 'passed'};
      await fs.writeFile(process.env.ZEPHYR_TEST_EVIDENCE, JSON.stringify(result));
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail('The installed extension did not open its workbench');
};
