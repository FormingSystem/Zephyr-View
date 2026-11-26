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

async function verify_tutorial(extension, folder) {
  const guide = vscode.env.language.toLowerCase().startsWith('zh') ? 'GETTING_STARTED.md' : 'GETTING_STARTED.en.md';
  await fs.access(path.join(extension.extensionPath, guide));
  for (const name of ['west-workspace', 'toolchain-build', 'local-module', 'hardware-port', 'thread-studio']) {
    const file = await fs.open(path.join(extension.extensionPath, 'guides', 'media', name + '.gif'));
    try {
      const header = Buffer.alloc(10);
      await file.read(header, 0, header.length, 0);
      assert.equal(header.toString('ascii', 0, 3), 'GIF');
      assert.deepEqual([header.readUInt16LE(6), header.readUInt16LE(8)], [1920, 1080]);
    } finally { await file.close(); }
  }
  await vscode.commands.executeCommand('zephyrWorkbench.gettingStarted');
  const {copyExamplesTo} = require(path.join(extension.extensionPath, 'gettingStarted.js'));
  const copy = await copyExamplesTo(extension.extensionUri, folder.uri);
  await fs.access(path.join(copy.fsPath, 'hardware-port', 'boards', 'vnd', 'view_lab', 'board.yml'));
  const config = path.join(copy.fsPath, 'onboarding', 'app', 'prj.conf');
  await fs.writeFile(config, 'CONFIG_PRINTK=n');
  await assert.rejects(() => copyExamplesTo(extension.extensionUri, folder.uri));
  assert.equal(await fs.readFile(config, 'utf8'), 'CONFIG_PRINTK=n');
}

async function verify_thread_studio(extension, folder) {
  const {exportDraft} = require(path.join(extension.extensionPath, 'threadStudioHost'));
  const {defaults} = require(path.join(extension.extensionPath, 'media', 'threadStudio', 'model'));
  const {analyzeApplication} = require(path.join(extension.extensionPath, 'threadAnalysis'));
  const draft = {...defaults('msgq'), creation:'dynamic'};
  const sample = await exportDraft(folder.uri.fsPath, draft);
  const result = await analyzeApplication(sample);
  assert.ok(result.data.threads.some(row => row.entry === 'consumer_entry' && row.api === 'k_thread_create'));
  assert.ok(result.data.objects.some(row => row.name === 'samples'));
  assert.ok(result.data.calls.some(row => row.name === 'k_msgq_get' && row.object === 'samples'));
  const source = path.join(sample, 'src', 'main.c');
  await fs.appendFile(source, '\n/* Local edit */\n');
  await assert.rejects(() => exportDraft(folder.uri.fsPath, draft), {code:'EEXIST'});
  assert.ok((await fs.readFile(source, 'utf8')).endsWith('/* Local edit */\n'));
  await fs.access(path.join(extension.extensionPath, 'guides', 'threads.en.md'));
  await vscode.commands.executeCommand('zephyrWorkbench.threads');
}

exports.run = async function run() {
  const extension = vscode.extensions.getExtension('zephyr-workbench-preview.zephyr-workbench-preview');
  assert.ok(extension, 'The VSIX must be discovered in the isolated profile');
  assert.equal(extension.packageJSON.displayName, 'Zephyr View');
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
  await verify_tutorial(extension, target.folder());
  await verify_thread_studio(extension, target.folder());
  const cmake = await verify_cmake(tools, target.folder().uri.fsPath);
  await vscode.commands.executeCommand('zephyrWorkbench.show', 'workspace');
  await vscode.commands.executeCommand('zephyrWorkbench.probeSupport', 'jlink');
  const tabs = () => vscode.window.tabGroups.all.flatMap(group => group.tabs);
  for (let attempt = 0; attempt < 100; attempt++) {
    const workbenchTabs = tabs().filter(tab => tab.input instanceof vscode.TabInputWebview && tab.label === extension.packageJSON.displayName);
    assert.ok(workbenchTabs.length <= 1, 'Probe support should open inside the same workbench');
    if (workbenchTabs.length === 1) {
      const result = {extension: extension.packageJSON.version, vscode: vscode.version,
        platform: process.platform, arch: process.arch, cmake, hostBuild: 'passed', threadStudioExportAndAnalysis: 'passed'};
      await fs.writeFile(process.env.ZEPHYR_TEST_EVIDENCE, JSON.stringify(result));
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail('The installed extension did not open its workbench');
};
