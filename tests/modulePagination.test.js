'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {modulePage} = require('../design/module-pagination');

test('orders the full manifest by name before taking a page and leaves source rows intact', () => {
  const rows = Object.freeze(['hal_xhsc', 'cmsis', 'AcpiCa', 'cmsis-dsp', 'CMSIS']
    .map((name, index) => Object.freeze({name, index})));
  const first = modulePage(rows, {pageSize: 2});
  assert.deepEqual(first.items, [rows[2], rows[1]]);
  assert.deepEqual(first.letters, ['A', 'C', 'H']);
  const second = modulePage(rows, {pageSize: 2, page: 2});
  assert.deepEqual(second.items, [rows[4], rows[3]]);
  assert.deepEqual([second.first, second.last, second.pages, second.total], [3, 4, 3, 5]);
  assert.equal(modulePage(rows, {page: 99, pageSize: 2}).items[0], rows[0]);
});

test('jumping to an initial pages only matching search results; clearing it restores the whole list', () => {
  const rows = ['mbedtls', 'hal_stm32', 'hal_nordic', 'hal_atmel', 'lvgl'];
  const options = {nameOf: name => name, letter: 'H', pageSize: 2};
  assert.deepEqual(modulePage(rows, options).items, ['hal_atmel', 'hal_nordic']);
  const next = modulePage(rows, {...options, page: 2});
  assert.deepEqual(next.items, ['hal_stm32']);
  assert.deepEqual([next.first, next.last, next.total], [3, 3, 3]);
  const fewer = rows.filter(name => name !== 'hal_stm32');
  assert.equal(modulePage(fewer, {...options, page: 2}).page, 1);
  assert.equal(modulePage(rows, {...options, letter: ''}).total, 5);
  const changedSearch = modulePage(['lvgl', 'mbedtls'], {...options, page: 2});
  assert.deepEqual([changedSearch.letter, changedSearch.page, changedSearch.letters], ['', 1, ['L', 'M']]);
});

test('all module names remain reachable through the initial index, including digits and non-Latin names', () => {
  const rows = ['中文模块', '_private', 'Éther', 'module2', 'module10', '2g', '10g'];
  const options = {nameOf: name => name};
  const all = modulePage(rows, options);
  assert.deepEqual(all.letters, ['0–9', 'E', 'M', '#']);
  assert.deepEqual(modulePage(rows, {...options, letter:'0–9'}).items, ['10g', '2g']);
  assert.deepEqual(modulePage(rows, {...options, letter:'E'}).items, ['Éther']);
  assert.deepEqual(modulePage(rows, {...options, letter:'M'}).items, ['module10', 'module2']);
  assert.deepEqual(new Set(modulePage(rows, {...options, letter:'#'}).items), new Set(['中文模块', '_private']));
});

test('adapts to a changed page size and handles empty search results', () => {
  const rows = ['a','b','c','d','e'].map(name => [name, 'workspace']);
  const options = {nameOf: row => row[0], page: 3};
  assert.deepEqual(modulePage(rows, {...options, pageSize: 2}).items, [rows[4]]);
  const expanded = modulePage(rows, {...options, pageSize: 4});
  assert.deepEqual([expanded.items, expanded.page, expanded.first, expanded.last], [[rows[4]], 2, 5, 5]);
  assert.deepEqual(modulePage([], {...options, letter: 'A', pageSize: 0}), {
    items: [], letter: '', letters: [], page: 1, pages: 1, total: 0, first: 0, last: 0
  });
});
