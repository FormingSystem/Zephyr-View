'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function controls() {
  const listeners = {};
  const module = {exports:{}};
  const file = require.resolve('../design/toolchain-controls');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    module, ZephyrPathDisplay:require('../design/pathDisplay'), tr:(_, english)=>english, esc:String, b:(label, action)=>action+label,
    document:{addEventListener:(type, handler)=>{listeners[type]=handler;}}
  }, {filename:file});
  return {...module.exports, listeners};
}

test('choosing a target compiler is explicit and original CMake definitions remain visible', () => {
  const {compiler_selection, listeners} = controls();
  const submitted = [];
  const picker = new compiler_selection((scope, id)=>submitted.push([scope, id]));
  const sdk = {id:'sdk:gnu', source:'sdk', label:'SDK GCC', path:'/sdk/bin/gcc', compatibility:'sdk'};
  const cross = {id:'external', source:'path', label:'External GCC', path:'/local/bin/gcc', compatibility:'unverified'};
  const state = {trusted:true, folder:'app', compilerChoices:{scope:'target-a', mode:'sdk', recommendedId:sdk.id, options:[sdk,cross]}};
  assert.match(picker.render(state), /Local recommendation.*SDK architecture component/);
  const select = {value:cross.id}, apply = {}, path = {};
  const form = {querySelector:key=>({'select':select,'[data-apply-compiler]':apply,'[data-compiler-path]':path})[key]};
  picker.change(form);
  assert.match(path.innerHTML, /Compatibility unverified/);
  assert.deepEqual(submitted, []);
  assert.match(picker.render({...state, compilerChoices:{...state.compilerChoices, scope:'target-b'}}), /value="auto" selected/);
  assert.match(picker.render(state), /value="external" selected/);
  listeners.click({target:{closest:key=>key==='[data-apply-compiler]'?{closest:()=>form}:null}});
  assert.deepEqual(submitted, [['target-a','external']]);
  const explicit = picker.render({...state, compilerChoices:{...state.compilerChoices, reason:'explicit', requested:'CMAKE_C_COMPILER=custom'}});
  assert.match(explicit, /value="external" selected/);
  assert.match(explicit, /CMAKE_C_COMPILER=custom/);
  assert.doesNotMatch(explicit, /data-target-compiler="compilerBrowse" disabled|Local recommendation/);
  const saved = picker.render({...state, compilerChoices:{...state.compilerChoices, overridden:true, options:[sdk,{...cross,selected:true}],
    requested:'CMAKE_C_COMPILER=custom', requestedDefinitions:['CMAKE_C_COMPILER=custom','CROSS_COMPILE=private-']}});
  assert.match(saved, /Selected for this target/);
  assert.match(saved, /Original project definitions/);
  assert.match(saved, /CMAKE_C_COMPILER=custom\nCROSS_COMPILE=private-/);
  select.value = 'auto';
  picker.change(form);
  assert.equal(apply.disabled, false);
  assert.equal(path.innerHTML, '');
  listeners.click({target:{closest:key=>key==='[data-apply-compiler]'?{closest:()=>form}:null}});
  assert.deepEqual(submitted.at(-1), ['target-a','auto']);
});

test('CMake readback shares a path only when the host confirms the displayed candidate was used', () => {
  const {compiler_selection} = controls();
  const picker = new compiler_selection();
  const old = {id:'sdk', label:'SDK GCC', path:'/sdk/gcc', compatibility:'configured'};
  const other = {id:'other', label:'External GCC', path:'/other/gcc', compatibility:'architecture'};
  const state = {trusted:true, folder:'app', compilerChoices:{scope:'A', configured:old.path, recommendedId:old.id, options:[old,other]}};
  const confirmed = picker.render(state);
  assert.equal(confirmed.split(old.path).length-1, 1);
  assert.match(confirmed, /Matches last configuration · CMAKE_C_COMPILER/);
  const draft = picker.path('other');
  assert.match(draft, /\/other\/gcc.*Last configured · CMAKE_C_COMPILER.*\/sdk\/gcc/);
  // Matching text without the host's configured evidence cannot merge a candidate and a readback.
  other.path=old.path;
  assert.equal(picker.path('other').split(old.path).length-1, 2);
});

test('optional roots and historical tool prefixes stay discoverable without requiring either', () => {
  const {external_prefix_details, board_root_details} = controls();
  const state = {folder:'app', trusted:true, compilerChoices:{mode:'sdk'}, environmentRows:[]};
  assert.equal(external_prefix_details(state), '');
  const board = board_root_details(state);
  assert.match(board, /<details[^>]*><summary>Custom board directories/);
  assert.match(board, /Built-in boards are discovered automatically/);
  assert.doesNotMatch(board, /Unset|Required|Missing/);
  const root = '/support';
  const roots = board_root_details({...state, extraRoots:[root],
    environmentRows:[{name:'BOARD_ROOT', value:root, cached:root, source:'override'}],
    buildVariables:{rows:[{name:'BOARD_ROOT', planned:{source:'-D', value:root}}]}});
  assert.equal(roots.match(/<code>\/support<\/code>/g).length, 1);
  assert.match(roots, /-DBOARD_ROOT.*Last configured/);
  const legacy = external_prefix_details({...state, overrides:['CROSS_COMPILE'],
    environmentRows:[{name:'CROSS_COMPILE', value:'tools/arm-', source:'override', cached:'original/arm-'}]});
  assert.match(legacy, /tools\/arm-/);
  assert.match(legacy, /original\/arm-/);
  assert.match(legacy, /setup:inherit:CROSS_COMPILE/);
  assert.doesNotMatch(legacy, /setup:edit:CROSS_COMPILE/);
});

test('compiler paths and root labels use forward slashes while selection and removal keep the host value', () => {
  const {compiler_selection,board_root_details}=controls();
  const root='C:\\工具\\boards';
  const gcc='D:\\SDK\\bin\\gcc.exe';
  const options=[{id:gcc,path:gcc,label:'GCC'},{id:'another',path:'C:\\sdk\\gcc.exe',label:'GCC'}];
  const html=new compiler_selection().render({folder:'app',trusted:true,compilerChoices:{scope:'s',options,recommendedId:gcc}});
  assert.ok(html.includes('value="'+gcc+'"'));
  assert.ok(html.includes('GCC · D:/SDK/bin/gcc.exe'));
  assert.ok(html.includes('<code>D:/SDK/bin/gcc.exe</code>'));
  const roots=board_root_details({extraRoots:[root],environmentRows:[{name:'BOARD_ROOT',cached:'C:/工具/boards'}]});
  assert.equal(roots.split('<code>C:/工具/boards</code>').length-1,1);
  assert.ok(roots.includes('data-remove-board-root="'+root+'"'));
});
