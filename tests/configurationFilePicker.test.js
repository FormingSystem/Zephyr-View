'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const window = {};
const commits = [];
const load = Module._load;
let choose, check_readiness;
try {
  Module._load = function(name, ...rest) {
    if (name === 'vscode') return {window,Uri:{file: fsPath => ({fsPath})},l10n:{t:key=>key}};
    if (name === './configurationFiles') return {selectFiles: async (_ctx,_state,kind,files) => {
      commits.push({kind,files}); return true;
    }};
    return load.call(this,name,...rest);
  };
  ({choose_configuration_files:choose,apply_file_readiness:check_readiness} = require('../extension/configurationFilePicker'));
} finally { Module._load = load; }

const app = path.resolve('application');
const a = path.join(app,'prj.conf'), b = path.join(app,'profiles','debug.conf');
const absent = path.join(app,'removed.conf');
const state = {setup:{app},configurationFiles:{
  kconfig:{variable:'CONF_FILE',files:[b,a,absent],candidates:[a,b],missing:[absent]},
  dts:{variable:'DTS_SOURCE',files:[],candidates:[],missing:[]}
}};

test('discovery leaves Zephyr in control; only an explicitly selected missing source blocks configuration',()=>{
  const setup = {board:'kit/soc',canBuild:true,canConfigure:true,readiness:{configure:[],build:[]}};
  check_readiness(setup,{
    dts:{source:'automatic',status:'missing',missing:[]},kconfig:{source:'automatic',status:'choose',missing:[]},
    overlay:{source:'argument',status:'missing',missing:['generated.overlay']}
  });
  assert.ok(setup.canConfigure);
  check_readiness(setup,{
    dts:{source:'manual',status:'missing',missing:['vendor.dts']},kconfig:{source:'automatic',status:'choose',missing:[]}
  });
  assert.deepEqual(setup.readiness.configure,['files-dts']);
  assert.deepEqual(setup.readiness.build,setup.readiness.configure);
  assert.equal(setup.canConfigure,false);
});

test('list reopens with the stored order, allows path search, and excludes missing files',async()=>{
  window.createQuickPick = () => ({
    onDidChangeValue(fn) {this.search=fn;}, onDidAccept(fn) {this.accept=fn;},
    onDidHide(fn) {this.hide=fn;}, dispose() {},
    show() {
      assert.equal(this.canSelectMany,true);
      assert.equal(this.matchOnDescription,true);
      assert.deepEqual(this.selectedItems.map(item=>item.file),[b,a]);
      this.search('DBcF');
      assert.deepEqual(this.items.map(item=>item.alwaysShow),[true,false]);
      assert.deepEqual(this.selectedItems.map(item=>item.file),[b,a]);
      this.search('prof\\dbg');
      assert.equal(this.items[0].alwaysShow,true);
      this.selectedItems = [this.items[1]];
      this.accept();
    }
  });
  assert.ok(await choose({},state,{kind:'kconfig',action:'list'},()=>true));
  assert.deepEqual(commits.pop(),{kind:'kconfig',files:[a]});
});

test('native browse allows an external DTS and discards a result if its target changed',async()=>{
  const board = path.resolve('custom-boards','kit.dts');
  let current = true;
  window.showOpenDialog = options => {
    assert.deepEqual(options.filters,{DTS_SOURCE:['dts'],'All files':['*']});
    assert.equal(options.canSelectMany,false);
    current = false;
    return [{fsPath:board}];
  };
  assert.equal(await choose({},state,{kind:'dts',action:'browse'},()=>current),false);
  assert.ok(await choose({},state,{kind:'dts',action:'browse'},()=>true));
  assert.deepEqual(commits.pop(),{kind:'dts',files:[board]});
  assert.equal(commits.length,0);
});

test('cancelling a partially reordered list makes no change',async()=>{
  let count = 0;
  window.showQuickPick = items => ++count === 1 ? items[1] : undefined;
  const snapshot={...state,configurationFiles:{kconfig:{...state.configurationFiles.kconfig,files:[a,b,path.join(app,'final.conf')],missing:[]}}};
  assert.equal(await choose({},snapshot,{kind:'kconfig',action:'order'},()=>true),false);
  assert.equal(commits.length,0);
});
