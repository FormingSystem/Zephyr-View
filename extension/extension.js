'use strict';

const vscode = require('vscode');
const {registerWorkbench} = require('./workbench');
const {pickDirectory} = require('./fileDialogs');
const {path: displayPath} = require('./media/pathDisplay');
const path = require('node:path');
const {debugRunner, hasCurrentBuild, hasFile, lastBuildFailure, looksLikeZephyr, readTarget, readText} = require('./target');
const {imageDomains} = require('./sysbuild');
const {selectedTarget, applyLastConfigureResult} = require('./buildSetup');
const {cacheStatus} = require('./buildVariables');
const {containingCheckout} = require('./checkout');
const {explicitSource} = require('./workspace');
const {Uri, TreeItem, ThemeIcon, l10n} = vscode;

function item(label, value, icon, command) {
  const row = new TreeItem(label);
  row.description = value;
  row.tooltip = value || label;
  row.iconPath = new ThemeIcon(icon);
  row.command = command;
  return row;
}

function link(label, uri) {
  return item(label, displayPath(vscode.workspace.asRelativePath(uri)), 'file', {
    command: 'vscode.open', title: label, arguments: [uri]
  });
}

function sessionFor(folder) {
  const session = vscode.debug.activeDebugSession;
  return session?.workspaceFolder?.uri.toString() === folder.uri.toString() ? session : undefined;
}

class DebugTarget {
  constructor(context) {
    this.context = context;
    this.changed = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.changed.event;
    this.manual = context.workspaceState.get('targetVisible', false);
    this.refreshNumber = 0;
    this.targetChanged = new vscode.EventEmitter();
    this.onDidRefreshTarget = this.targetChanged.event;
    this.selectedRoot = context.workspaceState.get('debug.workspaceFolder');
    this.followEditor(vscode.window.activeTextEditor);
    this.followFolder(vscode.debug.activeDebugSession?.workspaceFolder);
    context.subscriptions.push(this.changed, this.targetChanged);
  }

  folder() {
    const roots = vscode.workspace.workspaceFolders || [];
    return roots.find(folder => folder.uri.toString() === this.selectedRoot) || roots[0];
  }

  followFolder(folder) {
    if (folder && vscode.workspace.workspaceFolders?.some(root => root.uri.toString() === folder.uri.toString()))
      this.selectedRoot = folder.uri.toString();
  }

  followEditor(editor) {
    if (editor) this.followFolder(vscode.workspace.getWorkspaceFolder(editor.document.uri));
  }

  async chooseFolder() {
    const folder = await vscode.window.showWorkspaceFolderPick({placeHolder:l10n.t('Select workspace folder')});
    if (!folder) return;
    this.followFolder(folder);
    await this.context.workspaceState.update('debug.workspaceFolder',this.selectedRoot);
    await this.refresh();
  }

  async buildDir(folder, {debugImage = false} = {}) {
    const stored = this.context.workspaceState.get('build:' + folder.uri.toString());
    const selected = stored ? Uri.parse(stored) : Uri.joinPath(folder.uri, 'build');
    const executable = sessionFor(folder)?.configuration.executable;
    if (typeof executable === 'string' && folder.uri.scheme === 'file' &&
        path.isAbsolute(executable) && !executable.includes('${')) {
      const dir = Uri.joinPath(Uri.file(executable), '..');
      for (const candidate of [dir, Uri.joinPath(dir, '..')]) {
        if (!await hasFile(Uri.joinPath(candidate, 'CMakeCache.txt'))) continue;
        if (debugImage || !path.relative(selected.fsPath,candidate.fsPath)) return candidate;
        const domains = imageDomains(await readText(Uri.joinPath(selected,'domains.yaml')),selected.fsPath);
        // Debugging one CPU must keep the main workbench's build action on the selected system.
        return domains?.domains.some(image => !path.relative(image.dir,candidate.fsPath)) ? selected : candidate;
      }
    }
    return selected;
  }

