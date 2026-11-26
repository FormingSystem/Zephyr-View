'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const {pickDirectory, pickFile, inputDirectory} = require('./fileDialogs');
const {t, select} = require('./installationDialogs');
const {buildEnv} = require('./buildSetup');
const {executeAndWait} = require('./taskCompletion');
const {westTopdir, relativeEntry, localManifest, localInitPlan, remoteInitPlan, repairConfig} = require('./westWorkspace');

const {Uri, window, workspace} = vscode;
const initializing = new Set();

async function openExisting(s, typed, current) {
  const options = {title:t('打开已有 west 工作区或子目录', 'Open an existing west workspace or subdirectory'),
    defaultUri:s.folder?.uri, baseUri:s.folder?.uri};
  const folder = typed ? await inputDirectory(options) : await pickDirectory(options);
  if (!folder || !current()) return;
  const root = await westTopdir(folder.fsPath);
  if (!root) throw Error(t('所选目录及其父目录中没有 .west。请选择已有工作区或使用「初始化」。',
    'No .west directory in this folder or its parents. Choose an existing workspace or use Initialize.'));
  return root;
}

async function chooseManifest(defaultUri) {
  const repository = await pickDirectory({title:t('选择清单仓库根目录','Select the manifest repository root'),defaultUri});
  if (!repository) return;
  const standard = Uri.joinPath(repository, 'west.yml');
  const exists = await fs.stat(standard.fsPath).then(stat=>stat.isFile(),error=>{
    if (error.code !== 'ENOENT') throw error;
    return false;
  });
  if (exists) {
    const choice = await select(t('使用哪个清单文件？','Which manifest file should west use?'), [
      ['default','west.yml'], ['browse',t('选择其他文件…','Choose another file…')] ]);
    if (!choice) return;
    if (choice === 'default') return checkManifest(repository,standard);
  }
  const file = await pickFile({title:t('选择仓库中的清单文件','Select a manifest file in this repository'),defaultUri:repository});
  if (file) return checkManifest(repository,file);
}

async function checkManifest(repository, uri) {
  const file = await localManifest(repository.fsPath,uri.fsPath);
  if (!file) throw Error(t('请选择该仓库内含 manifest 映射的 YAML 文件。','Choose a YAML file in the repository with a manifest mapping.'));
  return {repository:repository.fsPath,file};
}

async function remotePlan(s) {
  const dest = await pickDirectory({title:t('选择用于初始化的空目录','Select an empty workspace directory'), defaultUri:s.folder?.uri});
  if (!dest) return;
  if ((await fs.readdir(dest.fsPath)).length)
    throw Error(t('请选择一个空目录，或在目录选择器中新建目录。','Select an empty directory or create one in the folder picker.'));
  const url = await window.showInputBox({title:t('清单仓库的 Git 地址','Manifest repository Git URL'),value:'https://github.com/zephyrproject-rtos/zephyr',
    validateInput:value=>!value.trim() || /^[\s-]|[\r\n\0]/.test(value) ? t('请输入 Git 仓库地址。','Enter a Git repository URL.') : undefined});
  if (!url) return;
  const rev = await window.showInputBox({title:t('清单版本（可选）','Manifest revision (optional)'),placeHolder:t('默认分支，或输入标签、分支','Default branch, or enter a tag or branch')});
  if (rev === undefined) return;
  const file = await window.showInputBox({title:t('仓库内的清单文件','Manifest file in the repository'),value:'west.yml',
    validateInput:value=>!value.trim() || path.isAbsolute(value) || /^[A-Za-z]:|^[\/\\]|[\r\n\0]/.test(value) || value.split(/[\/\\]/).includes('..') ?
      t('请输入仓库内的相对路径。','Enter a relative path inside the repository.') : undefined});
  if (file) return remoteInitPlan(dest.fsPath,url.trim(),rev.trim(),file.trim());
}

