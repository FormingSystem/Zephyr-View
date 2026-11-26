'use strict';

const {tasks} = require('vscode');

/** Wait for this execution, including tasks that finish before executeTask returns a handle. */
async function executeAndWait(task, started = () => {}) {
  let execution, finish;
  const ended = new Promise(resolve => {finish = resolve;});
  const earlyCompletions = new Set();
  const exitCodes = new Map();

  const processListener = tasks.onDidEndTaskProcess(event => {
    if (!execution || event.execution === execution) exitCodes.set(event.execution, event.exitCode);
  });
  const taskListener = tasks.onDidEndTask(event => {
    if (!execution) earlyCompletions.add(event.execution);
    else if (event.execution === execution) finish();
  });
  try {
    execution = await tasks.executeTask(task);
    void started();
    if (!earlyCompletions.has(execution)) await ended;
    return exitCodes.get(execution);
  } finally {
    taskListener.dispose();
    processListener.dispose();
  }
}

module.exports = {executeAndWait};