  async refresh() {
    const generation = ++this.refreshNumber;
    const folders = vscode.workspace.workspaceFolders || [];
    const visible = this.manual || (await Promise.all(folders.map(f => looksLikeZephyr(f).catch(() => false)))).some(Boolean);
    if (generation !== this.refreshNumber) return;
    await vscode.commands.executeCommand('setContext', 'zephyrWorkbench.available', visible);
    this.changed.fire();
    this.targetChanged.fire();
  }

  showSelection(snapshot) {
    const selection = snapshot?.folder && {
      folder:snapshot.folder.uri.toString(), build:snapshot.build.toString(), app:snapshot.setup.app,
      board:snapshot.setup.board, projectBoard:snapshot.setup.projectBoard, boardFile:snapshot.devicetree.boardFile,
      source:snapshot.environment?.ZEPHYR_BASE || snapshot.checkout
    };
    if (JSON.stringify(selection) === JSON.stringify(this.selection)) return;
    this.selection = selection;
    this.changed.fire();
  }

  getTreeItem(row) { return row; }

  async sidebarSnapshot(folder,build,target,selection) {
    const locations = vscode.workspace.getConfiguration('zephyrWorkbench',folder.uri).get('locations');
    const application = typeof locations?.application === 'string' && locations.application.trim()
      ? path.resolve(folder.uri.fsPath,locations.application) : undefined;
    const source = selection?.source || explicitSource(folder,this.context) ||
      (folder.uri.scheme === 'file' && await containingCheckout(folder.uri.fsPath));
    const base = source ? path.resolve(folder.uri.fsPath,source) : undefined;
    const s = {folder,build,target,application:selection?.app || application,environment:{...process.env,ZEPHYR_BASE:base}};
    const inferred = selectedTarget(this.context,s);
    const {app,board,projectBoard} = selection || inferred;
    const status = inferred.sourceConflict ? 'conflict' : cacheStatus(target,app,board,build.fsPath);
    s.setup = {app,board,projectBoard,cacheStatus:status,readiness:{build:[]}};
    applyLastConfigureResult(s.setup,await lastBuildFailure(this.context,s));
    return s;
  }

  async getChildren(parent) {
    if (parent) return [];
    const folder = this.folder();
    if (!folder) return [item(l10n.t('Open a workspace folder'), '', 'folder-opened', {
      command: 'vscode.openFolder', title: l10n.t('Open a workspace folder')
    })];
    const build = await this.buildDir(folder,{debugImage:true});
    const target = await readTarget(folder, build);
    const selection = this.selection?.folder === folder.uri.toString() &&
      this.selection.build === build.toString() ? this.selection : undefined;
    const s = await this.sidebarSnapshot(folder,build,target,selection);
    const current = hasCurrentBuild(s), runner = debugRunner(s);
    const boardFile = selection ? selection.boardFile : current && target.devicetree.base?.fsPath;
    const app = Uri.file(s.setup.app);
    const session = sessionFor(folder);
    const choose = {command: 'zephyrWorkbench.chooseBuild', title: l10n.t('Select build directory')};
    const launch = {command: 'zephyrWorkbench.launch', title: l10n.t('Select launch configuration')};
    const config = Uri.joinPath(folder.uri, '.vscode', 'launch.json');
    const rows = [
      item(l10n.t('Application'), displayPath(vscode.workspace.asRelativePath(app)), 'project'),
      item(l10n.t('Board / CPU'), s.setup.board || l10n.t('Awaiting CMake configuration'), 'circuit-board'),
      item(l10n.t('Build directory'), displayPath(vscode.workspace.asRelativePath(build)), 'folder-opened', choose),
      item(l10n.t('Debug runner'), runner.name || runner.message, 'debug-alt',
        runner.file ? link('runners.yaml', target.runnersFile).command : undefined),
      item(l10n.t('Debug session'), session?.name || l10n.t('Idle'), 'debug', launch)
    ];
    if (boardFile) {
      const source = item(l10n.t('Board devicetree'), path.basename(boardFile), 'file-symlink-file',
        {command:'zephyrWorkbench.inspectDevicetree', title:l10n.t('Board devicetree')});
      source.tooltip = displayPath(boardFile);
      rows.splice(2,0,source);
    }
    if (vscode.workspace.workspaceFolders?.length > 1) {
      const root = item(l10n.t('Workspace folder'),folder.name,'root-folder',
        {command:'zephyrWorkbench.chooseWorkspaceFolder',title:l10n.t('Select workspace folder')});
      root.tooltip = displayPath(folder.uri.fsPath);
      rows.unshift(root);
    }
    for (const uri of current ? target.files : []) rows.push(link(uri.path.split('/').pop(), uri));
    if (current && target.cacheFile) rows.push(link('CMakeCache.txt', target.cacheFile));
    if (await hasFile(config)) rows.push(link('launch.json', config));
    const refresh = l10n.t('Refresh debug target');
    rows.push(item(refresh, '', 'refresh', {command:'zephyrWorkbench.refresh', title:refresh}));
    return rows;
  }

