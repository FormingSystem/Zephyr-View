'use strict';

const vscode = require('vscode');
const moveCommand = 'workbench.action.moveEditorToNewWindow';

/** Reuse the same custom document and editor group across auxiliary window activations. */
class ProgramStudioWindow {
  constructor(viewType) {
    this.viewType = viewType;
    this.origins = new Map();
    this.opening = new Map();
  }

  group(uri) {
    const key = uri.toString();
    const matches = vscode.window.tabGroups.all.filter(group => group.tabs.some(({input}) =>
      input instanceof vscode.TabInputCustom && input.viewType===this.viewType && input.uri.toString()===key));
    const origin = this.origins.get(key);
    return matches.find(group => group!==origin) || matches[0];
  }

  async show(uri) {
    const group = this.group(uri);
    const destination = group || vscode.window.tabGroups.activeTabGroup;
    if (!group) {
      this.origins.delete(uri.toString());
      // A new design opened inside the studio inherits its existing native window.
      const neighbor = destination?.tabs.filter(tab => tab.input instanceof vscode.TabInputCustom && tab.input.viewType===this.viewType)
        .map(tab => this.origins.get(tab.input.uri.toString()))
        .find(origin => origin && origin!==destination);
      if (neighbor) this.origins.set(uri.toString(),neighbor);
    }
    await vscode.commands.executeCommand('vscode.openWith',uri,this.viewType,
      {viewColumn:group?.viewColumn,preview:false,preserveFocus:false});
    return uri;
  }

  open(key,openDocument) {
    if (!this.opening.has(key)) {
      const operation = openDocument().then(uri => uri && this.detach(uri)).finally(() => this.opening.delete(key));
      this.opening.set(key,operation);
    }
    return this.opening.get(key);
  }

  isSelected(group,key) {
    const input = group?.activeTab?.input;
    return input instanceof vscode.TabInputCustom && input.viewType===this.viewType && input.uri.toString()===key;
  }

  forget(uri) { this.origins.delete(uri.toString()); }

  async detach(uri) {
    const group = this.group(uri), key = uri.toString();
    if (!group || !group.isActive || !this.isSelected(group,key)) return;
    if (this.origins.has(key) && this.origins.get(key)!==group) return;
    this.origins.set(key,group);
    try {
      if (!(await vscode.commands.getCommands(true)).includes(moveCommand)) throw Error('unavailable');
      // This workbench command acts on the focused tab, which may have changed while resolving commands.
      const active = vscode.window.tabGroups.activeTabGroup;
      if (active!==group || !this.isSelected(active,key)) {
        this.origins.delete(key);
        return;
      }
      await vscode.commands.executeCommand(moveCommand);
    } catch {
      this.origins.delete(key);
      void vscode.window.showInformationMessage(vscode.env.language.startsWith('zh') ?
        '当前 VS Code 无法创建独立窗口，编程工作室已在此窗口打开。' :
        'A separate editor window is unavailable. The programming studio is open in this window.');
    }
  }
}

module.exports = {ProgramStudioWindow};
