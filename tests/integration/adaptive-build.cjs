'use strict';

// Opt in from a Zephyr development shell. Optional case IDs select individual comparisons.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {run,shell,host,refresh, workspace_state, uri, yaml} = require('./adaptive-build-host.cjs');
const {fixtures} = require('./adaptive-build-fixtures.cjs');

async function evidence(dir) {
  const cmake = yaml.load(await fs.readFile(path.join(dir, 'build_info.yml'), 'utf8')).cmake;
  const read = file => fs.readFile(path.join(dir, 'zephyr', file));
  const [elf, config, merged] = await Promise.all([read('zephyr.elf'), read('.config'), read('zephyr.dts')]);
  assert.equal(elf.subarray(0,4).toString(), '\x7fELF');
  const resolved = (record, base) => (record || []).map(file => path.resolve(base, file));
  return {
    board:cmake.board.name, qualifiers:cmake.board.qualifiers, machine:elf.readUInt16LE(18),
    stack:Number(/^CONFIG_MAIN_STACK_SIZE=(\d+)$/m.exec(config.toString())?.[1]),
    conf:resolved(cmake.kconfig['user-files'], cmake.application['configuration-dir']),
    dts:resolved(cmake.devicetree.files, cmake.application['source-dir']),
    model:/^\s*model\s*=\s*"([^"]+)";/m.exec(merged.toString())?.[1]
  };
}

function check_case(test, stage, result) {
  assert.equal(result.board, test.expectedBoard);
  assert.equal(result.machine, test.machine);
  if (stage === 'manual') {
    assert.deepEqual(result.conf, test.manual.conf);
    assert.deepEqual(result.dts.slice(1), test.manual.overlays);
    assert.equal(result.stack, 3072);
    assert.equal(result.model, 'variant');
    return;
  }
  if (test.stack) assert.equal(result.stack, test.stack);
  if (test.empty) assert.deepEqual(result.conf, []);
  if (test.conf) assert.ok(result.conf.some(file => path.basename(file) === test.conf));
  if (test.overlayCount !== undefined) assert.equal(result.dts.length - 1, test.overlayCount);
  if (test.overlay) assert.ok(result.dts.some(file => path.basename(file) === test.overlay));
  if (test.model) assert.equal(result.model, test.model);
  if (test.baseDts) assert.equal(path.basename(result.dts[0]), test.baseDts);
}

async function baseline(test, root, env, west, cwd, stage) {
  // Fresh native build trees give an independent oracle when checking reset of a reused extension tree.
  const dir = path.join(root, test.id + '-native-' + stage);
  const flags = (test.args || []).map(value => '-D' + value);
  if (stage === 'manual') {
    const list = files => files.map(file => file.split(path.sep).join('/')).join(';');
    flags.push('-DCONF_FILE=' + list(test.manual.conf), '-DDTC_OVERLAY_FILE=' + list(test.manual.overlays));
  }
  const useWest = test.method === 'west';
  const board = test.board ? (useWest ? ['-b',test.board] : ['-DBOARD=' + test.board]) : [];
  const command = useWest ? west : 'cmake';
  const configure = useWest ? ['build','--cmake-only',...board,'-d',dir,test.app,...(flags.length ? ['--',...flags] : [])] :
    ['-G','Ninja','-S',test.app,'-B',dir,...board,...flags];
  const log = dir + '.log';
  await run(command, configure, cwd, env, log);
  await run(command, useWest ? ['build','-d',dir,'-o=-j4'] : ['--build',dir,'--parallel','4'], cwd, env, log);
  const result = await evidence(dir);
  check_case(test,stage,result);
  console.log('Native PASS', test.id, stage);
  return result;
}

async function from_workbench(test, root, env, tools, cwd, stages) {
  const ctx = workspace_state(), dir = path.join(root, test.id + '-extension');
  const s = {folder:{uri:uri(test.app)}, build:uri(dir), application:test.app, environment:env,
    tools, saved:{}, manifest:{root:uri(cwd),uri:uri(path.join(env.ZEPHYR_BASE,'west.yml')),projects:[]}};
  await host.applyChoice(ctx,s,'board',test.board);
  await host.save_parallelism(ctx,s,'4');
  s.setup = {board:test.board, app:test.app};
  if (test.args?.length) await host.saveArguments(ctx,s,test.args.join('\n'));
  const results = {};
  for (const stage of stages) {
    await refresh(ctx, s, test.method);
    if (stage === 'manual' || stage === 'restored') {
      for (const [kind,files] of [['kconfig',test.manual.conf],['overlay',test.manual.overlays]]) {
        assert.ok(await host.selectFiles(ctx,s,kind,stage === 'manual' ? files : null));
      }
      await refresh(ctx,s,test.method);
    }
    const setup = s.setup;
    assert.ok(setup.canConfigure, test.id + ' ' + stage + ' configure blocked ' + JSON.stringify(setup.readiness));
    const log = dir + '.log', taskEnv = host.taskEnvironment(ctx,s);
    await run(setup.plan.executable,setup.plan.configure,cwd,taskEnv,log);
    await host.acknowledgeFileReset(ctx,setup.fileReset);
    await refresh(ctx,s,test.method);
    assert.ok(s.setup.canBuild,test.id + ' ' + stage + ' build blocked ' + JSON.stringify(s.setup.readiness));
    await run(s.setup.plan.executable,s.setup.plan.build,cwd,taskEnv,log);
    results[stage] = await evidence(dir);
    check_case(test,stage,results[stage]);
    assert.deepEqual(s.target.confirmedInputs.kconfig || [], results[stage].conf, 'Workbench Kconfig evidence');
    assert.deepEqual(s.configurationFiles.dts.files, results[stage].dts.slice(0,1), 'Workbench board DTS evidence');
    console.log('Workbench PASS',test.id,stage);
  }
  return results;
}

async function compare(test, root, tools, cwd) {
  const env = {...process.env,...test.env};
  delete env.BOARD;
  const stages = test.manual ? ['automatic','manual','restored'] : ['automatic'];
  const native = (async () => {
    const result = {};
    for (const stage of stages) result[stage] = stage === 'restored' ? result.automatic :
      await baseline(test,root,env,tools.west,cwd,stage);
    return result;
  })();
  const [a, b] = await Promise.allSettled([native,from_workbench(test,root,env,tools,cwd,stages)]);
  for (const [label, outcome] of [['native', a], ['extension', b]]) {
    if (outcome.status === 'rejected') console.error(test.id, label, outcome.reason.message);
    else await fs.writeFile(path.join(root,test.id + '-' + label + '.json'),JSON.stringify(outcome.value,null,2));
  }
  assert.equal(a.status,'fulfilled',test.id + ' native baseline failed');
  assert.equal(b.status,'fulfilled',test.id + ' workbench failed');
  assert.deepEqual(b.value,a.value);
}

async function main() {
  const {base,cwd,tools} = shell();
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'zephyr-adaptive-'));
  console.log('Evidence:', root);
  const selected = process.argv.slice(2);
  const cases = (await fixtures(root,base)).filter(test => !selected.length || selected.includes(test.id));
  assert.ok(cases.length, 'No matching cases');
  const failures = [];
  for (const test of cases) {
    try { await compare(test,root,tools,cwd); }
    catch (error) { failures.push(error.message); }
  }
  assert.deepEqual(failures,[]);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
