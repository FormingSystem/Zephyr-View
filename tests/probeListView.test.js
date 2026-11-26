'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function render(row, options = {}) {
  const view = {rows:[row], trusted:true, editable:true, ...options};
  const context = vm.createContext({document:{documentElement:{lang:'en'}}, view,
    ZephyrPathDisplay:require('../design/pathDisplay')});
  for (const script of ['build-context.js','probe-list.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../design',script),'utf8'),context);
  }
  return vm.runInContext('probeListView.render(view)',context);
}
const pyocd = {id:'pyocd',label:'CMSIS-DAP · pyOCD',program:'pyocd',canDeploy:true,
  deployLabel:'Download and install',canDeployDriver:true,driverLabel:'Install USB access rules'};

test('tool, USB device and driver actions are scoped to the same probe',()=>{
  const html = render({...pyocd,selectedPath:'test/tools/pyocd',source:'selected',
    devices:[{name:'DAP <1>',status:'permission',id:'USB1'}]});
  const primary = html.split('<details')[0];
  for (const op of ['directory','deploy','driver']) assert.match(primary,new RegExp('data-act="probe:'+op+':pyocd"'));
  assert.match(html,/Selected path unavailable/);
  assert.match(html,/test\/tools\/pyocd/);
  assert.match(html,/DAP &lt;1&gt;/);
  assert.match(html,/Permission required/);
  assert.match(html,/probe:reset:pyocd/);
  assert.match(html.split('<details')[1],/probe:typedDirectory:pyocd/);
});

test('vendor-only tools offer the download and local installer, and serial needs no program',()=>{
  const vendor=render({id:'stm32cubeprogrammer',label:'ST-LINK',program:'STM32_Programmer_CLI',
    canInstallLocal:true,canInstallLocalDriver:true,devices:[{name:'ST-LINK',status:'driver'}]});
  assert.match(vendor.split('<details')[0],/probe:localInstaller:stm32cubeprogrammer/);
  assert.match(vendor.split('<details')[0],/probe:localDriver:stm32cubeprogrammer/);
  assert.equal(vendor.match(/>Official download</g).length,1);
  assert.doesNotMatch(vendor,/probe:deploy:/);
  const serial=render({id:'serial',label:'UART / CDC ACM',devices:[]});
  assert.match(serial,/System serial port/);
  assert.match(serial,/No matching device/);
  assert.match(serial,/probe:guide:serial/);
  assert.doesNotMatch(serial,/probe:(?:directory|typedDirectory|executable|deploy|localInstaller|download):serial/);
});

test('restricted workspaces retain links and disable changes',()=>{
  const html=render(pyocd,{trusted:false,editable:false});
  assert.match(html,/Trust this workspace/);
  for (const op of ['directory','typedDirectory','deploy','driver']) assert.match(html,new RegExp('data-act="probe:'+op+':pyocd"[^>]* disabled>'));
  for (const op of ['download','guide']) assert.doesNotMatch(html,new RegExp('data-act="probe:'+op+':pyocd"[^>]* disabled>'));
  assert.doesNotMatch(html,/No matching device|Tool not found/);
});

test('driver installation is visible before a probe is connected and vendor links appear only once',()=>{
  const st={id:'stm32cubeprogrammer',label:'ST-LINK',program:'STM32_Programmer_CLI',
    devices:[],canDeployDriver:true,driverLabel:'Download ST-LINK driver',canInstallLocalDriver:true};
  const editable=render(st);
  assert.equal(editable.match(/>Download ST-LINK driver</g).length,1);
  assert.doesNotMatch(editable,/probe:guide:/);
  for(const op of ['driver','localDriver']) assert.match(editable.split('<details')[0],new RegExp('probe:'+op+':stm32cubeprogrammer'));
  const restricted=render(st,{trusted:false,editable:false});
  assert.equal(restricted.match(/>Download ST-LINK driver</g).length,1);
  assert.match(restricted.split('<details')[0],/data-act="probe:guide:stm32cubeprogrammer" class="plain">Download ST-LINK driver/);
  assert.match(restricted.split('<details')[0],/data-act="probe:localDriver:stm32cubeprogrammer"[^>]* disabled>/);
  assert.match(render({...pyocd,devices:[]}).split('<details')[0],/probe:driver:pyocd/);
});

test('a completed tool search can report a missing program while USB detection is pending',()=>{
  const html=render({...pyocd,toolChecked:true},{scanning:true});
  assert.match(html,/Tool not found/);
  assert.match(html,/Detecting local tools and devices/);
  assert.doesNotMatch(html,/No matching device/);
});
