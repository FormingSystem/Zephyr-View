'use strict';

const vscode = require('vscode');
const {randomBytes} = require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const modules=require('./modules');
const environmentConfig=require('./environment');
const {environmentRows}=require('./environmentValues');
const {registrationScopes, candidates:registrationCandidates} = require('./environmentRegistration');
const {createManifestResolver}=require('./effectiveManifest');
const {clearToolchainDiscovery}=require('./toolchainDiscoveryCache');
const studio=require('./studio');
const {ThreadStudioHost} = require('./threadStudioHost');
const {appearance_settings} = require('./appearance_settings');
const {readDevicetreeCatalog}=require('./devicetreeCatalog');
const setup = require('./buildSetup');
const {FlashTasks} = require('./flashTasks');
const {ProbeSupport, probeProfiles, runnerProfile} = require('./probeSupport');
const {previewPlan} = require('./buildVariables');
const {pickDirectory,inputDirectory}=require('./fileDialogs');
const {path: displayPath} = require('./media/pathDisplay');
const {ConfigurationWindow} = require('./configurationWindow');
const {describeFiles, acknowledgeFileReset, prepareFileConfigure} = require('./configurationFiles');
const {choose_configuration_files, apply_file_readiness} = require('./configurationFilePicker');
const {inspectWorkspace, buildFiles} = require('./workspace');
const {targetChoiceReply} = require('./targetChoiceReply');
const {debugRunner, hasCurrentBuild, lastBuildFailure, taskScope} = require('./target');
const {Uri, l10n} = vscode;
const running = new Set();
const sections = {build:'Build',workspace:'Workspace',configuration:'Project configuration',modules:'Modules',threads:'Threads'};
function navigation() {
  function action(title, icon, command) {
    const row = new vscode.TreeItem(title);
    row.iconPath = new vscode.ThemeIcon(icon);
    row.command = {command, title};
    return row;
  }
  const actions = [
    action(l10n.t('Open workbench'), 'layout', 'zephyrWorkbench.show'),
    action(l10n.t('Visual program designer'), 'type-hierarchy', 'zephyrWorkbench.visualProgram'),
    action(l10n.t('Configure Kconfig'), 'settings-gear', 'zephyrWorkbench.kconfig'),
    action(l10n.t('Getting started'), 'book', 'zephyrWorkbench.gettingStarted')
  ];
  return {getTreeItem:row=>row,getChildren:parent=>parent?[]:actions};
}

function documentHtml(view, base, title) {
  const nonce = randomBytes(20).toString('hex');
  const asset = name => view.asWebviewUri(Uri.joinPath(base, name));
  const shared='design/';
  const template=fs.readFileSync(Uri.joinPath(base,shared,'index.html').fsPath,'utf8');
  const policy=`default-src 'none'; img-src ${view.cspSource}; style-src ${view.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src https://api.github.com https://gitee.com`;
  const scripts=['fuzzy.js','pathDisplay.js','vendor/js-yaml/js-yaml.min.js','appearance.js','build-context.js','configuration-inputs.js','build-panel.js','toolchain-controls.js','configuration-tree.js','configuration-workspace.js','module-identification.js','module-pagination.js','module-lists.js','module-sources.js','probe-list.js']
    .map(name=>shared+name).concat(['nativeModules.js','kconfigFields.js','fragmentFields.js','deviceTreeDraft.js','studioMap.js','studioView.js','discoveryDiagnostics.js','probeControls.js','setupViews.js','targetPicker.js','buildControls.js','flashPlan.js','flashPanel.js','build_page.js','threadStudio/model.js','threadStudio/ui.js','threadStudio/draftView.js','threadStudio/evidenceView.js','threadStudio/studio.js','workbench.js']);
  return template.replace('lang="zh-CN"', `lang="${vscode.env.language.startsWith('zh')?'zh-CN':'en'}" data-path-platform="${process.platform}"`).replace('<title>',`<meta http-equiv="Content-Security-Policy" content="${policy}"><title>`)
    .replace('href="marketplace-icon.png"',`href="${asset('marketplace-icon.png')}"`)
    .replace('href="appearance.css"',`href="${asset(shared+'appearance.css')}"`)
    .replace('href="workbench.css"',`href="${asset(shared+'workbench.css')}"`)
    .replace('href="module-lists.css"',`href="${asset(shared+'module-lists.css')}"`)
    .replace('href="build-panel.css"',`href="${asset(shared+'build-panel.css')}"`)
    .replace('href="configuration-map-navigation.css"',`href="${asset(shared+'configuration-map-navigation.css')}"`)
    .replace('href="configuration-workspace.css"',`href="${asset(shared+'configuration-workspace.css')}"`)
    
    .replace('<body>',`<link rel="stylesheet" href="${asset('workbench.css')}"><link rel="stylesheet" href="${asset('threadStudio/studio.css')}"><body>`)
    .replace(/<title>[^<]*<\/title>/,'<title>'+title+'</title>')
    .replace('交互设计稿 · 示例数据',title)
    .replace(/<script src=[\s\S]+?<\/body>/,scripts.map(name=>`<script nonce="${nonce}" src="${asset(name)}"></script>`).join('')+'</body>');
}

