'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const display = require('../design/pathDisplay');

test('Windows labels use one separator while retaining shares, spaces and relative roots', () => {
  for (const [raw, expected] of [
    [String.raw`G:\Zephyr SDK/gnu\bin`, 'G:/Zephyr SDK/gnu/bin'],
    [String.raw`..\本地模块\hal`, '../本地模块/hal'],
    [String.raw`\\build-server\SDK Share\bin`, '//build-server/SDK Share/bin'],
    ['.', '.'], ['G:\\', 'G:/'], ['samples/hello_world', 'samples/hello_world']
  ]) {
    assert.equal(display.path(raw, 'win32'), expected);
    assert.equal(display.path(expected, 'win32'), expected);
  }
});

test('relative labels match complete path components in both build and configuration views', () => {
  assert.equal(display.relative('\\\\Server\\Share\\App Dir\\PRJ.conf', '//server/share/app dir', 'win32'), 'PRJ.conf');
  assert.equal(display.relative('D:/app2/src', 'D:/app', 'win32'), 'D:/app2/src');
  assert.equal(display.relative('/opt/App/src', '/opt/app', 'linux'), '/opt/App/src');
  assert.equal(display.relative('/app/src', '/', 'linux'), 'app/src');
});

test('POSIX filename characters and remote repository addresses retain their meaning', () => {
  for (const path of ['/opt/zephyr sdk', 'app\\name/prj.conf', '/opt/app\\name']) {
    assert.equal(display.path(path, 'linux'), path);
  }
  for (const url of ['https://git.example/repo?ref=a\\b', 'git@example.org:a\\b', 'file:///share/a%20b']) {
    assert.equal(display.path(url, 'win32'), url);
  }
});

test('path-bearing Zephyr and typed CMake values keep list separators and escaped semicolons', () => {
  const list = 'C:\\Apps One\\prj.conf;..\\extras\\a\\;b.conf';
  assert.equal(display.variable('CONF_FILE', list, 'STRING', 'win32'), 'C:/Apps One/prj.conf;../extras/a\\;b.conf');
  assert.equal(display.variable('MY_INPUT', 'boards\\abc.dts', 'FILEPATH', 'win32'), 'boards/abc.dts');
  assert.equal(display.variable('CROSS_COMPILE', 'C:\\SDK\\arm-', '', 'win32'), 'C:/SDK/arm-');
  for (const name of ['MY_REGEX', 'BOARD', 'SHIELD', 'CMAKE_C_FLAGS']) {
    assert.equal(display.variable(name, 'a\\b', 'STRING', 'win32'), 'a\\b');
  }
});
