'use strict';

const vscode = require('vscode');
const fs = require('node:fs/promises');
const os = require('node:os');
const {candidates,registration,registrationScopes} = require('./environmentRegistration');
const {window,l10n} = vscode;

async function registerEnvironment(rows, current, access=registration) {
  if (!current()) return;
  const linux = process.platform === 'linux';
  if (linux && !await fs.access('/run/systemd/system').then(()=>true,()=>false)) {
    return window.showInformationMessage(l10n.t('This host does not run systemd. Set variables in your login environment or keep the workspace settings.'));
  }
  const options = candidates(rows).map(({name,value,cached}) => ({
    label:name, description:cached?'CMakeCache.txt':l10n.t('Build environment'), detail:value, value
  }));
  const field = await window.showQuickPick(options,{title:l10n.t('Register a build environment variable'),matchOnDetail:true});
  if (!field || !current()) return;
  const labels = {User:l10n.t('Current user'),Machine:l10n.t('All users (administrator)'),Session:l10n.t('Current macOS login session')};
  const scopes = registrationScopes().map(scope => ({label:labels[scope],scope}));
  const scope = scopes.length === 1 ? scopes[0] : await window.showQuickPick(scopes,{title:l10n.t('Registration scope on {0}',os.hostname())});
  if (!scope || !current()) return;
  const key = {name:field.label,scope:scope.scope};
  const previous = await access(key);
  if (!current()) return;
  if (previous === field.value) return window.showInformationMessage(l10n.t('This value is already registered.'));
  const impact = {
    win32:l10n.t('New Windows sessions inherit this setting. Restart VS Code after signing in again.'),
    linux:l10n.t('New systemd user sessions and processes they launch inherit this setting.'),
    darwin:l10n.t('Programs launched by launchd in this session inherit this value until logout. Quit and reopen VS Code to use it.')
  }[process.platform];
  const apply = l10n.t('Register');
  const detail = l10n.t('Host: {0}\nScope: {1}\nPrevious registration: {2}\nNew value: {3}\n\n{4}',
    os.hostname(),scope.label,previous ?? l10n.t('Unset'),field.value,impact);
  const confirmed = await window.showWarningMessage(field.label,{modal:true,detail},apply);
  if (confirmed !== apply || !current()) return;
  try {
    await access({...key,write:true,previous,value:field.value});
  } catch (error) {
    const diagnostic = error.stderr?.trim().split(/\r?\n/).at(-1);
    const unavailable = error.code === 'ENOENT' ? l10n.t('Required system tool is missing: {0}',error.path) : diagnostic;
    throw Error(l10n.t('Could not register {0}. {1}',field.label,unavailable || error.message || l10n.t('Check permissions and try again.')));
  }
  if (await access(key) !== field.value) throw Error(l10n.t('The registered value could not be verified.'));
  return window.showInformationMessage(l10n.t('Registered {0}. {1}',field.label,impact));
}

module.exports = {registerEnvironment};
