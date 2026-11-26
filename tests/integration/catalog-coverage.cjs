'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const path = require('node:path');
const {boardDts, boardTargets, readBoards} = require('../../extension/boardCatalog');
const {readPlatformArchitectures} = require('../../extension/platformArchitecture');
const {discoverApplications} = require('../../extension/applicationCatalog');

function increment(counts, key) { counts[key] = (counts[key] || 0) + 1; }

async function auditBoards(base, boards, arches, officialDts) {
  const architectures = {}, dts = {}, missing = [], mismatches = [];
  const stub = path.join(base, 'boards', 'common', 'stub.dts');
  for (const board of boards) {
    const architecture = await readPlatformArchitectures(board);
    for (const target of boardTargets([board])) {
      const actual = architecture(target);
      if ((actual || null) !== (arches[target] || null)) mismatches.push({target, actual, twister: arches[target]});
      increment(architectures, actual || 'unknown');
      const resolved = await boardDts(board, target);
      assert.equal(path.normalize(officialDts[target]), resolved.boardFile || stub,
        'Board source differs from dts_configuration_files(): ' + target);
      const status = resolved.boardFile ? 'detected' : resolved.detectionStatus === 'notFound' ? 'cmakeStub' : resolved.detectionStatus;
      increment(dts, status);
      if (status !== 'detected') missing.push({target, status});
    }
  }
  assert.deepEqual(mismatches, [], 'Architecture differs from the checkout’s Twister platform');
  return {architectures, dts, ...(process.argv.includes('--details') && {unresolvedDts: missing})};
}

async function auditSamples(base, descriptors) {
  const root = path.join(base, 'samples');
  const applications = await discoverApplications([root], base);
  const paths = new Set(applications.map(dir => path.relative(base, dir).split(path.sep).join('/')));
  const standalone = descriptors.filter(sample => sample.cmake);
  assert.deepEqual(standalone.filter(sample => !paths.has(sample.path)), [], 'Unlisted sample directories');
  const metadata = new Set(standalone.map(sample => sample.path));
  return {descriptors: descriptors.length, withCMake: standalone.length, withoutCMake: descriptors.length - standalone.length,
    discovered: paths.size, additional: [...paths].filter(dir => !metadata.has(dir)).length,
    withoutPrjConf: standalone.filter(sample => !sample.defaultConf).length,
    multipleTopLevelConf: standalone.filter(sample => sample.confFiles > 1).length,
    multipleTopLevelOverlays: standalone.filter(sample => sample.overlays > 1).length};
}

async function main() {
  assert.ok(process.env.ZEPHYR_BASE, 'Set ZEPHYR_BASE and use the selected checkout’s Python environment.');
  const base = path.resolve(process.env.ZEPHYR_BASE);
  const env = {...process.env, ZEPHYR_BASE: base, PYTHONDONTWRITEBYTECODE: '1'};
  const workspace = process.argv.includes('--workspace');
  const python = env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const options = {cwd: base, env, windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024};
  const ref = path.join(__dirname, 'catalog_reference.py');
  const {arches, samples, dts} = JSON.parse(execFileSync(python, ['-B', ref, ...(workspace ? ['--workspace'] : [])], options));
  const snapshot = {setup: {app: base}, target: {cache: new Map()}, folder: {uri: {fsPath: base}},
    tools: {python, west: workspace}, manifest: {root: workspace}};
  const roots = {board_root: [], soc_root: [], arch_root: []};
  const boards = await readBoards(snapshot, env, undefined, roots);
  const targets = boardTargets(boards);
  assert.equal(new Set(targets).size, targets.length, 'Duplicate catalog targets');
  let westTargets;
  if (workspace) {
    const official = execFileSync(python, ['-m', 'west', 'boards', '--all-targets'], options);
    const listed = official.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    westTargets = listed.length;
    assert.deepEqual(new Set(targets), new Set(listed.map(name => name.replace(/@(?=\/|$)/, ''))), 'west and CMake catalogs differ');
  }
  const result = {commit: execFileSync('git', ['rev-parse', 'HEAD'], options).trim(), workspace, westTargets,
    boards: boards.length, socs: new Set(boards.flatMap(board => board.socs)).size,
    boardsWithCpuClusters: boards.filter(board => board.cpuClusters?.length).length,
    revisionQualified: targets.filter(target => target.includes('@')).length, targets: targets.length,
    ...await auditBoards(base, boards, arches, dts), samples: await auditSamples(base, samples)};
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
