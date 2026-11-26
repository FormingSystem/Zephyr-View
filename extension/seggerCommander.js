'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {ProbeCache} = require('./probeCache');
const run = promisify(execFile);
const registry = new ProbeCache(1,5000);

// Zephyr's J-Link runner uses SEGGER's per-user registration to avoid Java's same-named linker.
function registeredDirectory(fresh = false) {
  const root = process.env.SystemRoot;
  if (!root) return;
  if (fresh) registry.clear();
  return registry.read(root,async()=>{
    const ps = path.join(root,'System32','WindowsPowerShell','v1.0','powershell.exe');
    const query = "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); " +
      "(Get-ItemProperty -LiteralPath 'HKCU:\\Software\\SEGGER\\J-Link' -ErrorAction SilentlyContinue).InstallPath";
    const {stdout} = await run(ps,['-NoProfile','-NonInteractive','-Command',query],{windowsHide:true,timeout:5000});
    const location = stdout.trim();
    if (path.isAbsolute(location)) return location;
  }).catch(()=>undefined);
}

async function javaLinker(file) {
  const target = await fs.realpath(file).catch(()=>file);
  return fs.access(path.join(path.dirname(target),'java.exe')).then(()=>true,()=>false);
}

module.exports = {registeredDirectory, javaLinker};
