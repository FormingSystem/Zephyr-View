'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');

const vscode = {workspace:{isTrusted:true}, l10n:{t:value=>value}, window:{}};
const loader=Module._load;
let selection,catalog;
try{
  Module._load=function(name,parent,...rest){
    if(name==='vscode')return vscode;
    if(name==='./boardCatalog' && parent.filename.endsWith('compiler_catalog.js'))
      return {readBoards: async s=>[s.board_record]};
    return loader.call(this,name,parent,...rest);
  };
  selection=require('../extension/compiler_selection');
  catalog=require('../extension/compiler_catalog');
}finally{Module._load=loader;}

test('configure accepts equivalent boolean cache values while preserving explicit strings', () => {
  const cache = new Map([['FLAG','TRUE'], ['DISABLED','0']]);
  const types = new Map([['FLAG','BOOL'], ['DISABLED','BOOL']]);
  const matches = (name,value,type) => selection.definition_matches(cache,{name,value,type},types);
  assert.equal(matches('FLAG','ON','BOOL'),true);
  assert.equal(matches('DISABLED','off'),true);
  assert.equal(matches('FLAG','0'),false);
  assert.equal(matches('FLAG','ON','STRING'),false);
  assert.equal(matches('MISSING','OFF','BOOL'),false);
});

const exe=process.platform==='win32'?'.exe':'';
const host_image=process.platform==='win32'?Buffer.from('MZ\0\0'):Buffer.from('#!/bin/sh\n');
const uri=file=>({scheme:'file',fsPath:file,toString:()=>file});
async function put(dir,name,contents='') {
  const file=path.join(dir,name);
  await fs.mkdir(path.dirname(file),{recursive:true});
  await fs.writeFile(file,contents,{mode:0o755});
  return file;
}

async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'zephyr-compiler-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const sdk=path.join(root,'zephyr-sdk-test'),base=path.join(root,'zephyr'),board=path.join(root,'board');
  const app=path.join(root,'app'),build=uri(path.join(root,'build'));
  await Promise.all([
    put(sdk,'sdk_version','1.0'),put(sdk,'cmake/Zephyr-sdkConfig.cmake','# package'),
    put(sdk,'cmake/zephyr/gnu/target.cmake','if(CONFIG_ARM64)\nset(CROSS_COMPILE_TARGET_arm aarch64-zephyr-elf)\nelse()\nset(CROSS_COMPILE_TARGET_arm arm-zephyr-eabi)\nendif()'),
    put(sdk,'cmake/zephyr/llvm/target.cmake','if("${ARCH}" STREQUAL "arm")\nset(triple arm-none-eabi)\nendif()'),
    put(base,'cmake/toolchain/zephyr/generic.cmake','if(TOOLCHAIN_VARIANT_COMPILER STREQUAL "llvm")\ninclude(${ZEPHYR_SDK_INSTALL_DIR}/cmake/zephyr/llvm/generic.cmake)\nendif()'),
    put(base,'cmake/modules/FindHostTools.cmake','set(TOOLCHAIN_VARIANT_COMPILER ${_compiler})'),
    put(base,'scripts/list_boards.py','# board catalog'),put(base,'arch/arm64/Kconfig','# arm64'),
    put(board,'cpu.yaml','identifier: example/soc/cpu\narch: arm\n'),put(board,'other.yaml','identifier: example/soc/radio\narch: riscv\n')
  ]);
  const gcc=await put(sdk,'gnu/arm-zephyr-eabi/bin/arm-zephyr-eabi-gcc'+exe,host_image);
  const cross=await put(root,'external tool/bin/arm-none-eabi-gcc'+exe,host_image);
  const other=await put(root,'external tool/bin/powerpc-other-gcc'+exe,host_image);
  await put(root,'external tool/bin/foreign-elf-gcc'+exe,process.platform==='win32'?Buffer.from([0x7f,69,76,70]):Buffer.from('MZ\0\0'));
  await put(root,'external tool/bin/gcc'+exe);
  const s={folder:{uri:uri(root)},build,setup:{app,board:'example//cpu',cacheStatus:'absent',argsText:''},
    target:{cache:new Map()},tools:{},manifest:{},board_record:{name:'example',socs:['soc'],directories:[board]},
    environment:{ZEPHYR_SDK_INSTALL_DIR:root,ZEPHYR_BASE:base,PATH:path.dirname(cross)}};
  const values=new Map(),context={workspaceState:{keys:()=>[...values.keys()],get:key=>values.get(key),update:(key,value)=>values.set(key,value)}};
  return {root,sdk,base,gcc,cross,other,s,context,values};
}

