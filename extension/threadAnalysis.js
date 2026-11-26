'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash,randomUUID} = require('node:crypto');
const {readSource} = require('./threadSource');

const maxFiles = 160, maxSourceBytes = 256 * 1024, maxEntries = 6000;
const isSource = name => /\.(?:c|cc|cpp|cxx)$/i.test(name);
const fingerprint = text => createHash('sha256').update(text).digest('hex');

function inside(root, file) {
  const relative = path.relative(root,file);
  return relative !== '..' && !relative.startsWith('..'+path.sep) && !path.isAbsolute(relative);
}

async function compilationFiles(app, canonicalApp, build) {
  if (!build) return {};
  const db = path.join(build,'compile_commands.json');
  try {
    const stat = await fs.stat(db);
    if (!stat.isFile() || stat.size > 32 * 1024 * 1024) return {databaseIssue:'unreadable'};
    const entries = JSON.parse(await fs.readFile(db,'utf8'));
    if (!Array.isArray(entries)) return {databaseIssue:'invalid'};
    const files = new Set();
    let partial = false;
    for (const entry of entries) {
      if (typeof entry?.file !== 'string' || typeof entry.directory !== 'string') {partial=true; continue;}
      if (!isSource(entry.file)) continue;
      const file = path.resolve(build,entry.directory,entry.file);
      if (inside(build,file) && !inside(build,app)) continue;
      if (inside(app,file) || inside(canonicalApp,file)) files.add(file);
    }
    return {files:[...files].sort(),partial};
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    return {databaseIssue:error instanceof SyntaxError ? 'invalid' : 'unreadable'};
  }
}

async function isSeparateProject(directory, items) {
  if (items.some(item=>item.name === 'CMakeCache.txt')) return true;
  const cmake = items.find(item=>item.name === 'CMakeLists.txt' && item.isFile());
  if (!cmake) return false;
  const handle = await fs.open(path.join(directory,cmake.name),'r');
  try {
    const buffer = Buffer.alloc(8192);
    const {bytesRead} = await handle.read(buffer);
    const text = buffer.subarray(0,bytesRead).toString().replace(/#[^\n]*/g,'');
    return /\bfind_package\s*\(\s*Zephyr\b/i.test(text);
  } finally { await handle.close(); }
}

async function sourceFiles(app, build, current) {
  const files = [], pending = [app];
  let entries = 0, partial = false;
  while (pending.length && current()) {
    const directory = pending.pop();
    try {
      const items = await fs.readdir(directory,{withFileTypes:true});
      if (directory !== app && await isSeparateProject(directory,items)) continue;
      for (const item of items.sort((a,b)=>a.name.localeCompare(b.name,'en'))) {
        if (++entries > maxEntries || files.length >= maxFiles) return {files,partial:true};
        const file = path.join(directory,item.name);
        if (item.name.startsWith('.') || item.name === 'node_modules' || item.isSymbolicLink()) continue;
        if (item.isDirectory() && file !== build) pending.push(file);
        else if (item.isFile() && isSource(item.name)) files.push(file);
      }
    } catch (error) {
      if (!error.code) throw error;
      partial=true;
    }
  }
  return {files,partial};
}

function appendRecords(data, locations, records, file, digest) {
  for (const [key,rows] of Object.entries(records)) {
    const room = Math.max(0,2000-data[key].length);
    if (room < rows.length) data.coverage.partial=true;
    for (const row of rows.slice(0,room)) {
      data[key].push(row);
      locations.set(row.id,{file,line:row.line,digest});
    }
  }
}

/** Bound source inspection to the chosen application. The database only selects translation units. */
async function analyzeApplication(app, build, english = false, current = ()=>true) {
  const actualRoot = await fs.realpath(app);
  const database = await compilationFiles(app,actualRoot,build);
  const scan = database.files ? database : await sourceFiles(app,build,current);
  const locations = new Map(), seen = new Set(), scanId = randomUUID();
  const data = {scanId,files:[],threads:[],objects:[],functions:[],calls:[],diagnostics:[],
    coverage:{mode:database.files?'compilation-database':'source',scanned:0,
      databaseIssue:database.databaseIssue,omitted:Math.max(0,scan.files.length-maxFiles),partial:scan.partial || !!database.databaseIssue}};
  for (const file of scan.files.slice(0,maxFiles)) {
    if (!current()) return;
    try {
      const resolved = await fs.realpath(file);
      if (seen.has(resolved)) continue;
      const stat = await fs.stat(resolved);
      if (!inside(actualRoot,resolved) || !stat.isFile() || stat.size > maxSourceBytes) {data.coverage.omitted++; continue;}
      const text = await fs.readFile(resolved,'utf8');
      if (!current()) return;
      seen.add(resolved);
      const relative = path.relative(actualRoot,resolved).split(path.sep).join('/');
      const sourceId = scanId + ':' + data.files.length;
      appendRecords(data,locations,readSource(relative,text,english,sourceId),resolved,fingerprint(text));
      data.files.push(relative);
    } catch (error) {
      if (!error.code) throw error;
      data.coverage.omitted++;
    }
  }
  data.coverage.scanned=data.files.length;
  data.coverage.partial ||= data.coverage.omitted > 0;
  return current() ? {data,locations} : undefined;
}

module.exports = {analyzeApplication,fingerprint};
