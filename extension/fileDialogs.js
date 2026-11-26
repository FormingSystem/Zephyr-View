'use strict';

const path = require('node:path');
const vscode = require('vscode');
const {path: displayPath} = require('./media/pathDisplay');
const {FileType, Uri, l10n, window, workspace} = vscode;

async function openOne(options, directory) {
  let {defaultUri}=options;
  while(defaultUri){
    const found=await workspace.fs.stat(defaultUri).catch(()=>undefined);
    if(found && (!directory || (found.type & FileType.Directory)))break;
    const parent=Uri.joinPath(defaultUri,'..');
    if(parent.toString()===defaultUri.toString()){defaultUri=undefined;break;}
    defaultUri=parent;
  }
  const result = await window.showOpenDialog({...options, defaultUri, canSelectFolders:directory,
    canSelectFiles:!directory, canSelectMany:false});
  return result?.[0];
}

const pickDirectory = options => openOne(options, true);
const pickFile = options => openOne(options, false);
const saveFileAs = options => window.showSaveDialog(options);

function resolveDirectory(base, input) {
  const value = input.trim();
  if (!value || value.includes('\0')) return;
  if (process.platform === 'win32' && /^[A-Za-z]:(?![\\/])/.test(value)) return;
  if (base.scheme === 'file') return Uri.file(path.resolve(base.fsPath, value));
  return value.startsWith('/') ? base.with({path:value}) : Uri.joinPath(base, value);
}

async function inputDirectory({baseUri, defaultUri, title, allowCreate = false}) {
  if (!baseUri) return;
  const value = await window.showInputBox({title,
    prompt:l10n.t('Enter an absolute path or a path relative to {0}.', displayPath(baseUri.fsPath)),
    value:defaultUri && baseUri.scheme === 'file' ? displayPath(path.relative(baseUri.fsPath, defaultUri.fsPath)) || '.' : '',
    validateInput:input => resolveDirectory(baseUri,input) ? undefined : l10n.t('Enter a directory path.')});
  if (!value) return;
  const uri = resolveDirectory(baseUri, value);
  try {
    if ((await workspace.fs.stat(uri)).type & FileType.Directory) return uri;
    throw Error(l10n.t('This path is a file. Choose a directory.'));
  } catch (error) {
    if (error.code !== 'FileNotFound') throw error;
    if (!allowCreate) throw Error(l10n.t('Directory not found: {0}',displayPath(uri.fsPath)));
  }
  const create = l10n.t('Create folder');
  if (await window.showInformationMessage(l10n.t('Create directory {0}?',displayPath(uri.fsPath)), {modal:true}, create) !== create) return;
  await workspace.fs.createDirectory(uri);
  return uri;
}

module.exports = {pickDirectory, pickFile, saveFileAs, inputDirectory, resolveDirectory};