test('qualified board metadata recommends only the installed SDK architecture and distinguishes external tools',async t=>{
  const {s,context,gcc,other,sdk}=await fixture(t);
  const choices=await selection.compiler_choices(context,s);
  assert.equal(choices.architecture,'arm');
  assert.equal(choices.architecture_source,'board metadata');
  assert.equal(choices.recommendedId,'sdk:gnu');
  assert.equal(choices.options.find(row=>row.id==='sdk:gnu').path,gcc);
  assert.ok(!choices.options.some(row=>row.id==='sdk:llvm'));
  assert.equal(choices.options.find(row=>row.path===other).compatibility,'unverified');
  assert.equal(choices.options.filter(row=>row.source!=='sdk').length,2);
  const clang=await put(sdk,'llvm/bin/clang'+exe,host_image);
  const llvm=(await selection.compiler_choices(context,s)).options.find(row=>row.id==='sdk:llvm');
  assert.equal(llvm.path,clang);
  assert.equal(llvm.variant,'zephyr/llvm');
  s.setup.board='example//radio';
  const radio=await selection.compiler_choices(context,s);
  assert.equal(radio.architecture,'riscv');
  assert.equal(radio.recommendedId,undefined);
  assert.ok(!radio.options.some(row=>row.source==='sdk'));
});

test('legacy board identifiers and a detected source checkout resolve an installed compiler before configuration', async t=>{
  const {s,context,gcc,base}=await fixture(t);
  delete s.environment.ZEPHYR_BASE;
  s.checkout=base;
  s.setup.board='legacy_board';
  s.board_record={...s.board_record,name:'legacy_board',socs:[],qualifiers:[],revisions:[]};
  await put(s.board_record.directories[0],'legacy_board.yaml','identifier: legacy_board\narch: arm\n');
  const choices=await selection.compiler_choices(context,s);
  assert.equal(choices.target,'legacy_board');
  assert.equal(choices.architecture,'arm');
  assert.equal(choices.options.find(item=>item.id===choices.recommendedId)?.path,gcc);
  s.setup.board='legacy_board/unknown';
  assert.equal((await selection.compiler_choices(context,s)).recommendedId,undefined);
});

test('an incomplete cache for this target is identified separately; foreign and unresolved entries are suppressed',async t=>{
  const {s,context,cross}=await fixture(t);
  s.target.cache.set('CMAKE_C_COMPILER',cross);
  s.setup.cacheStatus='current';
  let choices=await selection.compiler_choices(context,s);
  assert.equal(choices.incompleteCompiler,cross);
  assert.equal(choices.configured,undefined);
  s.setup.cacheStatus='conflict';
  choices=await selection.compiler_choices(context,s);
  assert.equal(choices.incompleteCompiler,undefined);
  assert.equal(choices.configured,undefined);
  s.setup.cacheStatus='current';
  s.target.generated=true;
  s.target.cache.set('CMAKE_C_COMPILER','CMAKE_C_COMPILER-NOTFOUND');
  choices=await selection.compiler_choices(context,s);
  assert.equal(choices.configured,undefined);
  assert.equal(choices.incompleteCompiler,undefined);
});

test('Twister board defaults and external variant overrides follow the exact revision and CPU', async t => {
  const {s, root} = await fixture(t);
  const board = s.board_record;
  board.revisions = ['A', 'B'];
  board.defaultRevision = 'A';
  board.qualifiers = ['soc/cpu', 'soc/radio'];
  board.directories.push(path.join(root, 'extra-board-root'));
  await put(board.directories[0], 'twister.yaml', 'arch: arm\nvariants:\n  "example@B/soc/cpu":\n    arch: arm64\n');
  await put(board.directories[1], 'twister.yaml', 'arch: x86\nvariants:\n  "example@A/soc/radio":\n    arch: riscv\n');
  for (const [target, arch] of [['example//cpu', 'arm'], ['example@B//cpu', 'arm64'],
    ['example//radio', 'riscv'], ['example@B//radio', 'arm'], ['example@C//cpu', undefined],
    ['example/soc/other', undefined]]) {
    assert.equal(await catalog.platform_architecture(board, target), arch, target);
  }
});

