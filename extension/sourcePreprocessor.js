'use strict';

const unknown = undefined;
const identifier = /^[A-Za-z_]\w*$/;
function integer(value) {
  if (!/^(?:0[xX][\da-fA-F]+|0[bB][01]+|0[0-7]*|[1-9]\d*)[uUlL]*$/.test(value)) return unknown;
  return /[1-9a-f]/i.test(value.replace(/^0[xb]/i,'').replace(/[ul]+$/i,'')) ? 1 : 0;
}

// Evaluate only boolean composition of known literals, local definitions and defined(). Includes
// and build flags are deliberately unknown. An unsupported expression remains a source candidate.
function condition(expression, macros) {
  const words=expression.match(/\w+|&&|\|\||[^\s]/g) || [];
  let pos=0,valid=true;
  function atom(depth) {
    if (depth>64 || pos>=words.length) {valid=false;return unknown;}
    const word=words[pos++];
    if (word==='!') {const value=atom(depth+1);return value===unknown ? unknown : 1-value;}
    if (word==='(') {
      const value=or(depth+1);
      if (words[pos++]!==')') valid=false;
      return value;
    }
    if (word==='defined') {
      const parenthesized=words[pos]==='(';
      if (parenthesized) pos++;
      const name=words[pos++];
      if (!identifier.test(name || '') || (parenthesized && words[pos++]!==')')) valid=false;
      return macros.get(name)?.defined;
    }
    return identifier.test(word) ? macros.get(word)?.value : integer(word);
  }
  function and(depth) {
    let value=atom(depth);
    while (words[pos]==='&&') {
      pos++;const rhs=atom(depth);
      value=value===0 || rhs===0 ? 0 : value===1 && rhs===1 ? 1 : unknown;
    }
    return value;
  }
  function or(depth) {
    let value=and(depth);
    while (words[pos]==='||') {
      pos++;const rhs=and(depth);
      value=value===1 || rhs===1 ? 1 : value===0 && rhs===0 ? 0 : unknown;
    }
    return value;
  }
  const result=or(0);
  return valid && pos===words.length ? result : unknown;
}

class SourcePreprocessor {
  constructor() {
    this.stack=[];
    this.macros=new Map();
    this.issueLine=undefined;
  }
  // The top frame includes its parents' state, keeping per-token queries constant-time.
  get active() { return this.stack.length ? this.stack.at(-1).effective : 1; }
  get selected() { return this.stack.at(-1)?.selected ?? true; }
  opaque(name) { const macro=this.macros.get(name);return !!macro && macro.defined!==0; }
  directive(statement,line) {
    const match=/^#\s*(\w+)\b\s*(.*)/.exec(statement);
    if (!match) return;
    const [,key,body]=match;
    if (['if','ifdef','ifndef'].includes(key)) {
      const known=this.macros.get(body.trim())?.defined;
      const value=key==='if' ? condition(body,this.macros) : known===unknown ? unknown : key==='ifdef' ? known : 1-known;
      this.stack.push({parent:this.active,parentSelected:this.selected,remaining:1,line});
      this.branch(value);
    } else if (['elif','else','endif'].includes(key)) {
      const frame=this.stack.at(-1);
      if (!frame || (key!=='endif' && frame.hadElse)) {this.issueLine??=line;return;}
      if (key==='endif') {this.stack.pop();return;}
      frame.hadElse=key==='else';
      this.branch(frame.hadElse ? 1 : condition(body,this.macros));
    } else if (this.active!==0 && (key==='define' || key==='undef')) {
      const parts=/^([A-Za-z_]\w*)(.*)/.exec(body);
      if (!parts) return;
      const known=this.active===1, undef=key==='undef';
      this.macros.set(parts[1],{defined:known ? Number(!undef) : unknown,
        value:known ? undef ? 0 : integer(parts[2].trim()) : unknown});
    }
  }
  branch(value) {
    const f=this.stack.at(-1);
    f.selected=f.parentSelected && !f.chosen && f.remaining!==0 && value!==0;
    if (f.selected) f.chosen=true;
    f.effective=[f.parent,f.remaining,value].includes(0) ? 0 :
      f.parent===1 && f.remaining===1 && value===1 ? 1 : unknown;
    if (value===1) f.remaining=0;
    else if (value===unknown && f.remaining!==0) f.remaining=unknown;
  }
}

// Treat a conventional whole-header protection guard as the first inclusion. A feature branch
// at the top of a source file can also begin with #ifndef; it must not be unconditionally enabled.
function header_guard(masked) {
  const lines=masked.trim().split(/\r?\n/), match=/^#\s*ifndef\s+([A-Za-z_]\w*)\s*$/.exec(lines[0]);
  if (!match || !/_(?:H|HPP|HH)_*$/i.test(match[1])) return;
  const first_body=lines.slice(1).find(line=>line.trim());
  if (!first_body || !new RegExp('^\\s*#\\s*define\\s+'+match[1]+'\\s*$').test(first_body)) return;
  let depth=0;
  for (let i=0;i<lines.length;i++) {
    const directive=/^\s*#\s*(if|ifdef|ifndef|elif|else|endif)\b/.exec(lines[i]);
    if (!directive) continue;
    const kind=directive[1];
    if (kind.startsWith('if')) depth++;
    else if (kind==='endif') {
      depth--;
      if (!depth) return i===lines.length-1 ? match[1] : undefined;
    } else if (depth===1) return;
  }
}

module.exports={SourcePreprocessor,header_guard};
