'use strict';

function failedChoices(kind,error) {
  if (kind !== 'board') return {error:error.message};
  const reason = String(error.stderr || error.message || '').trim().split(/\r?\n/).pop();
  const issue = error.kind || (/ZEPHYR_BASE/.test(reason) ? 'source' :
    /ModuleNotFoundError|ENOENT.*python|python.*ENOENT/i.test(reason) ? 'python' : 'catalog');
  return {items:[],diagnostics:[{kind:issue,message:reason}]};
}

/** Publish the choices and their actionable diagnostics together, only for the latest request. */
async function targetChoiceReply(snapshot,{kind,request},load,isCurrent) {
  const requests = snapshot.choiceRequests ??= {};
  const token = requests[kind] = Symbol();
  let result;
  try { result = await load(); }
  catch (error) { result = failedChoices(kind,error); }
  if (requests[kind] !== token || !isCurrent()) return;
  (snapshot.choices ??= {})[kind] = result.items || [];
  if (kind === 'board') snapshot.boardIssues = result.diagnostics || [];
  return {picker:request,...result};
}

module.exports = {targetChoiceReply};