test('an unresolved requested GNU prefix cannot recommend another compiler simply because its architecture matches', async t=>{
  const {s,context,cross}=await fixture(t);
  s.environment.ZEPHYR_TOOLCHAIN_VARIANT='cross-compile';
  s.environment.CROSS_COMPILE='not-installed-';
  assert.equal((await selection.compiler_choices(context,s)).recommendedId,undefined);
  s.environment.CROSS_COMPILE=path.basename(catalog.cross_prefix(cross));
  const resolved=await selection.compiler_choices(context,s);
  assert.equal(resolved.options.find(item=>item.id===resolved.recommendedId)?.path,cross);
});

test('official SDK family and external prefix travel with the selected app/board into a fresh build',async t=>{
  const {s,context,gcc,cross,other}=await fixture(t);
  const choices=await selection.compiler_choices(context,s);
  const args=['-DKEEP=value'];
  const plan=()=>selection.compiler_request(context,s,s.setup,args);
  await selection.select_compiler(context,s,'sdk:gnu',choices.scope);
  assert.deepEqual(plan().args,['-DZEPHYR_TOOLCHAIN_VARIANT=zephyr/gnu',...args]);
  s.setup.cacheStatus='current';
  s.target.generated=true;
  s.target.cache=new Map([['CMAKE_C_COMPILER',gcc],['ZEPHYR_TOOLCHAIN_VARIANT','zephyr'],['TOOLCHAIN_VARIANT_COMPILER','gnu']]);
  assert.ok(!plan().conflict);
  assert.ok(selection.definition_matches(s.target.cache,{name:'ZEPHYR_TOOLCHAIN_VARIANT',value:'zephyr/gnu'}));
  const external=choices.options.find(row=>row.path===other);
  assert.ok(await selection.select_compiler(context,s,external.id,choices.scope));
  assert.ok(plan().conflict);
  const cmake_prefix_arg='-DCROSS_COMPILE='+external.prefix.split(path.sep).join('/');
  assert.deepEqual(plan().args,['-DZEPHYR_TOOLCHAIN_VARIANT=cross-compile',cmake_prefix_arg,...args]);
  s.build=uri(s.build.fsPath+' 2');
  s.setup.cacheStatus='absent';
  assert.ok(!plan().conflict);
  assert.ok(plan().args.includes(cmake_prefix_arg));
  assert.ok(!await selection.select_compiler(context,s,'auto',choices.scope));
  s.setup.board='example//radio';
  assert.deepEqual(plan().args,args);
  s.setup.board='example//cpu';
  s.setup.argsText='CROSS_COMPILE=own-input-';
  const protected_args=['-DCROSS_COMPILE=own-input-'];
  assert.deepEqual(selection.compiler_request(context,s,s.setup,protected_args).args,protected_args);
  const protected_view=await selection.compiler_choices(context,s);
  assert.equal(protected_view.reason,'explicit');
  assert.ok(await selection.select_compiler(context,s,'cross:'+cross,protected_view.scope));
  assert.equal((await selection.compiler_choices(context,s)).overridden,true);
  assert.equal(protected_view.configured,undefined);
});

