'use strict';

const vscode = require('vscode');
const {randomUUID} = require('node:crypto');
const scheme = 'zephyr-program-preview';

/** Each diff owns two immutable snapshots, including the version the user actually reviewed. */
class program_source_preview {
  constructor(context) {
    this.contents = new Map();
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(scheme,this),
      vscode.window.tabGroups.onDidChangeTabs(event => this.release_closed(event.closed)));
  }

  provideTextDocumentContent(uri) {
    const content = this.contents.get(uri.toString());
    if (content === undefined) throw vscode.FileSystemError.FileNotFound(uri);
    return content;
  }

  release_closed(closed) {
    const open = vscode.window.tabGroups.all.flatMap(group => group.tabs);
    for (const {input} of closed) {
      if (!(input instanceof vscode.TabInputTextDiff) || input.modified.scheme !== scheme) continue;
      if (open.some(tab => tab.input instanceof vscode.TabInputTextDiff &&
          tab.input.modified.toString() === input.modified.toString())) continue;
      this.contents.delete(input.original.toString());
      this.contents.delete(input.modified.toString());
    }
  }

  async close_diff(right) {
    const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab =>
      tab.input instanceof vscode.TabInputTextDiff && tab.input.modified.toString() === right.toString());
    if (tabs.length) await vscode.window.tabGroups.close(tabs, true);
  }

  async show(original, proposed, title) {
    const id = randomUUID();
    const snapshot = (side, body) => {
      const uri = vscode.Uri.from({scheme, path:'/' + id + '/' + side + '/src/main.c'});
      this.contents.set(uri.toString(),body);
      return uri;
    };
    const left = snapshot('current',original);
    const right = snapshot('proposed',proposed);
    try {
      await vscode.commands.executeCommand('vscode.diff',left,right,title,{preview:false});
      return {close: () => this.close_diff(right)};
    } catch (error) {
      this.contents.delete(left.toString());
      this.contents.delete(right.toString());
      throw error;
    }
  }
}

module.exports = {program_source_preview};
