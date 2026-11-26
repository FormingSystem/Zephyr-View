'use strict';

const assert=require('node:assert/strict');
const {test}=require('node:test');
const {plan}=require('../extension/media/flashPlan');
const {imageDomains}=require('../extension/sysbuild');
const path=require('node:path');
const {yaml}=require('./integration/adaptive-build-host.cjs');

const image=(name,primary)=>({name,dir:'out/'+name,board:'board/'+name,
  runners:['jlink','nrfutil'],defaultRunner:primary,deviceIds:{},files:[{file:name+'.hex'}]});
const model={order:['remote','app'],images:[image('app','jlink'),image('remote','nrfutil'),image('test','jlink')],
  caps:{jlink:{device:true},nrfutil:{device:true}},root:'out',west:'west',noRebuild:'--no-rebuild',system:true,domainFlag:true};
const serial='12345678';

test('board flash defaults and sysbuild flash order survive a multi-image preview',()=>{
  const result=plan(model,{device:serial});
  assert.deepEqual(result.names,['nrfutil','jlink']);
  assert.deepEqual(result.images.map(i=>i.name),['remote','app']);
  assert.deepEqual(result.args,['flash','-d','out','--no-rebuild','--dev-id',serial]);
  assert.deepEqual(plan(model,{domain:'remote',runner:'jlink',device:serial}).args,
    ['flash','-d','out','--no-rebuild','--domain','remote','-r','jlink','--dev-id',serial]);
  assert.deepEqual(plan(model,{domain:'test'}).args,['flash','-d','out','--no-rebuild','--domain','test']);
  assert.equal(plan(model,{domain:'unknown'}).issue,'runner');
});

test('blank device delegates to the runner; manual probe names remain one argument',()=>{
  assert.deepEqual(plan(model,{}).args,['flash','-d','out','--no-rebuild']);
  for (const device of ['/dev/serial/by-id/探针 A','probe one','设备一'])
    assert.deepEqual(plan(model,{device}).args.slice(-2),['--dev-id',device]);
  for (const device of ['*', '--erase', '000*','one\ntwo']) assert.equal(plan(model,{device}).issue,'device');
  assert.equal(plan(model,{runner:'unknown',device:serial}).issue,'runner');
  const broken={...model,images:[{...model.images[1],files:[]},model.images[0]]};
  assert.equal(plan(broken,{device:serial}).issue,'image');
  assert.equal(plan({...model,west:undefined},{device:serial}).issue,'west');
  const mixed={...model,caps:{...model.caps,jlink:{device:false}}};
  assert.equal(plan(mixed,{device:serial}).issue,'mixed');
  assert.ok(plan(mixed,{}).args);
  const direct=plan(mixed,{domain:'app'});
  assert.ok(direct.args);
  assert.ok(!direct.args.includes('--dev-id'));
});

test('board-pinned probes reject competing IDs and do not append the same ID twice',()=>{
  const single={...model,order:['app'],system:false,
    images:[{...model.images[0],deviceIds:{jlink:[serial]}}]};
  assert.equal(plan(single,{device:'another'}).issue,'pinned');
  assert.deepEqual(plan(single,{device:serial}).args,['flash','-d','out','--no-rebuild']);
});

test('legacy CLI uses single-image directories and does not invent a sysbuild invocation',()=>{
  const legacy={...model,domainFlag:false,noRebuild:undefined};
  assert.equal(plan(legacy,{device:serial}).issue,'domain');
  assert.deepEqual(plan(legacy,{domain:'remote',device:serial}).args,['flash','-d','out/remote','--dev-id',serial]);
});

test('explicit host program from probe setup reaches both preview and execution as one argument',()=>{
  const program='local tool/JLinkExe',caps={...model.caps,jlink:{device:true,toolOption:'--commander'}};
  const configured={...model,caps,tools:{jlink:program}};
  const result=plan(configured,{domain:'app',device:serial});
  assert.deepEqual(result.args.slice(-4),['--commander',program,'--dev-id',serial]);
  assert.ok(!plan(configured,{device:serial}).args.includes('--commander'));
});

test('domains.yaml must declare its flash order explicitly and can omit build-only images',()=>{
  const root=path.resolve('system'),domains=['app','remote','test'].map(name=>({name,build_dir:path.join(root,name)}));
  const parse=order=>imageDomains(yaml.dump({default:'app',build_dir:root,domains,flash_order:order}),root).flashOrder;
  assert.deepEqual(parse(['remote','app']),['remote','app']);
  assert.deepEqual(parse([]),[]);
  assert.equal(parse(['missing']),undefined);
  assert.equal(parse(['remote','remote']),undefined);
});