test('manual parameters keep their text, order and board scope while an explicit picker choice takes precedence',async t=>{
  const {s,context,cross,gcc}=await fixture(t);
  const original=['-DKEEP=with space','-DZEPHYR_TOOLCHAIN_VARIANT:STRING=zephyr/llvm',
    '-DCROSS_COMPILE_example_soc_radio=keep-radio-','-DCROSS_COMPILE_example_soc_cpu=prior-cpu-',
    '-DCMAKE_C_COMPILER:FILEPATH='+gcc,'-DCROSS_COMPILE_another_board=keep-board-','-DKEEP2=v'];
  s.setup.argsText=original.map(arg=>arg.slice(2)).join('\r\n');
  const original_text=s.setup.argsText;
  const view=await selection.compiler_choices(context,s);
  assert.equal(view.reason,'explicit');
  assert.equal(view.target,'example/soc/cpu');
  assert.deepEqual(view.requestedDefinitions,[original[1],original[3],original[4]].map(arg=>arg.slice(2)));
  vscode.window.showInputBox=async()=>'arm-none-eabi-';
  assert.ok(await selection.choose_external_compiler(context,s,view.scope,true,()=>true));
  const plan=args=>selection.compiler_request(context,s,s.setup,args);
  const retained=[original[0],original[2],original[5],original[6]];
  const selected=['-DZEPHYR_TOOLCHAIN_VARIANT=cross-compile','-DCROSS_COMPILE='+catalog.cross_prefix(cross).split(path.sep).join('/')];
  assert.deepEqual(plan(original).args,[...selected,...retained]);
  assert.equal(s.setup.argsText,original_text);
  const active=await selection.compiler_choices(context,s);
  assert.equal(active.overridden,true);
  assert.notEqual(active.reason,'explicit');
  assert.deepEqual(active.requestedDefinitions,view.requestedDefinitions);
  assert.equal(active.mode,'cross');
  assert.deepEqual(plan([...original,'-DOTHER=2']).args,[...selected,...retained,'-DOTHER=2']);
  const revised=original.map(arg=>arg.replace('prior-cpu-','edited-cpu-'));
  s.setup.argsText=revised.join('\n');
  assert.deepEqual(plan(revised).args,revised);
  assert.equal((await selection.compiler_choices(context,s)).overridden,false);
  await selection.forget_changed_choices(context,s,revised);
  s.setup.argsText=original_text;
  assert.deepEqual(plan(original).args,original);
  await selection.select_compiler(context,s,'sdk:gnu',view.scope);
  assert.deepEqual(plan(original).args,['-DZEPHYR_TOOLCHAIN_VARIANT=zephyr/gnu',...retained]);
  await selection.select_compiler(context,s,'auto',view.scope);
  assert.deepEqual(plan(original).args,original);
  assert.equal(s.setup.argsText,original_text);
});

test('a manually selected external GCC inside an SDK retains its selectable row',async t=>{
  const {s,context,gcc,sdk}=await fixture(t);
  await put(sdk,'gnu/arm-zephyr-eabi/bin/powerpc-other-gcc'+exe,host_image);
  const view=await selection.compiler_choices(context,s);
  vscode.window.showInputBox=async()=>catalog.cross_prefix(gcc);
  await selection.choose_external_compiler(context,s,view.scope,true,()=>true);
  const options=(await selection.compiler_choices(context,s)).options;
  const row=options.find(option=>option.selected);
  assert.equal(row.path,gcc);
  assert.equal(row.source,'prefix');
  assert.equal(row.variant,'cross-compile');
  assert.equal(options.filter(option=>option.source!=='sdk' && option.path.startsWith(sdk)).length,1);
});

test('a previous SDK of the same family cannot silently supply the compiler for a new selection',async t=>{
  const {s,context,gcc,root}=await fixture(t);
  const view=await selection.compiler_choices(context,s);
  s.setup.cacheStatus='current';
  s.target.generated=true;
  s.target.cache=new Map([['CMAKE_C_COMPILER',path.join(root,'previous-sdk','arm-zephyr-eabi-gcc'+exe)],
    ['ZEPHYR_TOOLCHAIN_VARIANT','zephyr'],['TOOLCHAIN_VARIANT_COMPILER','gnu']]);
  await selection.select_compiler(context,s,'sdk:gnu',view.scope);
  assert.ok(selection.compiler_request(context,s,s.setup,[]).conflict);
  s.target.cache.set('CMAKE_C_COMPILER',gcc);
  assert.ok(!selection.compiler_request(context,s,s.setup,[]).conflict);
  s.setup.cacheStatus='absent';
  assert.ok(!selection.compiler_request(context,s,s.setup,[]).conflict);
});

