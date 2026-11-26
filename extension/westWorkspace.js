'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const yaml = require('js-yaml');

async function hasWestDirectory(directory) {
  try { return (await fs.stat(path.join(directory, '.west'))).isDirectory(); }
  catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code)) return false;
    throw error;
  }
}

async function westTopdir(directory) {
  for (let dir = path.resolve(directory);;) {
    if (await hasWestDirectory(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

function relativeEntry(parent, child) {
  const relative = path.relative(parent, child);
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep) || /[\r\n\0]/.test(relative)) return;
  return relative.split(path.sep).join('/') || '.';
}

async function localManifest(repository, file) {
  const relative = relativeEntry(repository, file);
  if (!relative || !relativeEntry(await fs.realpath(repository), await fs.realpath(file))) return;
  const document = yaml.load(await fs.readFile(file, 'utf8'), {schema:yaml.FAILSAFE_SCHEMA});
  if (!document?.manifest || typeof document.manifest !== 'object' || Array.isArray(document.manifest)) return;
  return relative;
}

function localInitPlan(repository, manifestFile) {
  return {root:path.dirname(repository), repository, args:['init', '-l', '--mf', manifestFile, '--', repository]};
}

function remoteInitPlan(root, url, revision, manifestFile) {
  const args = ['init', '-m', url];
  if (revision) args.push('--mr', revision);
  args.push('--mf', manifestFile, '--', root);
  return {root, args};
}

// west reads INI using ConfigParser. Index the two editable options and leave other text intact.
function inspectConfig(text) {
  const lines = text.split(/\r?\n/);
  if (text.startsWith('\uFEFF')) return;
  let section, option, optionIndent = 0, manifestLine, manifestIndent;
  const sections = new Map();
  const fields = {};
  for (const [index,line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed || /^[;#]/.test(trimmed)) continue;
    const indent = line.length - line.trimStart().length;
    if (option && indent > optionIndent) {
      if (section === 'manifest' && ['path','file'].includes(option)) return;
      continue;
    }
    const heading = /^\[([^\]]+)\]\s*(?:[;#].*)?$/.exec(trimmed);
    if (heading) {
      section = heading[1];
      if (sections.has(section)) return;
      sections.set(section,new Set());
      if (section === 'manifest') manifestLine = index;
      option = undefined;
      continue;
    }
    const entry = /^(\s*([^=:]+?)\s*[=:]\s*)(.*)$/.exec(line);
    if (!entry || !section) return;
    option = entry[2].trim().toLowerCase();
    if (!option || sections.get(section).has(option)) return;
    sections.get(section).add(option);
    optionIndent = indent;
    if (section === 'manifest') manifestIndent ??= line.slice(0,indent);
    if (section === 'manifest' && ['path','file'].includes(option))
      fields[option] = {value:entry[3].trim(), prefix:entry[1], index};
  }
  return {lines,fields,manifestLine,manifestIndent};
}

/** Preserve unrelated sections, comments, key spelling and the original newline style. */
function repairConfig(text, repository, file) {
  const parsed = inspectConfig(text);
  if (!parsed) return;
  const {lines, fields, manifestLine, manifestIndent = ''} = parsed;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  if (manifestLine === undefined) {
    const separator = !text || text.endsWith('\n') ? '' : eol;
    return text + separator + ['[manifest]', 'path = ' + repository, 'file = ' + file, ''].join(eol);
  }
  const missing = [];
  for (const [name,value] of Object.entries({path:repository,file})) {
    const entry = fields[name];
    if (entry) lines[entry.index] = entry.prefix + value;
    else missing.push(manifestIndent + name + ' = ' + value);
  }
  lines.splice(manifestLine + 1,0,...missing);
  return lines.join(eol);
}

module.exports = {hasWestDirectory, westTopdir, relativeEntry, localManifest, localInitPlan, remoteInitPlan, inspectConfig, repairConfig};
