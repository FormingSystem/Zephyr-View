'use strict';

const path = require('node:path');
const vscode = require('vscode');
const key = folder => 'toolDirectories:'+folder.uri.toString();
const config = folder => vscode.workspace.getConfiguration('zephyrWorkbench', folder.uri);

function relativeDirectory(root, directory) {
  const relative = path.relative(root, directory);
  if (relative === '..' || relative.startsWith('..'+path.sep) || path.isAbsolute(relative)) return;
  return (relative || '.').split(path.sep).join('/');
}

function searchDirectories(context, folder) {
  if (!context || !folder || !vscode.workspace.isTrusted) return [];
  const shared = config(folder).get('toolDirectories', []);
  const privateDirs = context.workspaceState.get(key(folder), []);
  return [...new Set([...shared, ...privateDirs].filter(dir => typeof dir === 'string' && dir.trim())
    .map(dir=>path.resolve(folder.uri.fsPath,dir)))];
}

async function manage(context, folder, current) {
  if (!current()) return;
  const {t} = require('./installationDialogs');
  const dirs = searchDirectories(context, folder);
  const add = {label:t('添加含可执行文件的目录…','Add a directory containing executables…')};
  const choice = dirs.length ? await vscode.window.showQuickPick([add,...dirs.map(dir=>({
    label:t('移除搜索目录','Remove search directory'),description:dir,dir
  }))],{title:t('工具搜索目录','Tool search directories')}) : add;
  if (!choice || !current()) return;
  let dir = choice.dir;
  if (!dir) {
    const selected = await require('./fileDialogs').pickDirectory({defaultUri:folder.uri,
      title:t('选择含工具的目录（通常为 bin）','Select the tools directory (usually bin)')});
    if (!selected || !current()) return;
    dir = selected.fsPath;
    if (dirs.includes(dir)) return;
  }
  const settings = config(folder);
  const stored = settings.get('toolDirectories', []);
  const sharedEntry = stored.find(entry=>path.relative(path.resolve(folder.uri.fsPath,entry),dir)==='');
  const relative = relativeDirectory(folder.uri.fsPath,dir);
  if (sharedEntry !== undefined || (!choice.dir && relative !== undefined)) {
    const next = choice.dir ? stored.filter(entry=>entry!==sharedEntry) : [...stored,relative];
    await settings.update('toolDirectories',next,vscode.ConfigurationTarget.WorkspaceFolder);
  } else {
    const saved = context.workspaceState.get(key(folder),[]);
    await context.workspaceState.update(key(folder),choice.dir ? saved.filter(entry=>entry!==dir) : [...saved,dir]);
  }
}

module.exports = {searchDirectories, relativeDirectory, manage};
