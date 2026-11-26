'use strict';

// Run with a local ZEPHYR_BASE, PYTHON and toolchain. On Linux CI run in a private network namespace.
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const {host, refresh, run, uri, vscode, workspace_state} = require('./adaptive-build-host.cjs');

const cmakePath = value => value.split(path.sep).join('/');
const pythonRun = (python,args,env,cwd) => execFileSync(python,args,{env,cwd,encoding:'utf8',windowsHide:true}).trim();
function blockHostNetwork(){
  const violations=[];
  const blocked=()=>{violations.push('extension attempted network access');throw Error(violations.at(-1));};
  net.Socket.prototype.connect=blocked;
  globalThis.fetch=blocked;
  if(process.env.ZEPHYR_TEST_ISOLATED_NETWORK==='1'){
    const interfaces=Object.values(os.networkInterfaces()).flat().filter(iface=>!iface.internal);
    assert.deepEqual(interfaces,[],'Run this test in a private network namespace');
  }
  return violations;
}
async function write(file, text) {
  await fs.mkdir(path.dirname(file),{recursive:true});
  await fs.writeFile(file,text);
}

async function buildEnvironment(root,base) {
  const source = process.env.PYTHON;
  assert.ok(source,'Set PYTHON to the development interpreter with local build dependencies');
  const moduleScript=await fs.readFile(path.join(base,'scripts','zephyr_module.py'),'utf8');
  const extras=moduleScript.includes('import pykwalify')?['pykwalify']:[];
  const python=pythonRun(source,['-I',path.join(__dirname,'offline-python.py'),path.join(root,'python'),...extras],process.env,root);
  const env={...process.env,PYTHONNOUSERSITE:'1',GIT_ALLOW_PROTOCOL:'file',GIT_TERMINAL_PROMPT:'0',
    ZEPHYR_OFFLINE_AUDIT:path.join(root,'offline-attempts.txt'),ZEPHYR_BASE:base,PIP_NO_INDEX:'1'};
  for(const name of Object.keys(env)){
    if(/^(?:WEST(?:_.*)?|VIRTUAL_ENV|PYTHONHOME|PYTHONPATH|ZEPHYR_(?:EXTRA_)?MODULES|EXTRA_ZEPHYR_MODULES|BOARD|NO_PROXY|(?:HTTPS?|ALL)_PROXY)$/i.test(name))delete env[name];
  }
  for(const name of ['http_proxy','https_proxy','all_proxy'])env[name]='http://127.0.0.1:9';
  const pathKey=Object.keys(env).find(key=>key.toUpperCase()==='PATH');
  const allowed=JSON.parse(pythonRun(python,['-I','-c','import os, shutil, json; print(json.dumps([p for p in os.get_exec_path() if p and not shutil.which("west",path=p)]))'],env,root));
  env[pathKey]=[path.dirname(python),...allowed].join(path.delimiter);
  const site=pythonRun(python,['-I','-c',"import sysconfig; print(sysconfig.get_path('purelib'))"],env,root);
  await fs.copyFile(path.join(__dirname,'offline-guard.py'),path.join(site,'sitecustomize.py'));
  const probeLog=path.join(root,'guard-probe.txt');
  const probe=[
    'import importlib.util, socket, shutil, subprocess',
    'assert shutil.which("west") is None and importlib.util.find_spec("west") is None',
    'for attempt in (lambda: socket.getaddrinfo("offline.invalid",443), lambda: subprocess.run(["west","list"])):',
    '    try: attempt()',
    '    except PermissionError: pass',
    '    else: raise AssertionError("Offline audit guard inactive")'
  ].join('\n');
  pythonRun(python,['-I','-c',probe],{...env,ZEPHYR_OFFLINE_AUDIT:probeLog},root);
  const audit=await fs.readFile(probeLog,'utf8');
  assert.match(audit,/socket.getaddrinfo/);
  assert.match(audit,/west executable/);
  return {python,env};
}

