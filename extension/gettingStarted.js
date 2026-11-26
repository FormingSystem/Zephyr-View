'use strict';

const {commands, env, l10n, Uri, window, workspace} = require('vscode');
const {pickDirectory} = require('./fileDialogs');

function openGuide(extensionUri) {
  const name = env.language.toLowerCase().startsWith('zh') ? 'GETTING_STARTED.md' : 'GETTING_STARTED.en.md';
  return commands.executeCommand('markdown.showPreview', Uri.joinPath(extensionUri, name));
}

async function copyExamplesTo(extensionUri, folder) {
  const destination = Uri.joinPath(folder, 'zephyr-view-examples');
  await workspace.fs.copy(Uri.joinPath(extensionUri, 'examples'), destination, {overwrite: false});
  return destination;
}

async function copyTutorialExamples(extensionUri) {
  const folder = await pickDirectory({title: l10n.t('Choose a folder for the tutorial examples'),
    defaultUri: workspace.workspaceFolders?.[0]?.uri});
  if (!folder) return;
  let destination;
  try {
    destination = await copyExamplesTo(extensionUri, folder);
  } catch (error) {
    if (error.code !== 'FileExists') throw error;
    return window.showWarningMessage(l10n.t('This folder already contains zephyr-view-examples. Choose another folder to make a fresh copy.'));
  }
  const open = l10n.t('Open examples in a new window');
  if (await window.showInformationMessage(l10n.t('Tutorial examples copied to {0}.', destination.fsPath), open) === open) {
    await commands.executeCommand('vscode.openFolder', destination, true);
  }
}

module.exports = {openGuide, copyTutorialExamples, copyExamplesTo};