async function initialize(s, current) {
  if (!s.tools.west || !s.tools.git) throw Error(t('请在工作区的环境搭建中配置 west 和 Git，再初始化。','Configure west and Git in Environment setup, then initialize.'));
  const mode = await select(t('初始化 west 工作区','Initialize west workspace'),[
    ['local',t('使用本地清单仓库（离线）','Use a local manifest repository (offline)')],
    ['remote',t('从 Git 仓库克隆清单','Clone a manifest repository from Git')] ]);
  if (!mode || !current()) return;
  const plan = mode === 'local' ? await localPlan(s) : await remotePlan(s);
  if (!plan || !current()) return;
  const confirm = t('初始化','Initialize');
  if (await window.showInformationMessage(t('在此目录初始化 west 工作区？','Initialize the west workspace in this directory?'),
      {modal:true,detail:plan.root}, confirm) !== confirm || !current()) return;
  const destination = await fs.realpath(plan.root);
  const key = process.platform === 'win32' ? destination.toLowerCase() : destination;
  if (initializing.has(key)) return;
  initializing.add(key);
  try {
    if (await westTopdir(plan.root) || (plan.repository && await westTopdir(plan.repository)))
      throw Error(t('此位置已经属于 west 工作区。请使用「打开已有工作区」。','This location already belongs to a west workspace. Use Open existing workspace.'));
    if (mode === 'remote' && (await fs.readdir(plan.root)).length)
      throw Error(t('目标目录已有文件，请选择空目录。','The destination contains files. Choose an empty directory.'));
    if (!current()) return;
    await runInitialization(s,plan);
    if (current()) return plan.root;
  } finally { initializing.delete(key); }
}

async function localPlan(s) {
  const entry = await chooseManifest(s.folder?.uri);
  if (entry) return localInitPlan(entry.repository,entry.file);
}

async function runInitialization(s,plan) {
  // Resolve the new topdir independently of the active project's environment.
  const env = {...buildEnv(s),ZEPHYR_BASE:'',WEST_CONFIG_LOCAL:path.join(plan.root,'.west','config')};
  const execution = new vscode.ProcessExecution(s.tools.west,plan.args,{cwd:plan.root,env});
  const task = new vscode.Task({type:'zephyrWestInit'},s.folder || vscode.TaskScope.Global,'west init','Zephyr',execution);
  if (await executeAndWait(task) !== 0) throw Error(t('初始化未完成，请查看 west init 终端。','Initialization did not finish. Check the west init terminal.'));
}

async function checkConfigFile(root, file) {
  const info = await fs.lstat(file).catch(error=>{if(error.code !== 'ENOENT') throw error;});
  if (path.relative(await fs.realpath(root),await fs.realpath(path.dirname(file))) !== '.west' ||
      (info && !info.isFile()))
    throw Error(t('配置不在工作区的常规 .west/config 文件中，请手动核对。',
      'The configuration is not a regular .west/config file in this workspace. Inspect it manually.'));
}

async function repair(s, current) {
  const root = s.manifest.root?.fsPath;
  if (!root || !s.manifest.invalid) return;
  const config = s.manifest.config;
  await checkConfigFile(root,config.fsPath);
  const original = await fs.readFile(config.fsPath,'utf8').catch(error=>{if (error.code !== 'ENOENT') throw error;});
  const entry = await chooseManifest(Uri.file(root));
  if (!entry || !current()) return;
  const repo = relativeEntry(root,entry.repository);
  if (!repo || !relativeEntry(await fs.realpath(root),await fs.realpath(entry.repository)))
    throw Error(t('请选择此工作区内的清单仓库。','Select a manifest repository inside this workspace.'));
  const text = repairConfig(original || '',repo,entry.file);
  if (text === undefined) throw Error(t('无法安全解析本地配置。请打开 .west/config 检查 INI 语法和重复项。',
    'Open .west/config to correct its INI syntax or duplicate entries before repairing.'));
  if (text === original) throw Error(t('清单位置未改变。请根据诊断修复 YAML 文件。','The manifest location is unchanged. Use the diagnostic to correct the YAML file.'));
  const accept = t('保存清单位置','Save manifest location');
  const detail = config.fsPath+'\n\n[manifest]\npath = '+repo+'\nfile = '+entry.file;
  if (await window.showInformationMessage(accept+'?',{modal:true,detail},accept) !== accept || !current()) return;
  await checkConfigFile(root,config.fsPath);
  if (!current()) return;
  if (original === undefined) return fs.writeFile(config.fsPath,text,{flag:'wx'});
  const doc = await workspace.openTextDocument(config);
  if (!current() || doc.isDirty || doc.getText() !== original || await fs.readFile(config.fsPath,'utf8') !== original)
    throw Error(t('配置已变更，请先保存或重新加载后再修复。','The configuration changed. Save or reload it before repairing.'));
  const edit = new vscode.WorkspaceEdit();
  edit.replace(config,new vscode.Range(doc.positionAt(0),doc.positionAt(original.length)),text);
  if (!await workspace.applyEdit(edit) || !await doc.save()) throw Error(t('无法保存 west 配置。','Could not save the west configuration.'));
}

module.exports = {openExisting, initialize, repair};
