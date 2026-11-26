'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {host,refresh,run,uri,workspace_state} = require('./adaptive-build-host.cjs');

async function main() {
  const {ZEPHYR_BASE:base,ZEPHYR_SDK_INSTALL_DIR:sdk,ZEPHYR_MODULES:modules,PYTHON:sourcePython} = process.env;
  assert.ok(base && sdk && modules && sourcePython,'Set ZEPHYR_BASE, ZEPHYR_SDK_INSTALL_DIR, ZEPHYR_MODULES and PYTHON (existing development Python)');
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'zephyr-without-west-')), app = path.join(root,'app');
  const python = execFileSync(sourcePython,['-I',path.join(__dirname,'offline-python.py'),path.join(root,'python')],{encoding:'utf8'}).trim();
  const environment = {...process.env,PYTHONNOUSERSITE:'1'};
  for (const name of ['WEST_PYTHON','WEST_TOPDIR','WEST_DIR','PYTHONPATH','PYTHONHOME','VIRTUAL_ENV','ZEPHYR_MODULES'])
    delete environment[name];
  const pathKey = Object.keys(environment).find(key=>key.toUpperCase()==='PATH');
  const probe = 'import json, os, shutil; print(json.dumps([p for p in os.get_exec_path() if p and not shutil.which("west",path=p)]))';
  const allowed = JSON.parse(execFileSync(python,['-I','-c',probe],{env:environment,encoding:'utf8'}));
  environment[pathKey]=[path.dirname(python),...allowed].join(path.delimiter);
  const check = 'import importlib.util, json, shutil, sys; print(json.dumps([sys.executable,shutil.which("west"),bool(importlib.util.find_spec("west"))]))';
  const [interpreter,executable,importable] = JSON.parse(execFileSync(python,['-c',check],{env:environment,cwd:root,encoding:'utf8'}));
  assert.equal(executable,null); assert.equal(importable,false);
  console.log('Evidence:',root,'Python:',interpreter,'west executable:',executable,'west importable:',importable);
  await fs.cp(path.join(base,'samples','hello_world'),app,{recursive:true,filter:file=>path.basename(file)!=='build'});
  const context=workspace_state(), s={folder:{uri:uri(app)},build:uri(path.join(root,'build')),application:app,
    environment,tools:{cmake:'cmake',ninja:'ninja',python},manifest:{projects:[]},saved:{}};
  s.target=await host.readTarget(s.folder,s.build); s.setup={app};
  await host.applyChoice(context,s,'board','mps2/an386');
  await host.saveArguments(context,s,'Python3_EXECUTABLE:FILEPATH='+python.split(path.sep).join('/')+'\nZEPHYR_MODULES='+modules);
  await refresh(context,s,'CMake');
  assert.ok(s.setup.canConfigure,JSON.stringify(s.setup.readiness));
  const env=host.taskEnvironment(context,s),log=path.join(root,'build.log');
  await run(s.setup.plan.executable,s.setup.plan.configure,root,env,log);
  await refresh(context,s,'CMake');
  assert.equal(s.target.cache.get('WEST'),'WEST-NOTFOUND');
  assert.equal(path.relative(s.target.cache.get('Python3_EXECUTABLE'),python),'');
  const recorded=await fs.readFile(path.join(s.build.fsPath,'zephyr_modules.txt'),'utf8');
  const roots=[...recorded.matchAll(/^"[^"]+":"([^"]+)":/gm)].map(match=>path.resolve(match[1])).sort();
  assert.deepEqual(roots,modules.split(';').map(dir=>path.resolve(dir)).sort());
  assert.ok(s.setup.canBuild,JSON.stringify(s.setup.readiness));
  await run(s.setup.plan.executable,s.setup.plan.build,root,env,log);
  const elf=await fs.readFile(path.join(s.build.fsPath,'zephyr','zephyr.elf'));
  assert.equal(elf.subarray(0,4).toString(),'\x7fELF'); assert.equal(elf.readUInt16LE(18),40);
  console.log('PASS',s.target.cache.get('WEST'),s.target.cache.get('ZEPHYR_MODULES'),elf.length,'bytes, ARM ELF');
}

main().catch(error=>{console.error(error);process.exitCode=1;});
