'use strict';

const vscode = require('vscode');
const path = require('node:path');
const {t, directory, destination, select} = require('./installationDialogs');
const {isZephyrSource} = require('./discoverLocations');
const {executeAndWait} = require('./taskCompletion');
const {Uri, window} = vscode;
const project = 'https://github.com/zephyrproject-rtos/zephyr';
const releasePage = project + '/releases';

function sourcePlan(tools, method, target, revision) {
  if (method === 'west') return {program:tools.west,
    args:['init','-m',project,'--mr',revision,target], source:path.join(target,'zephyr')};
  return {program:tools.git,args:['clone','--depth','1','--branch',revision,'--',project,target],source:target};
}

async function selectRevision() {
  const releases = await window.withProgress({location:vscode.ProgressLocation.Notification,
    title:t('读取 Zephyr 官方发布版本','Loading official Zephyr releases'),cancellable:true}, async (_, token) => {
    const controller = new AbortController();
    const cancel = token.onCancellationRequested(() => controller.abort());
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch('https://api.github.com/repos/zephyrproject-rtos/zephyr/releases?per_page=40',
        {signal:controller.signal,headers:{'User-Agent':'Zephyr-Extension'}});
      if (!response.ok) return [];
      const rows = await response.json();
      return rows.filter(row=>!row.draft && !row.prerelease && /^v\d+\.\d+\.\d+$/.test(row.tag_name)).map(row=>row.tag_name);
    } catch { return token.isCancellationRequested ? undefined : []; }
    finally { clearTimeout(timeout); cancel.dispose(); }
  });
  if (!releases) return;
  const revision = await select(t('选择工程需要的 Zephyr 版本','Choose the Zephyr release required by the project'), [
    ...[...new Set(releases)].map(tag=>[tag,tag]),['main',t('开发分支 · main','Development branch · main')],
    ['other',t('指定标签或分支…','Enter a tag or branch…')] ]);
  if (revision !== 'other') return revision;
  return window.showInputBox({title:t('Zephyr 标签或分支','Zephyr tag or branch'),
    validateInput:value=>/^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(value) ? undefined : t('请输入有效的标签或分支','Enter a valid tag or branch')});
}

async function acquireSource(s, method, current) {
  if (!current()) return;
  const canDownload = s.tools.git && (method !== 'west' || s.tools.west);
  const choices = [['existing',t('选择已有源码目录…','Use an existing source directory…')]];
  if (canDownload) choices.push(['download',method === 'west' ?
    t('用 west 初始化官方工作区…','Initialize an official workspace with west…') :
    t('下载官方 Zephyr 源码…','Download official Zephyr sources…')]);
  choices.push(['releases',t('打开官方发布页','Open official releases')]);
  const action = await select('Zephyr · ZEPHYR_BASE',choices);
  if (!action || !current()) return;
  if (action === 'releases') { await vscode.env.openExternal(Uri.parse(releasePage)); return; }
  let source;
  if (action === 'existing') source = await directory(s,t('选择 Zephyr 源码目录','Select the Zephyr source directory'));
  else {
    const revision = await selectRevision();
    if (!revision || !current()) return;
    const folder = await destination(s,method === 'west' ? 'zephyr-workspace' : 'zephyr');
    if (!folder || !current()) return;
    const plan = sourcePlan(s.tools,method,folder,revision);
    const execution = new vscode.ProcessExecution(plan.program,plan.args,{cwd:path.dirname(folder),env:require('./buildSetup').buildEnv(s)});
    const task = new vscode.Task({type:'zephyrSource'},s.folder,'Zephyr · '+revision,'Zephyr',execution);
    const code = await executeAndWait(task);
    if (code !== 0) throw Error(t('源码下载未完成，请查看任务输出。','Source download did not finish. See the task output.'));
    source = plan.source;
  }
  if (!source || !current()) return;
  if (!await isZephyrSource(source)) throw Error(t('请选择同时含 VERSION 和 Zephyr CMake 包的源码目录。',
    'Select a source directory containing VERSION and the Zephyr CMake package.'));
  return source;
}

module.exports = {acquireSource, sourcePlan};
