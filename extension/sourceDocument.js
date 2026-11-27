'use strict';

const path = require('node:path');
const {inspect_buffer,max_bytes} = require('./liveSourceGraph');

const source_suffixes = ['c','h','cc','hh','cpp','hpp','cxx','hxx'];
const source_pattern = '**/*.{'+source_suffixes.join(',')+'}';
const supports_source = doc => doc && (['c','cpp'].includes(doc.languageId) ||
  source_suffixes.includes(path.extname(doc.uri.path).slice(1).toLowerCase()));

/** Capture one buffer version and keep the last valid relationships only for that URI. */
function read_source_document(document, previous) {
  const uri = document.uri.toString();
  const end = document.lineAt(document.lineCount - 1).range.end;
  const fits = document.offsetAt(end) <= max_bytes;
  const text = fits ? document.getText() : '';
  const result = fits ? inspect_buffer(document.fileName,text) : {issue:'size'};
  const valid = result.graph ? {graph:result.graph,version:document.version} :
    previous?.uri===uri ? {graph:previous.graph,version:previous.version} : {};
  return {...valid, uri, name:path.basename(document.fileName), current:document.version,
    dirty:document.isDirty, issue:result.issue, line:result.line, text:result.issue==='size' ? '' : text};
}

module.exports = {read_source_document,source_pattern,source_suffixes,supports_source};