  async chooseBuild() {
    const folder = this.folder();
    if (!folder) return;
    const location=await pickDirectory({defaultUri:await this.buildDir(folder),title:l10n.t('Select build directory')});
    if (!location || this.folder()?.uri.toString() !== folder.uri.toString()) return;
    await this.context.workspaceState.update('build:' + folder.uri.toString(), location.toString());
    await this.refresh();
  }

  async launch() {
    const folder = this.folder();
    if (!folder) return;
    const configs = vscode.workspace.getConfiguration('launch', folder.uri).get('configurations', []);
    const picks = configs.filter(c => typeof c.name === 'string' && c.type && c.request).map(c => ({
      label:c.name, description:c.type + ' · ' + c.request
    }));
    if (!picks.length) {
      const label = l10n.t('Configure debugging');
      if (await vscode.window.showInformationMessage(l10n.t('This workspace has no launch configuration.'), label) === label)
        await vscode.commands.executeCommand('workbench.action.debug.configure');
      return;
    }
    const selected = await vscode.window.showQuickPick(picks, {placeHolder:l10n.t('Select launch configuration')});
    if (selected && this.folder()?.uri.toString() === folder.uri.toString())
      await vscode.debug.startDebugging(folder, selected.label);
  }
}

function activate(context) {
  const target = new DebugTarget(context);
  registerWorkbench(context, target);
  const register = (name, fn) => context.subscriptions.push(vscode.commands.registerCommand('zephyrWorkbench.' + name, fn));
  for (const view of ['zephyrWorkbench.projectTarget', 'zephyrWorkbench.target']) {
    context.subscriptions.push(vscode.window.registerTreeDataProvider(view, target));
  }
  register('refresh', () => target.refresh());
  register('chooseWorkspaceFolder', () => target.chooseFolder());
  register('chooseBuild', () => target.chooseBuild());
  register('launch', () => target.launch());
  register('probeSupport', runner => require('./probeSupport').probeSupport(context,target.folder(),runner));
  register('open', async () => {
    target.manual = true;
    await context.workspaceState.update('targetVisible', true);
    await target.refresh();
    await vscode.commands.executeCommand('zephyrWorkbench.target.focus');
  });
  const refresh = () => target.refresh();
  const changes = vscode.workspace.createFileSystemWatcher('**/{CMakeCache.txt,build_info.yml,domains.yaml,zephyr.dts,runners.yaml,prj.conf,launch.json}');
  context.subscriptions.push(changes, changes.onDidCreate(refresh), changes.onDidChange(refresh), changes.onDidDelete(refresh),
    vscode.workspace.onDidChangeWorkspaceFolders(refresh),
    vscode.window.onDidChangeActiveTextEditor(editor => { target.followEditor(editor); refresh(); }),
    vscode.debug.onDidChangeActiveDebugSession(session => { target.followFolder(session?.workspaceFolder); refresh(); }),
    vscode.debug.onDidStartDebugSession(refresh),
    vscode.debug.onDidTerminateDebugSession(refresh));
  void refresh();
  return {target};
}

module.exports = {activate};