async function moduleFixture(dir,name,legacy=false) {
  const entry=legacy?'zephyr':'integration';
  if(!legacy)await write(path.join(dir,'zephyr','module.yml'),`name: ${name}\nbuild:\n  cmake: ${entry}\n  kconfig: ${entry}/Kconfig\n`);
  await write(path.join(dir,entry,'Kconfig'),`config ${name.toUpperCase()}\n    bool\n    default y\n`);
  await write(path.join(dir,entry,'CMakeLists.txt'),`zephyr_library_named(${name})\nzephyr_library_sources(${name}.c)\n`);
  await write(path.join(dir,entry,name+'.c'),`int ${name}(void) { return 1; }\n`);
  return dir;
}

async function projectFixture(root) {
  const workspace=path.join(root,'workspace'),app=path.join(workspace,'app'),modules=path.join(workspace,'modules');
  // The official west.yml contains the same name. A standalone source manifest cannot own this local module.
  const declared=await moduleFixture(path.join(modules,'vendor','unrelated-directory-name'),'hal_gigadevice');
  const legacy=await moduleFixture(path.join(modules,'offline_legacy'),'offline_legacy',true);
  await moduleFixture(path.join(modules,'unused'),'offline_unused');
  const external=await moduleFixture(path.join(root,'private-dependencies','external'),'offline_private');
  await write(path.join(app,'CMakeLists.txt'),[
    'cmake_minimum_required(VERSION 3.20.0)',
    'list(APPEND EXTRA_ZEPHYR_MODULES "${CMAKE_CURRENT_LIST_DIR}/../../private-dependencies/external")',
    'find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})',
    'project(offline_module_probe)',
    'target_sources(app PRIVATE main.c)'
  ].join('\n'));
  await write(path.join(app,'prj.conf'),'');
  const names=['hal_gigadevice','offline_legacy','offline_private'];
  await write(path.join(app,'main.c'),[
    ...names.map(n=>`int ${n}(void);`),
    `int main(void) { return ${names.map(n=>n+'()').join(' + ')} == 3 ? 0 : 1; }`
  ].join('\n'));
  return {workspace,app,declared,legacy,external};
}

