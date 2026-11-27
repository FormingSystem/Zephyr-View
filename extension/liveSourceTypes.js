'use strict';

const aggregate = new Set(['struct','union','enum']);
const identifier = /^[A-Za-z_]\w*$/;
const decorations = new Set(['__attribute__','__attribute','__declspec','alignas','_Alignas','__aligned','__packed',
  '__aligned_largest','__deprecated','__maybe_unused','__unused','__weak','__used','__printf_like_func','__noinline']);
const qualifiers = new Set(['const','volatile','restrict','__restrict','__restrict__']);
const max_members = 32;
const max_depth = 12;

/** Skip only decorations with established compiler or Zephyr spelling. Keep unknown macros opaque. */
function skip_decorations(tokens,pairs,index) {
  while (index<tokens.length) {
    if (tokens[index].value==='[' && tokens[index+1]?.value==='[' && pairs.has(index)) {
      index=pairs.get(index)+1;continue;
    }
    if (!decorations.has(tokens[index].value)) break;
    index++;
    if (tokens[index]?.value==='(' && pairs.has(index)) index=pairs.get(index)+1;
  }
  return index;
}

class DeclarationReader {
  constructor(source,tokens,pairs) {
    this.source=source;
    this.tokens=tokens;
    this.pairs=pairs;
  }
  value(index) { return this.tokens[index]?.value; }

  // Delimiters in a function pointer, array or inline aggregate belong to its own declarator.
  boundary(start,end,separators) {
    for (let i=start;i<end;i++) {
      if (separators.includes(this.value(i))) return i;
      if (this.pairs.get(i)>i) i=this.pairs.get(i);
    }
    return end;
  }
  text(start,end) {
    if (start>=end) return '';
    const from=this.tokens[start].start,to=this.tokens[end-1].end;
    const text=this.source.slice(from,Math.min(to,from+180)).trim().replace(/\s+/g,' ');
    return to-from>180 ? text+'…' : text;
  }
  aggregate_at(index) {
    const kind=this.value(index);
    if (!aggregate.has(kind)) return;
    const tag_at=skip_decorations(this.tokens,this.pairs,index+1);
    const tag=identifier.test(this.value(tag_at) || '') ? this.tokens[tag_at] : undefined;
    const left=skip_decorations(this.tokens,this.pairs,tag_at+Number(!!tag));
    if (this.value(left)==='{' && this.pairs.has(left)) return {kind,tag,index,left,right:this.pairs.get(left)};
  }
  item(token,data) { return token.conditional ? {...data,line:token.line,conditional:true} : {...data,line:token.line}; }

  members(group,depth) {
    const separator=group.kind==='enum' ? ',' : ';', members=[];
    let count=0;
    for (let start=group.left+1;start<group.right;) {
      const end=this.boundary(start,group.right,[separator]);
      if (start<end) {
        count++;
        if (members.length<max_members && depth<max_depth) members.push(this.member(start,end,depth));
      }
      start=end+1;
    }
    return {members,count};
  }
  member(start,end,depth) {
    const token=this.tokens[start];
    const nested=this.aggregate_at(skip_decorations(this.tokens,this.pairs,start));
    if (!nested || nested.right>=end) return this.item(token,{name:this.text(start,end)});
    const prefix=this.text(start,nested.left), suffix=this.text(nested.right+1,end);
    return this.item(token,{kind:nested.kind,name:[prefix,suffix].filter(Boolean).join(' '),...this.members(nested,depth+1)});
  }

  alias(start,end) {
    let candidate;
    for (let i=start;i<end;) {
      const next=skip_decorations(this.tokens,this.pairs,i);
      if (next!==i) {i=next;continue;}
      const token=this.tokens[i];
      if (token.value==='(' && this.value(i+1)==='*') {
        let at=i+2;
        while (qualifiers.has(this.value(at)) || this.value(at)==='*') at++;
        if (identifier.test(this.value(at) || '')) return this.tokens[at];
      }
      if (identifier.test(token.value) && !qualifiers.has(token.value)) candidate=token;
      i=this.pairs.get(i)>i ? this.pairs.get(i)+1 : i+1;
    }
    return candidate;
  }
  typedef(start,output) {
    const end=this.boundary(start+1,this.tokens.length,[';']);
    if (end===this.tokens.length) return end-1;
    const spec=this.aggregate_at(skip_decorations(this.tokens,this.pairs,start+1));
    const signature=this.text(start,end);
    let first=true;
    for (let part=spec ? spec.right+1 : start+1;part<end;) {
      const comma=this.boundary(part,end,[',']),alias=this.alias(part,comma);
      if (alias && first && spec) {
        const name=spec.tag && spec.tag.value!==alias.value ? spec.tag.value+' / '+alias.value : alias.value;
        output.push(this.item(this.tokens[start],{name,kind:spec.kind,...this.members(spec,0)}));
      } else if (alias) {
        output.push(this.item(alias,{name:alias.value,kind:'typedef',signature,members:[],count:0}));
      }
      first=false;part=comma+1;
    }
    return end;
  }
  declarations() {
    const output=[];
    for (let i=0;i<this.tokens.length;i++) {
      if (this.value(i)==='typedef') {i=this.typedef(i,output);continue;}
      const spec=this.aggregate_at(i);
      if (!spec) continue;
      const trailing=skip_decorations(this.tokens,this.pairs,spec.right+1);
      const variable=identifier.test(this.value(trailing) || '') ? this.value(trailing) : undefined;
      const name=spec.tag?.value || variable || spec.kind+' · L'+this.tokens[i].line;
      output.push(this.item(this.tokens[i],{kind:spec.kind,name,...this.members(spec,0)}));
      i=spec.right;
    }
    return output;
  }
}

function source_types(source,tokens,pairs) { return new DeclarationReader(source,tokens,pairs).declarations(); }
module.exports={source_types,skip_decorations};
