'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {downloadAndUnzipVSCode, resolveCliPathFromVSCodeExecutablePath, runTests} = require('@vscode/test-electron');

async function verify(vsix, directory) {
  const executable = process.env.VSCODE_EXECUTABLE_PATH || await downloadAndUnzipVSCode({
    version: 'stable', cachePath: path.join(directory, 'downloads')
  });
  // Only fixed relative arguments reach the Windows CLI batch wrapper.
  await fs.copyFile(vsix, path.join(directory, 'workbench.vsix'));
  const install = ['--extensions-dir=extensions', '--user-data-dir=profile', '--install-extension', 'workbench.vsix'];
  const cli = resolveCliPathFromVSCodeExecutablePath(executable);
  if (process.platform === 'win32') {
    execFileSync(process.env.ComSpec, ['/d', '/v:off', '/s', '/c', '""%ZEPHYR_TEST_CLI%" ' + install.join(' ') + '"'], {
      cwd: directory, env: {...process.env, ZEPHYR_TEST_CLI: cli}, stdio: 'inherit', windowsVerbatimArguments: true
    });
  } else {
    execFileSync(cli, install, {cwd: directory, stdio: 'inherit'});
  }
  const project = path.join(directory, 'Zephyr project 工程');
  await fs.mkdir(project);
  await fs.writeFile(path.join(project, 'prj.conf'), 'CONFIG_PRINTK=y\n');
  const installed = path.join(directory, 'extensions');
  const [record] = JSON.parse(await fs.readFile(path.join(installed, 'extensions.json'), 'utf8'));
  assert.equal(record.identifier.id, 'zephyr-workbench-preview.zephyr-workbench-preview');
  const harness = path.join(directory, 'test-harness');
  await fs.mkdir(harness);
  await fs.writeFile(path.join(harness, 'package.json'), JSON.stringify({
    name: 'zephyr-test-harness', publisher: 'workbench-tests', version: '0.0.1', engines: {vscode: '^1.85.0'}
  }));
  const suite = path.join(harness, 'workbench_suite.cjs');
  await fs.copyFile(require.resolve('./workbench_suite.cjs'), suite);
  await fs.copyFile(require.resolve('./programStudio.cjs'),path.join(harness,'programStudio.cjs'));
  const evidence = path.join(directory, 'native-result.json');
  await runTests({
    vscodeExecutablePath: executable,
    extensionDevelopmentPath: harness,
    extensionTestsPath: suite,
    extensionTestsEnv: {NODE_PATH: '', ZEPHYR_TEST_INSTALLED: path.join(installed, record.relativeLocation),
      ZEPHYR_TEST_VERSION: record.version, ZEPHYR_TEST_EVIDENCE: evidence},
    launchArgs: [project, '--disable-updates', '--disable-gpu', '--extensions-dir=' + installed,
      '--user-data-dir=' + path.join(directory, 'profile')]
  });
  console.log('Installed workbench:', JSON.parse(await fs.readFile(evidence, 'utf8')));
}

async function main() {
  const vsix = process.argv[2];
  assert.ok(vsix, 'Pass the path to the VSIX to test.');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'Zephyr 移动安装 '));
  try { await verify(path.resolve(vsix), directory); }
  finally { await fs.rm(directory, {recursive: true, force: true, maxRetries: 6, retryDelay: 300}); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
