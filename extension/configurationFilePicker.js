'use strict';

const path = require('node:path');
const {window, Uri, l10n} = require('vscode');
const {relative, path: display_path} = require('./media/pathDisplay');
const {fuzzy} = require('./media/design/fuzzy');
const {selectFiles} = require('./configurationFiles');

const extensions = {dts: 'dts', kconfig: 'conf', overlay: 'overlay'};

/** Keep the current merge order when reopening a multiple-file picker. */
async function pick_from_list(group, kind, app) {
  const candidates = [...new Set([...group.files, ...group.candidates])].filter(file => !group.missing.includes(file));
  const items = candidates.map(file => ({
    label: path.basename(file), description: relative(file, app), detail: display_path(file),
    picked: group.files.includes(file), file
  }));
  const picker = window.createQuickPick();
  picker.title = l10n.t('Select build inputs · {0}', group.variable);
  picker.placeholder = l10n.t('Search by filename or path');
  picker.canSelectMany = kind !== 'dts';
  picker.matchOnDescription = true;
  picker.items = items;
  const checked = items.filter(item => item.picked);
  if (picker.canSelectMany) picker.selectedItems = checked;
  else picker.activeItems = checked;
  return new Promise(resolve => {
    picker.onDidChangeValue(query => {
      const selected = picker.selectedItems;
      for (const item of items) {
        item.alwaysShow = fuzzy(item.label,query) || fuzzy(item.description,query) ||
          (/[\\/]/.test(query) && fuzzy(item.detail,query));
      }
      picker.items = items;
      if (picker.canSelectMany) picker.selectedItems = selected;
    });
    picker.onDidAccept(() => {
      const selected = new Set(picker.selectedItems);
      resolve(items.filter(item => selected.has(item)).map(item => item.file));
      picker.hide();
    });
    picker.onDidHide(() => {picker.dispose(); resolve(undefined);});
    picker.show();
  });
}

async function browse_files(group, kind, app) {
  const uris = await window.showOpenDialog({
    title: l10n.t('Select build inputs · {0}', group.variable),
    defaultUri: Uri.file(app), filters: {[group.variable]: [extensions[kind]], [l10n.t('All files')]: ['*']},
    canSelectFiles: true, canSelectFolders: false, canSelectMany: kind !== 'dts'
  });
  return uris?.map(uri => uri.fsPath);
}

/** Zephyr merges fragments in order. Cancellations during reordering leave the previous list intact. */
async function pick_merge_order(group, app) {
  const remaining = [...group.files], ordered = [];
  while (remaining.length > 1) {
    const item = await window.showQuickPick(remaining.map(file => ({file, label: relative(file, app)})), {
      title: l10n.t('Merge order · {0} · {1}/{2}', group.variable, ordered.length + 1, group.files.length),
      placeHolder: l10n.t('Choose the next file to merge')
    });
    if (!item) return;
    ordered.push(item.file);
    remaining.splice(remaining.indexOf(item.file), 1);
  }
  return ordered.concat(remaining);
}

async function choose_configuration_files(context, snapshot, request, still_current) {
  const {kind, action} = request || {};
  if (!Object.hasOwn(extensions, kind) || !still_current()) return false;
  const group = snapshot.configurationFiles?.[kind];
  if (!group) return false;
  const app = snapshot.setup.app;
  let selection;
  if (action === 'reset') selection = null;
  else if (action === 'list') selection = await pick_from_list(group, kind, app);
  else if (action === 'browse') selection = await browse_files(group, kind, app);
  else if (action === 'order' && kind !== 'dts' && group.files.length > 1) selection = await pick_merge_order(group, app);
  if ((selection !== null && !selection?.length) || !still_current()) return false;
  return selectFiles(context, snapshot, kind, selection);
}

/** Only a missing file explicitly selected in this picker can prevent configuration. */
function apply_file_readiness(setup, groups) {
  if (setup.readiness.configure.includes('application')) return;
  const issues = Object.entries(groups).filter(([,group]) => group.source === 'manual' && group.missing.length);
  if (!issues.length) return;
  const actions = issues.map(([kind]) => 'files-' + kind);
  setup.readiness.configure.unshift(...actions);
  setup.readiness.build.unshift(...actions);
  setup.canConfigure = setup.canBuild = false;
}

module.exports = {choose_configuration_files, apply_file_readiness};