async function devicetreeReferences(context, s) {
  const tree = hasCurrentBuild(s) && s.target.devicetree;
  if (tree?.sourcesKnown) {
    return {boardSource: 'configured', boardFile: tree.base.fsPath,
      overlays: tree.overlays.map(file => file.fsPath), generatedFile: tree.merged?.fsPath};
  }
  if (!s.folder || !s.setup.board) return {detectionStatus: 'selectBoard'};
  if (!vscode.workspace.isTrusted) return {detectionStatus: 'unavailable'};
  const detected = await require('./boardCatalog').detectBoardDts(s, setup.taskEnvironment(context, s), undefined, true);
  return {...detected, generatedFile: tree?.merged?.fsPath};
}

async function openDiscoveryIssue(filename) {
  let location = filename;
  for (;;) {
    try {
      const file = await fs.promises.stat(location);
      const command = file.isFile() ? 'vscode.open' : 'revealFileInOS';
      return vscode.commands.executeCommand(command, Uri.file(location));
    } catch (error) {
      if (!['ENOENT','ENOTDIR'].includes(error.code)) throw error;
      const parent = path.dirname(location);
      if (parent === location) return;
      location = parent;
    }
  }
}

function registerWorkbench(context, provider) {
  const flash = new FlashTasks(context,running);
  let flashScope;
  const title = context.extension.packageJSON.displayName;
  const base = Uri.joinPath(context.extensionUri, 'media');
  const appearance = new appearance_settings(vscode.workspace, vscode.ConfigurationTarget.Global);
  const send_appearance = () => panel?.webview.postMessage({appearanceSettings: appearance.read()});
  const discovery = require('./workspaceLocations').createDiscovery();
  const manifests = createManifestResolver();
  const probes = new ProbeSupport(context, update => {
    if (page === 'workspace' && update.folder === provider.folder()?.uri.fsPath) {
      return panel?.webview.postMessage({probeList: update});
    }
  });
  function resetDiscovery(folder) {
    probes.reset();
    manifests.clear();
    discovery.reset(folder);
    modules.clearStatusCache();
    clearToolchainDiscovery();
  }
  const resultFiles=new Map();
  const studioFiles=new Map();
  const pendingWrites = new Set();
  const studio_scope = s => JSON.stringify([s?.folder?.uri.fsPath, s?.setup?.app, s?.setup?.board, s?.build?.fsPath]);
  function openedInputs(s){
    const scope=studio_scope(s);
    if(!studioFiles.has(scope))studioFiles.set(scope,new Map());
    return studioFiles.get(scope);
  }
  const resultChanges=new vscode.EventEmitter();
  context.subscriptions.push(resultChanges,vscode.workspace.registerTextDocumentContentProvider('zephyr-build-result',{
    onDidChange:resultChanges.event,
    provideTextDocumentContent:async uri=>{
      const file=resultFiles.get(uri.toString());
      return file?Buffer.from(await vscode.workspace.fs.readFile(file)).toString('utf8'):'';
    }
  }));
  function openBuildReference(file) {
    const result = file.with({scheme:'zephyr-build-result', query:file.scheme});
    resultFiles.set(result.toString(), file);
    resultChanges.fire(result);
    return vscode.commands.executeCommand('vscode.open', result);
  }
  let panel, ready = false, page = 'workspace', snapshot, generation = 0;
  const threadHost = new ThreadStudioHost(
    patch => panel?.webview.postMessage({threadPatch:patch,threadScope:threadHost.scope}),
    scope => page === 'threads' && panel && snapshot && studio_scope(snapshot) === scope &&
      snapshot.folder?.uri.toString() === provider.folder()?.uri.toString());
  context.subscriptions.push(threadHost);
  let requestedInspector;
  let requestedProbes;
  const configurationWindow = new ConfigurationWindow();
  const execute = (...args) => vscode.commands.executeCommand(...args);
  const activateConfigurationWindow = () => panel && configurationWindow.activate(panel,vscode.window.tabGroups,execute);
  const storedMethod = folder => 'workbench.method:' + (folder?.uri.toString() || '');
  const method = s => context.workspaceState.get(storedMethod(s.folder), s.manifest.root ? 'west' : 'CMake');

  let moduleQueue=Promise.resolve();
  async function refresh() {
    if (!panel || !ready) return;
    const version = ++generation;
    const s = await inspectWorkspace(provider,context,discovery);
    if (version !== generation) return;
    Object.assign(s,environmentConfig.resolve(context,s));
    if (s.folder) {
      const west = vscode.workspace.isTrusted ? s.tools.west : undefined;
      s.manifest = await manifests.resolve(s.manifest, west, setup.taskEnvironment(context,s));
    }
    if (version !== generation) return;
    await discovery.apply(context,s);
    if (version !== generation) return;
    s.setup = await setup.describe(context,s,method(s));
    s.lastFailure=await lastBuildFailure(context,s);
    setup.applyLastConfigureResult(s.setup,s.lastFailure);
    if (version !== generation) return;
    s.devicetree = await devicetreeReferences(context, s);
    if (version !== generation) return;
    if (s.folder && vscode.workspace.isTrusted && ['build','configuration'].includes(page)) {
      s.configurationFiles = await describeFiles(context, s, setup.taskEnvironment(context, s));
      apply_file_readiness(s.setup,s.configurationFiles);
    }
    s.files = page==='build' ? await buildFiles(s) : [];
    s.flashLoaded = page==='build' && flashScope===studio_scope(s);
    if (s.flashLoaded) s.flash=await flash.describe(s);
    if(page==='build' && s.folder)s.buildVariables=await setup.variables(context,s,method(s));
    if(page==='configuration'&&s.folder)s.inputs=await studio.inputs(s,[...openedInputs(s).values()]);
    let symbols, selectedModules, graphProjects;
    if (s.inputs) {
      const env = setup.taskEnvironment(context,s);
      [symbols, s.devicetree.catalog] = await Promise.all([studio.symbols(s, env), readDevicetreeCatalog(s, env)]);
      const record = modules.selectedState(context,s,method(s));
      selectedModules = record.selected;
      graphProjects = modules.entries(s,record);
    }
    const moduleRows = page==='modules' && s.folder ? await modules.rows(context,s,method(s)) : undefined;
    const variants=page==='workspace'?await environmentConfig.variants(s):[];
    if (version !== generation || !panel) return;
    snapshot = s;
    provider.showSelection(s);
    const show_toolchain = page === 'workspace' || page === 'build';
    const variables = show_toolchain ? environmentRows(s,s.folder ? setup.taskEnvironment(context,s) : s.environment) : [];
    const compilerChoices = page === 'build' && s.folder && vscode.workspace.isTrusted
      ? await environmentConfig.compiler_choices(context,s) : undefined;
    if (version !== generation || !panel) return;
    s.compilerChoices = compilerChoices;
    const transfer = page === 'configuration' && configurationWindow.forTarget(panel,studio_scope(s));
    const currentSystem = s.setup.cacheStatus === 'current' ? s.target?.system : undefined;
    s.discoveryIssues = [...(s.manifest.diagnostics || []), ...(s.locations?.diagnostics || [])];
    const probeRequest = page === 'workspace' ? requestedProbes : undefined;
    const threadScope = page === 'threads' ? studio_scope(s) : undefined;
    const threadState = threadScope ? threadHost.enter(s,threadScope) : undefined;
    if (!threadScope) threadHost.leave();
    const delivered = await panel.webview.postMessage({page,threadScope,threadState,studioDetached:configurationWindow.detached,studioPresentation:configurationWindow.presentation,studioRestore:transfer?.state,inspector:requestedInspector,version,language:vscode.env.language,method:method(s),
      folder:s.folder?.uri.fsPath, app:s.setup.app, board:s.setup.board, projectBoard:s.setup.projectBoard, build:s.build?.fsPath,
      system:s.setup.system,defaultImage:currentSystem?.main?.name,images:currentSystem?.domains?.map(image=>image.name),
      plan:previewPlan(s.setup.plan), parallelism:s.setup.parallelism, argsText:s.setup.argsText,error:s.setup.error, conflict:s.setup.conflict, canConfigure:s.setup.canConfigure, canBuild:s.setup.canBuild,
      buildVariables:s.buildVariables,devicetree:s.devicetree,configurationFiles:s.configurationFiles,
      readiness:s.setup.readiness,missingModules:s.setup.missingModules||[],lastFailure:s.lastFailure,
      busy:running.has(s.build?.toString()),flash:s.flash,flashLoaded:s.flashLoaded,
      hostPrograms:environmentConfig.programs,
      probeProfiles:page === 'workspace' ? probeProfiles() : undefined, openProbes:probeRequest,
      detected:s.locations && {groups:s.locations.groups,origins:s.locations.origins,conflicts:s.locations.conflicts,hidden:s.locations.hidden},
      discoveryIssues:s.discoveryIssues,
      runner:debugRunner(s), configured:Boolean(s.target?.cacheFile) && s.setup.cacheStatus !== 'conflict', tools:s.tools, environmentRows:variables,
      compilerChoices, extraRoots:require('./boardRoots').board_roots(s.saved.BOARD_ROOT),
      environmentRegistration:registrationScopes().length > 0 && registrationCandidates(variables).length > 0,
      environmentCacheStatus:s.setup.cacheStatus,overrides:Object.keys(s.saved),inputs:s.inputs||[],symbols,selectedModules,includedInputs:s.setup.includedFragments||[],
      root:s.manifest.root?.fsPath, manifest:s.manifest.uri?.fsPath, invalid:s.manifest.invalid, manifestScope:s.manifest.scope,
      variants,moduleScope:s.folder?modules.scope(s,method(s)):null,moduleRows,projects:graphProjects||s.manifest.projects, files:s.files.map(f=>f.fsPath), trusted:vscode.workspace.isTrusted});
    if (delivered && transfer) configurationWindow.delivered(transfer);
    if (delivered && probeRequest === requestedProbes) requestedProbes = undefined;
    if (version === generation) requestedInspector = undefined;
  }

  async function runTask(action, s) {
    if (!vscode.workspace.isTrusted || !s.folder) return;
    const listing=action==='list';
    const key=s.build.toString();
    if(!listing && running.has(key)) return;
    const plan=s.setup.plan;
    const executable=listing?s.tools.west:plan.executable;
    if(!executable || (listing&&!s.manifest.root))return;
    if(!listing && !(action==='configure'?s.setup.canConfigure:s.setup.canBuild))return;
    const args=listing?['list']:[...(action==='configure'?plan.configure:plan.build)];
    if (action === 'menuconfig' || action === 'guiconfig') args.push(method(s) === 'west' ? '-t' : '--target', action);
    const env=setup.taskEnvironment(context,s);
    if(s.setup.system && Number.isInteger(s.setup.parallelism?.jobs)) env.CMAKE_BUILD_PARALLEL_LEVEL=String(s.setup.parallelism.jobs);
    const exec=new vscode.ProcessExecution(executable,args,{cwd:(s.manifest.root||s.folder.uri).fsPath,env});
    const name=['Zephyr',method(s),action,path.basename(s.setup.app)].join(' · ');
    const task=new vscode.Task({type:'zephyrWorkbench',action,buildKey:key,method:method(s),targetScope:taskScope(s),
      overlayDiscovery:action==='configure'?s.setup.overlayDiscovery:undefined,
      fileReset:action==='configure'?s.setup.fileReset:undefined},s.folder,name,'Zephyr',exec);
    task.presentationOptions={reveal:vscode.TaskRevealKind.Always,panel:vscode.TaskPanelKind.Dedicated};
    if(!listing) running.add(key);
    let restore;
    try {
      if(action==='configure')restore=await prepareFileConfigure(s);
      await vscode.tasks.executeTask(task);
    } catch(error) {
      if(!listing)running.delete(key);
      if(restore)await restore();
      throw error;
    }
    await refresh();
  }

  async function save_studio_input(s, message) {
    if (page !== 'configuration' || !s.folder || !s.inputs) return;
    const view = panel;
    const scope = studio_scope(s);
    const still_current = () => view === panel && page === 'configuration' &&
      scope === studio_scope(snapshot) && provider.folder()?.uri.toString() === s.folder.uri.toString() &&
      vscode.workspace.isTrusted;
    if (!still_current()) return;
    const draft = message.id;
    if (message.action === 'studioSaveAs') {
      const location = await studio.save_copy(s, draft, still_current);
      if (location) void vscode.window.showInformationMessage(l10n.t('Draft copy saved to {0}', displayPath(location)));
      return;
    }
    if (pendingWrites.has(draft?.file)) return;
    pendingWrites.add(draft?.file);
    try {
      await studio.save(s, draft, still_current);
      await setup.remember_new_overlay(context,s,s.inputs.find(input=>input.file===draft.file));
      const input = openedInputs(s).get(draft.file);
      if (input) input.creating = false;
      if (view === panel) await view.webview.postMessage({savedScope:scope,savedFile:draft.file,savedBase:draft.base,savedText:draft.text});
    } finally {
      pendingWrites.delete(draft?.file);
      await safeRefresh();
    }
  }

  async function message(m) {
    if (m?.action === 'appearance') {
      try { await appearance.update(m.changes); }
      finally { await send_appearance(); }
      return;
    }
    if(m?.action==='module' && panel){
      const view=panel,s=snapshot,currentMethod=s&&method(s);
      const run=async()=>{
        if(!s?.folder||m.scope!==modules.scope(s,currentMethod)||s.folder.uri.toString()!==provider.folder()?.uri.toString()||!snapshot?.folder||m.scope!==modules.scope(snapshot,method(snapshot)))throw Error('当前工程已切换。');
        return modules.operate(context,s,currentMethod,m);
      };
      const result=moduleQueue.then(run);moduleQueue=result.catch(()=>{});
      try{const value=await result;await view.webview.postMessage({reply:m.request,value});}
      catch(e){await view.webview.postMessage({reply:m.request,error:e.message});}
      if (m.op==='apply') resetDiscovery(s.folder);
      if(['apply','select','add'].includes(m.op))await refresh();
      return;
    }
    if (m?.action === 'ready') {
      ready = true;
      await send_appearance();
      configurationWindow.ready(panel);
      await activateConfigurationWindow();
      return refresh();
    }
    if (m?.action === 'page' && Object.hasOwn(sections,m.id)) {requestedInspector=undefined;requestedProbes=undefined;page=m.id;return refresh();}
    if (m?.action === 'refresh') {resetDiscovery(provider.folder());return refresh();}
    const s = snapshot;
    if (m.action === 'visualProgram' && page === 'threads') return execute('zephyrWorkbench.visualProgram');
    if (m.action === 'threadStudio') {
      if (page === 'threads' && m.scope === threadHost.scope && m.input && typeof m.input === 'object')
        return threadHost.handle(m.input);
      return;
    }
    if (m.action === 'studioCheckpoint' && page === 'configuration' && s) {
      configurationWindow.remember(panel,studio_scope(s),m.id);
      return;
    }
    if (page === 'configuration' && panel?.active) {
      if (m.action === 'studioWindowFullscreen') return vscode.commands.executeCommand('workbench.action.toggleFullScreen');
      if (['detach','attach','studioPresentation'].includes(m.action)) {
        if (!s || m.id?.studioMapView?.scope !== studio_scope(s)) return;
        await configurationWindow.move({detach:m.action !== 'attach',presentation:m.action === 'studioPresentation',
          panel,groups:vscode.window.tabGroups,scope:studio_scope(s),state:m.id,execute});
        await activateConfigurationWindow();
        return refresh();
      }
    }
    if (!s || m?.version !== generation) {
      if (['studioSave', 'studioSaveAs'].includes(m?.action))
        void vscode.window.showInformationMessage(l10n.t('The target is refreshing. Review the current draft and save again.'));
      return;
    }
    if(m.action==='manageTrust')return vscode.commands.executeCommand('workbench.trust.manage');
    if (m.action === 'probeList' || m.action === 'probeAction') {
      const owner = panel;
      const current = () => owner === panel && page === 'workspace' && s.folder?.uri.toString() === provider.folder()?.uri.toString();
      if (!current()) return;
      if (m.action === 'probeList') return probes.list(s);
      return probes.act(s, m.id, () => current() && vscode.workspace.isTrusted && !running.has(s.build?.toString()));
    }
    if(m.action==='showTerminal'){
      const name=s.lastFailure?.terminalName;
      const terminal=name && vscode.window.terminals.find(t=>t.name.includes(name));
      if(terminal)return terminal.show();
      return vscode.commands.executeCommand('workbench.action.terminal.focus');
    }
    if (m.action==='locations' && s.locations && vscode.workspace.isTrusted && s.folder.uri.toString()===provider.folder()?.uri.toString()){
      if(m.id==='save') {
        if(!await discovery.save(s))return;
        void vscode.window.showInformationMessage(l10n.t('Detected locations saved to this workspace.'));
      }
      else if(m.id==='dismiss') discovery.dismiss(s);
      else {
        const group=s.locations.groups.find(g=>g.key===m.id?.key);
        if(!group||!group.options.some(o=>o.path===m.id?.value))return;
        discovery.choose(s.folder,group.key,m.id.value);
      }
      return refresh();
    }
    if (m.action === 'devicetreeFile') {
      const {boardFile, overlays = [], generatedFile} = s.devicetree;
      if (typeof m.id === 'string' && [boardFile, ...overlays, generatedFile].includes(m.id)) {
        return openBuildReference(Uri.file(m.id));
      }
      return;
    }
    if (m.action === 'viewConfigurationInput') {
      const known = Object.values(s.configurationFiles || {}).some(group =>
        (group.files.includes(m.id) || group.confirmedFiles?.includes(m.id)) && !group.missing.includes(m.id));
      if (known) return openBuildReference(Uri.file(m.id));
      return;
    }
    if (m.action === 'chooseConfigurationInput' && s.configurationFiles) {
      const owner = panel, origin = page, scope = studio_scope(s);
      const current = () => owner === panel && origin === page && scope === studio_scope(snapshot) &&
        provider.folder()?.uri.toString() === s.folder.uri.toString() && vscode.workspace.isTrusted && !running.has(s.build.toString());
      if (await choose_configuration_files(context, s, m.id, current)) await refresh();
      return;
    }
    if (m.action==='file' && Number.isInteger(m.id) && s.files[m.id]) {
      const file=s.files[m.id];
      if(file.path.endsWith('/zephyr/zephyr.elf'))return vscode.commands.executeCommand('revealInExplorer',file);
      const image=s.target.buildDir || s.build;
      const generated=['.config','zephyr.dts'].some(name=>Uri.joinPath(image,'zephyr',name).toString()===file.toString());
      if (generated || file.fsPath === s.devicetree.boardFile || s.devicetree.overlays?.includes(file.fsPath)) return openBuildReference(file);
      return vscode.commands.executeCommand('vscode.open',file);
    }
    if (m.action==='manifest' && s.manifest.uri) return vscode.commands.executeCommand('vscode.open',s.manifest.uri);
    if (m.action==='westConfig' && s.manifest.config) return vscode.commands.executeCommand('vscode.open',s.manifest.config);
    if (m.action==='folder') {
      const {inputDirectory,pickDirectory}=require('./fileDialogs');
      const options={title:l10n.t('Open workspace folder'),defaultUri:s.folder?.uri,baseUri:s.folder?.uri};
      const uri=m.id==='typed' ? await inputDirectory(options) : await pickDirectory({title:options.title,defaultUri:options.defaultUri});
      if(uri)return vscode.commands.executeCommand('vscode.openFolder',uri);
      return;
    }
    if (m.action==='launch') return provider.launch();
    if(m.action==='studioOpen'||m.action==='studioNew'){
      if(page!=='configuration'||!s.folder)return;
      const view=panel;
      const input=await studio.pickInput(s,m.id,m.action==='studioNew');
      if(!input||view!==panel||page!=='configuration'||studio_scope(snapshot)!==studio_scope(s)||
        provider.folder()?.uri.toString()!==s.folder.uri.toString())return;
      openedInputs(s).set(input.file,input);
      await view.webview.postMessage({studioPicked:input,studioScope:studio_scope(s)});
      return refresh();
    }
    if(m.action==='studioDiscardNew'&&s.folder){
      if(openedInputs(s).get(m.id)?.creating)openedInputs(s).delete(m.id);
      return refresh();
    }
    if (m.action === 'studioInclude' && page === 'configuration' && s.folder && s.inputs) {
      const scope = studio_scope(s);
      const current = () => page === 'configuration' && scope === studio_scope(snapshot) &&
        provider.folder()?.uri.toString() === s.folder.uri.toString() && vscode.workspace.isTrusted;
      if (!current()) return;
      const added = await setup.includeFragment(context,s,m.id,current);
      if (added) void vscode.window.showInformationMessage(l10n.t('Fragment added to this target. Configure again to apply it.'));
      return refresh();
    }
    if (m.action === 'studioSaveAs' || m.action === 'studioSave') return save_studio_input(s, m);
    const same_folder = () => Boolean(s.folder && s.folder.uri.toString() === provider.folder()?.uri.toString());
    if (['westOpen','westInit','westRepair'].includes(m.action) && page === 'workspace') {
      const actions = require('./westWorkspaceActions');
      const owner = panel;
      const current = () => owner === panel && page === 'workspace' &&
        provider.folder()?.uri.toString() === s.folder?.uri.toString() &&
        (m.action === 'westOpen' || vscode.workspace.isTrusted);
      if (!current()) return;
      if (m.action === 'westRepair') {
        await actions.repair(s,current);
        if (current()) {resetDiscovery(s.folder);return refresh();}
        return;
      }
      const root = m.action === 'westOpen' ? await actions.openExisting(s,m.id === 'typed',current) :
        await actions.initialize(s,current);
      if (root && current()) {
        if (!s.folder || path.relative(root,s.folder.uri.fsPath)) return vscode.commands.executeCommand('vscode.openFolder',Uri.file(root));
        resetDiscovery(s.folder);
        return refresh();
      }
      return;
    }
    if (m.action === 'openDiscoveryFile' && same_folder() && vscode.workspace.isTrusted) {
      const issues = [...(s.discoveryIssues || []), ...(s.boardIssues || [])];
      if (typeof m.id !== 'string' || !path.isAbsolute(m.id) || !issues.some(issue => issue.path === m.id)) return;
      return openDiscoveryIssue(m.id);
    }
    if (m.action === 'registerEnvironment' && registrationScopes().length > 0) {
      const current = () => page==='workspace' && m.version===generation && same_folder() && vscode.workspace.isTrusted;
      if (current()) await require('./registerEnvironment').registerEnvironment(environmentRows(s,setup.taskEnvironment(context,s)),current);
      return;
    }
    if (['flashLoad','flashAction'].includes(m.action)) {
      const current=()=>page==='build' && same_folder() && vscode.workspace.isTrusted && generation===m.version && snapshot===s;
      if (!current()) return;
      if (m.action==='flashLoad') {flashScope=studio_scope(s);return refresh();}
      return flash.act(s,m.id,current,safeRefresh,value=>panel?.webview.postMessage(value));
    }
    if (m.action === 'acquireSource') {
      const current = () => same_folder() && vscode.workspace.isTrusted && !running.has(s.build?.toString());
      const source = await require('./sourceSetup').acquireSource(s,method(s),current);
      if (source && current()) await environmentConfig.useInstalled(context,s.folder,{ZEPHYR_BASE:source});
      resetDiscovery(s.folder);
      return refresh();
    }
    if (m.action === 'toolDirectories') {
      await require('./toolDirectories').manage(context,s.folder,() => same_folder() && vscode.workspace.isTrusted);
      return refresh();
    }
    if (m.action === 'componentSource') return require('./componentInstall').source(m.id);
    if (m.action === 'installMissing') {
      const selectedMethod=method(s),owner=panel;
      const current=()=>owner===panel && page==='workspace' && same_folder() && method(s)===selectedMethod &&
        vscode.workspace.isTrusted && !running.has(s.build?.toString());
      if(!current())return;
      const recheck=async()=>{
        if(!current())return;
        resetDiscovery(s.folder);
        await refresh();
        if(current() && snapshot?.folder?.uri.toString()===s.folder.uri.toString())return snapshot;
      };
      await require('./guidedSetup').installMissing(context,s,selectedMethod,recheck,current);
      return refresh();
    }
    if (m.action === 'installComponent') {
      await require('./componentInstall').install(context,s,m.id,() => same_folder() && vscode.workspace.isTrusted && !running.has(s.build?.toString()));
      resetDiscovery(provider.folder());
      return refresh();
    }
    if (['compiler','compilerBrowse','compilerPrefix'].includes(m.action)) {
      const current_target = () => page === 'build' && same_folder() && vscode.workspace.isTrusted &&
        snapshot?.compilerChoices?.scope === m.scope && !running.has(s.build?.toString());
      if (!s.compilerChoices || s.compilerChoices.scope !== m.scope || !current_target()) return;
      if (m.action === 'compiler') await environmentConfig.select_compiler(context,s,m.id,m.scope,current_target);
      else await environmentConfig.choose_external_compiler(context,s,m.scope,m.action === 'compilerPrefix',current_target);
      return refresh();
    }
    if (m.action === 'boardRootRemove' && typeof m.id === 'string') {
      await environmentConfig.change_board_roots(context,s,{remove:m.id},same_folder);
      return refresh();
    }
    if(m.action==='environment'||m.action==='inherit'){
      if (!same_folder()) return;
      await environmentConfig.configure(context,s,m.id?.name||m.id,m.action==='inherit',m.id?.value,m.id?.typed,same_folder);
      return refresh();
    }
    if(m.action==='arguments' && s.folder){await setup.saveArguments(context,s,m.id);return refresh();}
    if (m.action === 'parallelJobs' && page === 'build' && same_folder() && vscode.workspace.isTrusted && !running.has(s.build?.toString())) {
      await setup.save_parallelism(context,s,m.id);
      return refresh();
    }
    if (m.action==='sysbuild' && page==='build' && same_folder() && vscode.workspace.isTrusted && !running.has(s.build?.toString())) {
      await setup.saveSystem(context,s,m.id);
      return refresh();
    }
    if(['targetList','targetSelect','targetBrowse','targetBoard'].includes(m.action)){
      const kind=m.id?.kind;
      if(!s.folder||!vscode.workspace.isTrusted||!['app','board','build'].includes(kind))return;
      if(m.action==='targetList'){
        const load = async () => kind === 'board' ? setup.boardChoicesResult(context,s,method(s)) :
          {items:await setup.choices(context,s,method(s),kind)};
        const reply = await targetChoiceReply(s,m.id,load,()=>snapshot===s && same_folder());
        if (reply) return panel?.webview.postMessage(reply);
        return;
      }
      let value=m.id.value;
      if(m.action==='targetBoard'){
        if(kind!=='board' || (value!==null && (typeof value!=='string' || !value.trim() || /[\x00-\x1f]/.test(value))))return;
      }else if(m.action==='targetBrowse'){
        if(kind==='board')return;
        const application=kind==='app';
        const defaultUri=application?Uri.file(s.setup.app):s.build;
        const title=application?l10n.t('Browse for application…'):l10n.t('Select build directory');
        const uri=m.id.typed===true
          ?await inputDirectory({baseUri:s.folder.uri,defaultUri,title,allowCreate:!application})
          :await pickDirectory({defaultUri,title});
        value=uri?.fsPath;
        if(!value)return;
      }else if(!s.choices?.[kind]?.includes(value))return;
      if(snapshot!==s||s.folder.uri.toString()!==provider.folder()?.uri.toString()||running.has(s.build.toString()))return;
      await setup.applyChoice(context,s,kind,value);
      return provider.refresh();
    }
    if (m.action==='method' && ['CMake','west'].includes(m.id)) {
      await context.workspaceState.update(storedMethod(s.folder),m.id);
      return refresh();
    }
    if (['configure','build','menuconfig','guiconfig','list'].includes(m.action)) return runTask(m.action,s);
  }

  function open(id) {
    if (Object.hasOwn(sections,id)) page=id;
    if (panel) {
      const alreadyVisible = panel.visible;
      panel.reveal(panel.viewColumn);
      if (alreadyVisible) return safeRefresh();
      return;
    }
    panel=vscode.window.createWebviewPanel('zephyrWorkbench.home',title,vscode.ViewColumn.Active,
      {enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[base]});
    panel.iconPath=Uri.joinPath(base,'marketplace-icon.png');
    let wasVisible = panel.visible;
    panel.onDidChangeViewState(async ({webviewPanel}) => {
      const revealed = webviewPanel.visible && !wasVisible;
      wasVisible = webviewPanel.visible;
      try { if ((await activateConfigurationWindow()) || revealed) await safeRefresh(); }
      catch (error) { report(error); }
    });
    panel.onDidDispose(()=>{
      threadHost.leave();
      if (!configurationWindow.close()) studioFiles.clear();
      probes.reset();requestedProbes=undefined;
      provider.showSelection(undefined);panel=undefined;ready=false;snapshot=undefined;++generation;
    });
    panel.webview.onDidReceiveMessage(m=>message(m).catch(report));
    panel.webview.html=documentHtml(panel.webview,base,title);
  }
  function report(e) {void vscode.window.showErrorMessage(title+' · '+e.message);}
  function safeRefresh() {return refresh().catch(report);}
  const view=vscode.window.createTreeView('zephyrWorkbench.navigation',{treeDataProvider:navigation()});
  context.subscriptions.push(view,view.onDidChangeVisibility(e=>{if(e.visible) open();}),
    vscode.commands.registerCommand('zephyrWorkbench.show',open),
    vscode.commands.registerCommand('zephyrWorkbench.threads', () => open('threads')),
    vscode.commands.registerCommand('zephyrWorkbench.probeSupport', runner => {
      requestedProbes = {id:runnerProfile(runner)};
      return open('workspace');
    }),
    vscode.commands.registerCommand('zephyrWorkbench.kconfig', () => {requestedInspector='kconfig';open('configuration');}),
    vscode.commands.registerCommand('zephyrWorkbench.inspectDevicetree', () => {requestedInspector='device';open('configuration');}),
    provider.onDidRefreshTarget(rescan => {
      if (rescan === true) resetDiscovery(provider.folder());
      return safeRefresh();
    }),
    {dispose:()=>panel?.dispose()});
  context.subscriptions.push(vscode.tasks.onDidEndTaskProcess(async event=>{
    const task=event.execution.task.definition;
    if (task.type !== 'zephyrWorkbench' || event.exitCode === undefined) return;
    if ((task.action === 'menuconfig' || task.action === 'guiconfig') && event.exitCode !== 0) {
      const message = task.action === 'guiconfig' ?
        l10n.t('guiconfig exited with code {0}. Check the task output. The build Python needs Tk and a graphical display.', event.exitCode) :
        l10n.t('menuconfig exited with code {0}. Check the task output. The build Python needs curses and an interactive terminal.', event.exitCode);
      void vscode.window.showErrorMessage(message);
    }
    if (!['configure','build'].includes(task.action)) return;
    if(!task.targetScope)return;
    if (event.exitCode === 0 && task.overlayDiscovery) await context.workspaceState.update(task.overlayDiscovery,undefined);
    if (event.exitCode === 0 && task.fileReset) {
      await acknowledgeFileReset(context, task.fileReset);
      await safeRefresh();
    }
    const outcome=event.exitCode===0?undefined:{action:task.action,method:task.method,code:event.exitCode,
      time:Date.now(),terminalName:event.execution.task.name};
    if(outcome || context.workspaceState.get(task.targetScope)){
      await context.workspaceState.update(task.targetScope,outcome);
      await provider.refresh();
    }
  }));
  context.subscriptions.push(vscode.tasks.onDidEndTask(e=>{
    const def=e.execution.task.definition;
    if(def.type==='zephyrWorkbench' && def.action!=='list'){running.delete(def.buildKey);safeRefresh();}
  }));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e=>{
    if(e.affectsConfiguration('zephyrWorkbench.locations')) {resetDiscovery(provider.folder());safeRefresh();}
    if(e.affectsConfiguration('zephyrWorkbench.appearance'))void send_appearance();
  }));
  if (view.visible) open();
}
module.exports={registerWorkbench};
