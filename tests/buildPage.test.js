'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {build_prerequisites} = require('../extension/media/buildControls');
const {build_invocation, build_path_label, build_view_state} = require('../design/build-panel');

test('the selected operation checks its own blockers and respects folder and workspace trust', () => {
  const state = {folder:'demo', trusted:true, readiness:{configure:['board'], build:['board','configureFirst']}};
  assert.deepEqual(build_prerequisites(state, 'configure'), ['board']);
  assert.deepEqual(build_prerequisites(state, 'build'), ['board', 'configureFirst']);
  assert.deepEqual(build_prerequisites({...state, trusted:false}, 'configure'), ['trust', 'board']);
  assert.deepEqual(build_prerequisites({...state, folder:undefined}, 'build'), ['folder']);
});

test('build panels restore their own target state across refresh, board and method switches', () => {
  const view = new build_view_state();
  const state = {folder:'workspace', app:'samples/hello_world', build:'out', board:'board/a', method:'CMake'};
  const first = view.target(state);
  first.open.add('arguments');
  first.action = 'configure';
  assert.deepEqual([...view.target({...state}).open], ['arguments']);
  assert.equal(view.target({...state, board:'board/b'}).action, undefined);
  assert.equal(view.target({...state, method:'west'}).open.size, 0);
  assert.equal(view.target(state).action, 'configure');
});

test('the invocation preserves the actual task directory, executable and argument boundaries', () => {
  const app = 'C:\\My Workspace\\hello_world';
  const plan = {executable:'C:\\Program Files\\CMake\\bin\\cmake.exe',
    configure:['-S', app, '-B', app+'\\build', '-DBOARD=qemu_cortex_m3', '-DMSG=a "b" c', ''],
    build:['--build', app+'\\build']};
  const invocation = build_invocation({folder:app, plan});
  assert.equal(build_path_label(app, app), '.');
  assert.equal(invocation.cwd, app);
  assert.equal(invocation.executable, plan.executable);
  assert.deepEqual(invocation.configure, plan.configure);
  assert.deepEqual(invocation.build, plan.build);
  assert.equal(build_invocation({root:'/trees/west', folder:'/trees/west/app', plan}).cwd, '/trees/west');
  assert.equal(build_path_label('/tmp/application', '/tmp/app'), '/tmp/application');
  assert.equal(build_path_label('C:\\same\\File Name', 'c:\\SAME'), 'File Name');
  assert.equal(build_path_label('C:\\树\\应用/out\\zephyr.elf', 'c:/树/应用/'), 'out/zephyr.elf');
  assert.equal(build_path_label('D:\\out\\zephyr.elf', 'C:/src'), 'D:/out/zephyr.elf');
  assert.equal(build_path_label('\\\\server\\share\\app/out', '\\\\SERVER\\share'), 'app/out');
});

