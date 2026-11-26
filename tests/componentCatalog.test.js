'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {sources,linuxManager,hostPlan,installerHost,localPackage,sdkVersion,fullSdkBundles,listedSdk}=require('../extension/componentCatalog');

test('host package manager uses exact platform package IDs and native installer locations',()=>{
  assert.equal(linuxManager('ID=linuxmint\nID_LIKE="ubuntu debian"'),'apt');
  assert.equal(linuxManager('ID=fedora\n'),'dnf');
  assert.equal(linuxManager('ID=arch\n'),undefined);
  assert.deepEqual(hostPlan('dtc','apt'),{program:'apt-get',args:['install','device-tree-compiler']});
  assert.deepEqual(hostPlan('python','apt').args,['install','python3','python3-venv','python3-dev','python3-tk']);
  assert.deepEqual(hostPlan('dtc','dnf').args,['install','dtc']);
  assert.deepEqual(hostPlan('git','winget','custom path').args,
    ['install','--exact','--id','Git.Git','--source','winget','--location','custom path']);
  assert.equal(hostPlan('dtc','winget','custom path').args.includes('--location'),false);
  assert.equal(hostPlan('constructor','apt'),undefined);
  assert.equal(sdkVersion('1.0.1'),true);
  assert.equal(sdkVersion('../release'),false);
  assert.equal(listedSdk('1.0.0:\n  path: elsewhere\n1.0.1:\n  path: a custom sdk\r\n','1.0.1'),'a custom sdk');
  assert.equal(listedSdk('1.0.0:\n  path: elsewhere\n','1.0.1'),undefined);
  assert.ok(Object.values(sources).every(url=>new URL(url).protocol==='https:'));
});

test('native installation routes stay available with or without a package manager',()=>{
  const mac=installerHost('darwin');
  assert.equal(mac.manager,'brew');
  assert.deepEqual(mac.formats,['pkg','dmg']);
  assert.deepEqual(hostPlan('python','brew'),{program:'brew',args:['install','python3','python-tk']});
  assert.deepEqual(hostPlan('cmake','brew'),{program:'brew',args:['install','cmake']});
  assert.deepEqual(localPackage('/Volumes/My SDK/Tool.pkg','pkg',false),
    {program:'sudo',args:['/usr/sbin/installer','-pkg','/Volumes/My SDK/Tool.pkg','-target','/']});
  assert.deepEqual(localPackage('/tmp/CMake.dmg','dmg',false),{program:'/usr/bin/open',args:['/tmp/CMake.dmg']});
  const windows=installerHost('win32');
  assert.deepEqual(windows.formats,['msi','exe']);
  assert.ok(windows.help.includes('microsoft.com'));
  const ubuntu=installerHost('linux','ID=ubuntu');
  assert.deepEqual(ubuntu,{manager:'apt',formats:['deb']});
  assert.deepEqual(localPackage('/tmp/my package.deb','deb',false),{program:'sudo',args:['apt-get','install','/tmp/my package.deb']});
  assert.deepEqual(installerHost('linux','ID=arch'),{formats:[]});
});

test('official full SDK selection respects Intel, Apple Silicon and release-specific availability',()=>{
  const names=['zephyr-sdk-1.0.1_macos-aarch64_gnu.tar.xz','zephyr-sdk-1.0.1_macos-aarch64_minimal.tar.xz',
    'zephyr-sdk-1.0.1_linux-x86_64_llvm.tar.xz','zephyr-sdk-1.0.1_windows-x86_64_gnu.7z',
    'zephyr-sdk-0.17.4_macos-x86_64.tar.xz'];
  assert.deepEqual(fullSdkBundles(names,'1.0.1','macos-x86_64'),[]);
  for(const [version,host,index] of [
    ['1.0.1','macos-aarch64',0],['1.0.1','linux-x86_64',2],['1.0.1','windows-x86_64',3],['0.17.4','macos-x86_64',4]
  ])assert.deepEqual(fullSdkBundles(names,version,host),[names[index]]);
});
