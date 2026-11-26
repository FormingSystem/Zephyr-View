'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
const {writeNewProject} = require('./newProject');
const model = require('./media/threadStudio/programModel');

const designFile = 'design.zephyr-program.json';
const sourceFile = 'src/main.c';
const marker = '/* Zephyr View generated source: sha256=';
const digest = body => createHash('sha256').update(body).digest('hex');
const graphText = graph => JSON.stringify(graph, null, 2) + '\n';

function markedSource(source) {
  return source + marker + digest(source) + ' */\n';
}

function generatedBody(contents) {
  const normalized = contents.replace(/\r\n/g, '\n');
  const footer = normalized.lastIndexOf(marker);
  if (footer < 0) return;
  const source = normalized.slice(0,footer);
  return markedSource(source) === normalized ? source : undefined;
}

function projectName(graph) {
  const name = String(graph.name || '').trim().replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0,60);
  return 'zephyr-visual-' + (name || 'program');
}

async function exportProgram(parent, graph) {
  const files = model.generate(graph);
  return writeNewProject(parent, projectName(graph), {...files,
    [sourceFile]:markedSource(files[sourceFile]), [designFile]:graphText(graph)});
}

function conflict(code) { return Object.assign(new Error(code), {code}); }

/** Validate the exported design and source location anew on each update; reject links and edits. */
async function inspectProgram(designPath, graph) {
  if (path.basename(designPath) !== designFile) throw conflict('NOT_GENERATED_PROJECT');
  const root = await fs.realpath(path.dirname(designPath));
  const document = path.join(root, designFile);
  const target = path.join(root, sourceFile);
  if (await fs.realpath(document) !== document || await fs.realpath(target) !== target) throw conflict('NOT_GENERATED_PROJECT');
  const stat = await fs.lstat(target);
  if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw conflict('NOT_GENERATED_PROJECT');
  const original = await fs.readFile(target, 'utf8');
  if (!original.includes(marker)) throw conflict('NOT_GENERATED_PROJECT');
  const body = generatedBody(original);
  if (body === undefined) throw conflict('SOURCE_EDITED');
  const next = model.generate(graph)[sourceFile];
  return {target, original, next:markedSource(next), changed:body !== next, mode:stat.mode};
}

/** Stage and publish a single file. Parallel designers recheck the original after acquiring the lock. */
async function updateProgram(designPath, graph, approved) {
  const lock = approved.target + '.zephyr-view.lock';
  const handle = await fs.open(lock, 'wx');
  const temporary = approved.target + '.' + randomUUID() + '.tmp';
  try {
    const checked = await inspectProgram(designPath, graph);
    if (checked.target !== approved.target || checked.original !== approved.original || checked.next !== approved.next) {
      throw conflict('SOURCE_EDITED');
    }
    if (!checked.changed) return;
    await fs.writeFile(temporary, checked.next, {flag:'wx', mode:checked.mode});
    if (await fs.readFile(checked.target,'utf8') !== checked.original) throw conflict('SOURCE_EDITED');
    await fs.rename(temporary, checked.target);
  } finally {
    await fs.unlink(temporary).catch(() => {});
    await handle.close();
    await fs.unlink(lock);
  }
}

module.exports = {designFile, sourceFile, graphText, exportProgram, inspectProgram, updateProgram};
