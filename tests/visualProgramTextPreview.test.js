'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const model = require('../extension/media/threadStudio/programModel');

function text_preview() {
  const controls = new Map();
  const toolbar = {
    append(button) { controls.set(button.dataset.command, button); },
    querySelector(selector) { return controls.get(selector.match(/data-command="?(\w+)/)[1]); }
  };
  const surface = {}, feedback = {}, sent = [], events = {};
  const editor = {diagnostics:[],setGraph(graph) { this.graph = graph; }};
  const window = {addEventListener(event, handler) { events[event] = handler; }};
  const document = {
    documentElement:{lang:'en'},
    getElementById(id) { return {commands:toolbar,designer:surface,feedback}[id]; },
    createElement() { return {dataset:{},addEventListener() {}}; }
  };
  const script = fs.readFileSync(require.resolve('../extension/media/threadStudio/programEditor'), 'utf8');
  vm.runInNewContext(script,{
    window,document,structuredClone,ZephyrProgramModel:model,
    acquireVsCodeApi:() => ({postMessage:message => sent.push(message)}),
    ZephyrProgramView:{bounded:() => true,mount(root, options) {
      editor.graph = options.graph; editor.change = options.onChange; return editor;
    }},
    ZephyrProgramPlayback:{mount:() => ({pause(){},sync(){}})}
  });
  let version = 0;
  function receive(data) {
    events.message({data:{version:++version,trusted:true,attached:true,...data}});
  }
  return {surface,feedback,sent,editor,controls,receive};
}

test('incomplete design text preserves the last valid diagram, rejects canvas edits and recovers without saving',() => {
  const preview = text_preview(), original = model.example();
  preview.receive({type:'document',graph:original});
  const invalid = structuredClone(original);
  invalid.threads[0].id = invalid.threads[1].id;
  for (const pending of [{type:'invalid',message:'Unexpected end of JSON'}, {type:'document',graph:invalid}]) {
    preview.receive(pending);
    assert.equal(preview.surface.inert,true);
    assert.equal(preview.editor.graph,original);
    assert.equal(preview.controls.get('apply').disabled,true);
    assert.match(preview.feedback.textContent,/last valid/);
    preview.editor.change(original);
    assert.deepEqual(preview.sent.map(row=>row.action),['ready']);
  }
  const next = structuredClone(original);
  next.threads[0].initialValue=77;
  preview.receive({type:'document',graph:next});
  assert.equal(preview.surface.inert,false);
  assert.equal(preview.controls.get('apply').disabled,false);
  assert.equal(preview.editor.graph.threads[0].initialValue,77);
  assert.equal(preview.feedback.textContent,'');
});