test('manual prefixed GCC selection checks the host executable, file prefix and target scope',async t=>{
  const {s,context,cross}=await fixture(t);
  const view=await selection.compiler_choices(context,s);
  vscode.window.showInputBox=async()=>'arm-none-eabi-';
  assert.ok(await selection.choose_external_compiler(context,s,view.scope,true,()=>true));
  const picked=await selection.compiler_choices(context,s);
  assert.equal(picked.mode,'cross');
  assert.equal(picked.options.find(row=>row.selected).path,cross);
  vscode.window.showInputBox=async()=>'gcc';
  await assert.rejects(selection.choose_external_compiler(context,s,view.scope,true,()=>true),/tool prefix/);
  assert.ok(!catalog.cross_prefix(path.join(s.build.fsPath,'arm-none-eabi-clang'+exe)));
  assert.ok(!catalog.cross_prefix(path.join(s.build.fsPath,'arm-none-eabi-gcc-14'+exe)));
  const saved=s.setup.board;
  vscode.window.showInputBox=async()=>{s.setup.board='another';return 'arm-none-eabi-';};
  assert.ok(!await selection.choose_external_compiler(context,s,view.scope,true,()=>true));
  s.setup.board=saved;
  s.setup.cacheStatus='current';
  s.target.generated=true;
  s.target.cache=new Map([['CMAKE_C_COMPILER',cross],['ZEPHYR_TOOLCHAIN_VARIANT','cross-compile']]);
  await selection.select_compiler(context,s,'auto',view.scope);
  assert.equal((await selection.compiler_choices(context,s)).variant,'zephyr');
  await selection.select_compiler(context,s,'auto',view.scope);
  assert.ok(selection.compiler_request(context,s,s.setup,[]).conflict);
  s.build=uri(s.build.fsPath+'-fresh');
  assert.deepEqual(selection.compiler_request(context,s,s.setup,[]).args,[]);
});

test('conditional SDK triplets remain unknown until their Kconfig conditions are known',()=>{
  const script='if(CONFIG_ISA_ARCV3)\nset(CROSS_COMPILE_TARGET_arc arc64-zephyr-elf)\nelse()\nset(CROSS_COMPILE_TARGET_arc arc-zephyr-elf)\nendif()';
  assert.equal(catalog.sdk_triplet(script,{arch:'arc'}),undefined);
  assert.equal(catalog.sdk_triplet(script,{arch:'arc',config:new Map()}),'arc-zephyr-elf');
  assert.equal(catalog.sdk_triplet(script,{arch:'arc',config:new Map([['CONFIG_ISA_ARCV3','y']])}),'arc64-zephyr-elf');
});

test('SDK version constraints and recorded SDK family remain visible to discovery',async t=>{
  assert.ok(catalog.incompatible_sdk('find_package(Zephyr-sdk 1.0)','','0.17.1'));
  assert.ok(!catalog.incompatible_sdk('find_package(Zephyr-sdk 0.16...<0.18)','','0.17.1'));
  assert.ok(catalog.incompatible_sdk('find_package(Zephyr-sdk 0.16...<0.18)','','0.18'));
  assert.ok(catalog.incompatible_sdk('find_package(Zephyr-sdk 0.16)','set(ZEPHYR_SDK_MINIMUM_COMPATIBLE_VERSION 1.0)','1.0.1'));
  const {s,context,sdk,base}=await fixture(t);
  const clang=await put(sdk,'llvm/bin/clang'+exe,host_image);
  s.setup.cacheStatus='current';
  s.target.generated=true;
  s.target.cache=new Map([['CMAKE_C_COMPILER',clang],['ZEPHYR_TOOLCHAIN_VARIANT','zephyr'],['TOOLCHAIN_VARIANT_COMPILER','llvm']]);
  const cached=await selection.compiler_choices(context,s);
  assert.equal(cached.variant,'zephyr/llvm');
  assert.equal(cached.recommendedId,'sdk:llvm');
  assert.equal(cached.configured,clang);
  await put(base,'cmake/modules/FindHostTools.cmake','find_package(Zephyr-sdk 5.0)');
  const incompatible=await selection.compiler_choices(context,s);
  assert.equal(incompatible.reason,'unsupported');
  assert.ok(!incompatible.options.some(row=>row.source==='sdk'));
});

test('a warm compiler scan observes a replaced or removed binary and a different search path', async t => {
  const {s,context,cross,root} = await fixture(t);
  const paths = async () => (await selection.compiler_choices(context,s)).options.map(row=>row.path);
  assert.ok((await paths()).includes(cross));
  await fs.writeFile(cross,'invalid');
  assert.ok(!(await paths()).includes(cross));
  await fs.writeFile(cross,host_image);
  assert.ok((await paths()).includes(cross));
  await fs.rm(cross);
  assert.ok(!(await paths()).includes(cross));
  const custom = await put(root,'custom/compiler/arm-new-gcc'+exe,host_image);
  s.environment.PATH=path.dirname(custom);
  assert.ok((await paths()).includes(custom));
});
