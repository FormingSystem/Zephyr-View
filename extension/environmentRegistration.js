'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {execFile} = require('node:child_process');
const execute = require('node:util').promisify(execFile);
const variables = ['ZEPHYR_BASE', 'ZEPHYR_SDK_INSTALL_DIR', 'ZEPHYR_TOOLCHAIN_VARIANT', 'CROSS_COMPILE'];

function candidates(rows) {
  return rows.filter(row => variables.includes(row.name)).map(row => ({
    name:row.name, value:row.value ?? row.cached, cached:row.value === undefined
  })).filter(row => row.value && !/[\r\n\0]/.test(row.value) &&
    (row.name === 'ZEPHYR_TOOLCHAIN_VARIANT' || path.isAbsolute(row.value)));
}

function registrationScopes(platform=process.platform) {
  if (platform === 'darwin') return ['Session'];
  return platform === 'win32' || platform === 'linux' ? ['User','Machine'] : [];
}

function validate(name,scope,value,platform) {
  if (!variables.includes(name) || !registrationScopes(platform).includes(scope)) throw Error('Invalid environment variable or scope.');
  if (value !== undefined && (!value || /[\0\r\n]/.test(value))) throw Error('Invalid environment variable value.');
}

function encoded(script) { return Buffer.from(script,'utf16le').toString('base64'); }

async function windowsRegistration(request, run) {
  const program = path.win32.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const data = Buffer.from(JSON.stringify(request)).toString('base64');
  const script = [
    "$ErrorActionPreference='Stop'",
    '[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)',
    "$r=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('"+data+"')) | ConvertFrom-Json",
    '$previous=[Environment]::GetEnvironmentVariable($r.name,$r.scope)',
    request.write ? [
      'if ($previous -cne $r.previous) { throw "Environment setting changed. Review the new value." }',
      '[Environment]::SetEnvironmentVariable($r.name,$r.value,$r.scope)'
    ].join('\n') : "if ($null -eq $previous) { 'null' } else { ConvertTo-Json -Compress -InputObject $previous }"
  ].join('\n');
  const elevated = request.scope === 'Machine' && request.write;
  const operation = elevated ? [
    "$ErrorActionPreference='Stop'\n",
    "$p=Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -Verb RunAs -Wait -PassThru -WindowStyle Hidden",
    " -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','"+encoded(script)+"'",
    '\nexit $p.ExitCode'
  ].join('') : script;
  const {stdout} = await run(program,['-NoProfile','-NonInteractive','-EncodedCommand',encoded(operation)],{windowsHide:true});
  return request.write ? undefined : JSON.parse(stdout.trim());
}

async function linuxRegistration(request,run) {
  const source = await fs.readFile(path.join(__dirname,'register_environment.py'),'utf8');
  const system = request.scope === 'Machine';
  const directory = system ? '/etc/environment.d' : path.join(
    path.isAbsolute(process.env.XDG_CONFIG_HOME || '') ? process.env.XDG_CONFIG_HOME : path.join(os.homedir(),'.config'), 'environment.d');
  const args = ['-I','-c',source,JSON.stringify(request),directory];
  const elevated = system && request.write;
  const {stdout} = elevated ? await run('/usr/bin/pkexec',['/usr/bin/python3',...args]) : await run('/usr/bin/python3',args);
  return request.write ? undefined : JSON.parse(stdout);
}

async function macSessionValue(name,run) {
  try {
    const {stdout} = await run('/bin/launchctl',['getenv',name]);
    return stdout.replace(/\n$/, '') || null;
  } catch (error) {
    if (error.code === 1 && !error.stderr?.trim()) return null;
    throw error;
  }
}

async function macSessionRegistration(request,run) {
  const previous = await macSessionValue(request.name,run);
  if (!request.write) return previous;
  if (previous !== request.previous) throw Error('Environment setting changed. Review the new value.');
  await run('/bin/launchctl',['setenv',request.name,request.value]);
}

async function registration(request,run=execute,platform=process.platform) {
  if (request.write && typeof request.value !== 'string') throw Error('Invalid environment variable value.');
  validate(request.name,request.scope,request.write ? request.value : undefined,platform);
  if (platform === 'darwin') return macSessionRegistration(request,run);
  if (platform === 'win32') return windowsRegistration(request,run);
  if (platform === 'linux') return linuxRegistration(request,run);
}

module.exports = {candidates,registration,registrationScopes};