async function checkBuild(context,s,fixture,env,root) {
  const expected=[fixture.declared,fixture.legacy,fixture.external].map(p=>path.resolve(p)).sort();
  const generated=await fs.readFile(path.join(s.build.fsPath,'zephyr_modules.txt'),'utf8');
  const actual=[...generated.matchAll(/^"[^"]+":"([^"]+)":/gm)].map(m=>path.resolve(m[1])).sort();
  assert.deepEqual(actual,expected,'Zephyr must use the two selected modules and the application-owned module only');
  const cached=s.target.cache;
  assert.equal(cached.get('WEST'),'WEST-NOTFOUND');
  assert.equal(path.relative(cached.get('CMAKE_HOME_DIRECTORY'),fixture.app),'');
  assert.equal(s.setup.board,'qemu_riscv32');
  const config=await fs.readFile(path.join(s.build.fsPath,'zephyr','.config'),'utf8');
  const commands=JSON.parse(await fs.readFile(path.join(s.build.fsPath,'compile_commands.json'),'utf8'));
  for(const name of ['hal_gigadevice','offline_legacy','offline_private']){
    assert.match(config,new RegExp('^CONFIG_'+name.toUpperCase()+'=y$','m'));
    assert.ok(commands.some(command=>path.basename(command.file)===name+'.c'),name+' has no compilation unit');
  }
  assert.ok(!commands.some(command=>path.basename(command.file)==='offline_unused.c'));
  const compiler=cached.get('CMAKE_C_COMPILER');
  assert.ok(compiler && path.isAbsolute(compiler),'No compiler path in CMakeCache.txt');
  assert.ok((await fs.stat(compiler)).isFile());
  assert.ok(commands.some(c=>cmakePath(c.command??c.arguments.join(' ')).toLowerCase().includes(cmakePath(compiler).toLowerCase())));
  assert.ok(s.setup.canBuild,JSON.stringify(s.setup.readiness));
  await run(s.setup.plan.executable,s.setup.plan.build,root,host.taskEnvironment(context,s),path.join(root,'build.log'));
  const elf=await fs.readFile(path.join(s.build.fsPath,'zephyr','zephyr.elf'));
  assert.equal(elf.subarray(0,4).toString(),'\x7fELF');
  assert.equal(elf.readUInt16LE(18),243,'Expected RISC-V machine in the linked ELF');
  assert.equal(await fs.readFile(env.ZEPHYR_OFFLINE_AUDIT,'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e;}),'');
  const resolved=await host.moduleCatalog.resolvedModules(s);
  assert.deepEqual(resolved.map(m=>path.resolve(m.path)).sort(),expected,'Workbench must show modules chosen by the application as well as checked modules');
  assert.ok(resolved.every(m=>m.evidence==='zephyr_modules.txt'));
  const rows=await host.moduleCatalog.rows(context,s,'CMake');
  const selection=Object.fromEntries(rows.filter(([name])=>name.startsWith('offline_') || name==='hal_gigadevice')
    .map(([name,,,,checked,,status])=>[name,[checked,status.configured]]));
  assert.deepEqual(selection,{hal_gigadevice:[true,true],offline_legacy:[true,true],
    offline_private:[false,true],offline_unused:[false,false]});
  const common={application:fixture.app,board:s.setup.board,compiler,modules:resolved.map(m=>m.name),elfBytes:elf.length};
  console.log(JSON.stringify(common,null,2));
}

async function main(){
  const base=process.env.ZEPHYR_BASE;
  assert.ok(base && path.isAbsolute(base),'Set ZEPHYR_BASE to an existing official Zephyr source checkout');
  const networkRequests=blockHostNetwork();
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'zephyr-offline-integration-'));
  console.log('Build evidence:',root,'Zephyr:',base);
  const {python,env}=await buildEnvironment(root,base);
  const fixture=await projectFixture(root);
  for(let p=fixture.app;;p=path.dirname(p)){
    assert.equal(await fs.stat(path.join(p,'.west')).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;}),false,'Fixture has a west workspace ancestor');
    if(path.dirname(p)===p)break;
  }
  const context=workspace_state();
  vscode.workspace.getConfiguration=()=>({get:(_key,fallback)=>fallback});
  // Run host-side program discovery with the very same offline process environment used by CMake.
  for(const key of Object.keys(process.env))if(!Object.hasOwn(env,key))delete process.env[key];
  Object.assign(process.env,env);
  const folder={uri:uri(fixture.workspace)},build=uri(path.join(root,'build'));
  await context.workspaceState.update('workbench.method:'+folder.uri.toString(),'CMake');
  const discovery=host.createDiscovery();
  const s=await host.inspectWorkspace({folder:()=>folder,buildDir:()=>build},context,discovery);
  assert.ok(!s.tools.west && !s.manifest.root,'Host discovery linked an unexpected west installation');
  s.environment=env;
  s.saved={};
  await discovery.apply(context,s);
  assert.equal(s.application,fixture.app);
  assert.deepEqual(s.localModules.map(m=>m.name).sort(),['hal_gigadevice','offline_legacy','offline_unused']);
  s.setup={app:s.application};
  for(const name of ['hal_gigadevice','offline_legacy']){
    await host.moduleCatalog.operate(context,s,'CMake',{op:'select',value:{name,checked:true}});
  }
  await host.applyChoice(context,s,'board','qemu_riscv32');
  await host.saveArguments(context,s,['Python3_EXECUTABLE:FILEPATH='+cmakePath(python),
    'CMAKE_EXPORT_COMPILE_COMMANDS:BOOL=ON','FETCHCONTENT_FULLY_DISCONNECTED:BOOL=ON'].join('\n'));
  await refresh(context,s,'CMake');
  assert.ok(s.setup.canConfigure,JSON.stringify(s.setup.readiness));
  await run(s.setup.plan.executable,s.setup.plan.configure,root,host.taskEnvironment(context,s),path.join(root,'build.log'));
  await refresh(context,s,'CMake');
  await checkBuild(context,s,fixture,env,root);
  assert.deepEqual(networkRequests,[]);
  await fs.rm(root,{recursive:true,force:true,maxRetries:4,retryDelay:200});
}

main().catch(error=>{console.error(error);process.exitCode=1;});
