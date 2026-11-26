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
  for (const name of ['west-workspace', 'toolchain-build', 'local-module', 'hardware-port', 'thread-studio', 'visual-program', 'program-authoring', 'program-diagrams', 'program-views']) {
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

async function verify_source_review(extension, design, graph) {
  const {preview_program} = require(path.join(extension.extensionPath,'visualProgramFiles'));
  const {program_source_preview} = require(path.join(extension.extensionPath,'program_source_preview'));
  const plan = await preview_program(design,graph);
  const subscriptions = [];
  try {
    const preview = new program_source_preview({subscriptions});
    const review = await preview.show(plan.original,plan.next,'Review src/main.c');
    const find_diff = () => vscode.window.tabGroups.all.flatMap(group => group.tabs).map(tab => tab.input)
      .find(input => input instanceof vscode.TabInputTextDiff && input.modified.scheme === 'zephyr-program-preview');
    for (let attempt = 0; attempt < 100 && !find_diff(); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const input = find_diff();
    assert.ok(input, 'Expected the generated source diff to appear');
    const texts = await Promise.all([input.original,input.modified].map(uri=>vscode.workspace.openTextDocument(uri)));
    assert.deepEqual(texts.map(doc=>doc.getText().replaceAll('\r\n','\n')),
      [plan.original,plan.next].map(text=>text.replaceAll('\r\n','\n')));
    assert.equal(await fs.readFile(plan.target,'utf8'),plan.original);
    await review.close();
  } finally { for (const item of subscriptions) item.dispose(); }
}

async function verify_live_source(extension, project) {
  const flags = path.join(extension.extensionPath,'examples','visual-program','flags.zephyr-program.json');
  const {validate,generate} = require(path.join(extension.extensionPath,'media','threadStudio','programModel'));
  const example = JSON.parse(await fs.readFile(flags,'utf8'));
  assert.deepEqual(validate(example),[]);
  assert.ok(generate(example)['src/main.c'].includes('UINT32_C(2147483648)'));
  const source = vscode.Uri.file(path.join(project,'src','main.c'));
  const panels = () => vscode.window.tabGroups.all.flatMap(group=>group.tabs).filter(tab =>
    tab.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith('zephyrWorkbench.liveSource'));
  await vscode.commands.executeCommand('zephyrWorkbench.liveSource',source);
  await vscode.commands.executeCommand('zephyrWorkbench.liveSource',source);
  for (let i=0;i<80 && !panels().length;i++) await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(panels().length,1,'Opening the same source twice should reuse the live preview');
  await vscode.window.tabGroups.close(panels(),true);
}

async function verify_visual_program(extension, folder) {
  const {exportProgram,inspectProgram,designFile} = require(path.join(extension.extensionPath,'visualProgramFiles'));
  const {example} = require(path.join(extension.extensionPath,'media','threadStudio','programModel'));
  const project = await exportProgram(folder.uri.fsPath,example());
  const uri = vscode.Uri.file(path.join(project,designFile));
  await vscode.commands.executeCommand('vscode.openWith',uri,'zephyrWorkbench.visualProgram',{preview:false});
  const custom = () => vscode.window.tabGroups.all.flatMap(group=>group.tabs).find(tab =>
    tab.input instanceof vscode.TabInputCustom && tab.input.uri.toString()===uri.toString());
  assert.ok(custom(),'The exported graph must open in the custom editor');
  const doc = await vscode.workspace.openTextDocument(uri);
  const graph = JSON.parse(doc.getText());
  graph.threads[0].initialValue = 123;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri,new vscode.Range(doc.positionAt(0),doc.positionAt(doc.getText().length)),JSON.stringify(graph,null,2)+'\n');
  assert.ok(await vscode.workspace.applyEdit(edit));
  assert.ok(await doc.save());
  assert.equal(JSON.parse(await fs.readFile(uri.fsPath,'utf8')).threads[0].initialValue,123);
  assert.ok((await inspectProgram(uri.fsPath,graph)).changed);
  await verify_source_review(extension,uri.fsPath,graph);
  await verify_live_source(extension,project);
  await fs.access(path.join(extension.extensionPath,'examples','visual-program','console.txt'));
  await fs.access(path.join(extension.extensionPath,'guides','visual-program.en.md'));
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
  await verify_visual_program(extension, target.folder());
  const cmake = await verify_cmake(tools, target.folder().uri.fsPath);
  await vscode.commands.executeCommand('zephyrWorkbench.show', 'workspace');
  await vscode.commands.executeCommand('zephyrWorkbench.probeSupport', 'jlink');
  const tabs = () => vscode.window.tabGroups.all.flatMap(group => group.tabs);
  for (let attempt = 0; attempt < 100; attempt++) {
    const workbenchTabs = tabs().filter(tab => tab.input instanceof vscode.TabInputWebview && tab.label === extension.packageJSON.displayName);
    assert.ok(workbenchTabs.length <= 1, 'Probe support should open inside the same workbench');
    if (workbenchTabs.length === 1) {
      const result = {extension: extension.packageJSON.version, vscode: vscode.version,
        platform: process.platform, arch: process.arch, cmake, hostBuild: 'passed', threadStudioExportAndAnalysis: 'passed', visualProgramCustomEditor: 'passed', liveSourcePreview:'passed'};
      await fs.writeFile(process.env.ZEPHYR_TEST_EVIDENCE, JSON.stringify(result));
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail('The installed extension did not open its workbench');
};
