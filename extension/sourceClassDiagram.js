'use strict';

const {register_header_evidence,link_header_diagram}=require('./sourceHeaderDiagram');
const {DeclarationReader,skip_decorations} = require('./liveSourceTypes');
const aggregate_kinds = new Set(['class','struct','union','enum']);
const cv = new Set(['const','volatile','restrict','__restrict','__restrict__']);
const access = new Set(['public','private','protected']);
const is_name = token => token && !token.macro && /^[A-Za-z_]\w*$/.test(token.value);
const qualify = (scope,name) => scope ? scope+'::'+name : name;
// Elaborated names such as 'struct handle' bypass the ordinary typedef namespace in C.
const tag_key = name => name.replace(/([^:]+)$/, '#$1');
const limits = {nodes:160,members:48,edges:400,depth:24};

// Two tokens cannot coexist if they occupy distinct arms of the same #if.
function compatible_branches(left,right) {
  while (left && right && left!==right) {
    if (left.group>right.group) left=left.parent;
    else if (right.group>left.group) right=right.parent;
    else {
      if (left.arm!==right.arm) return false;
      left=left.parent;right=right.parent;
    }
  }
  return true;
}

// Resolve only declared names. An unresolved name in an inner scope shadows all outer scopes.
class type_index {
  constructor() {
    this.bindings=new Map();
    this.aliases=new Map();
    this.imports=new Set();
    this.forwards=new Set();
  }

  bind(scope,name,binding,table=this.bindings) {
    const key=qualify(scope,name);
    if (!table.has(key)) table.set(key,[]);
    if (binding) table.get(key).push(binding);
  }

  at(key) { return this.aliases.get(key) || this.bindings.get(key); }

  lookup(scope,raw,external) {
    if (raw.startsWith('::')) {scope='';raw=raw.slice(2);}
    for (;;) {
      const key=qualify(scope,raw), choices=this.at(key);
      if (choices && (choices.length || !this.forwards.has(key) || this.aliases.has(key))) return choices;
      const imported=!this.imports.has(scope) && external?.(key);
      if (imported || choices) return imported || choices;
      if (this.imports.has(scope) || !scope) return;
      scope=scope.split('::').slice(0,-1).join('::');
    }
  }

  resolve(scope,name,paths,external,seen=new Set()) {
    const candidates=this.lookup(scope,name,external)?.filter(item=>paths.every(path=>compatible_branches(item.branch,path)));
    if (!candidates?.length || seen.size>limits.depth) return;
    if (candidates.length!==1) return {ambiguous:true};
    const [item]=candidates;
    if (item.ambiguous) return item;
    if (item.unavailable || seen.has(item)) return;
    if (item.node) return item;
    seen.add(item);
    const target=this.resolve(item.scope,item.type,item.branch ? [...paths,item.branch] : paths,external,seen);
    if (target) return {...target,indirect:target.indirect || item.indirect,
      conditional:target.conditional || item.conditional};
  }
}

class class_reader extends DeclarationReader {
  constructor(source,tokens,pairs) {
    super(source,tokens,pairs);
    this.index=new type_index();
    this.pending=[];
    this.namespaces=new Set(['']);
    this.model={nodes:[],edges:[],omitted:{nodes:0,members:0,edges:0},ambiguous:0};
  }

  decorated(i) { return skip_decorations(this.tokens,this.pairs,i); }

  // Read one qualified identifier. Templates and dependent types are left for the compiler.
  type_name(at,end) {
    let i=at;
    const tagged=aggregate_kinds.has(this.value(i));
    if (tagged) i++;
    let name=this.value(i)==='::' ? this.value(i++) : '';
    if (i>=end || !is_name(this.tokens[i])) return;
    name+=this.value(i++);
    while (i+1<end && this.value(i)==='::' && is_name(this.tokens[i+1])) {
      name+='::'+this.value(i+1);i+=2;
    }
    return {name,key:tagged ? tag_key(name) : name,expected:tagged ? this.value(at) : undefined,next:i};
  }

  aggregate_head(start,end) {
    let at=this.decorated(start);
    if (this.value(at)==='typedef') at=this.decorated(at+1);
    const kind=this.value(at++);
    if (!aggregate_kinds.has(kind)) return;
    at=this.decorated(at);
    if (kind==='enum' && ['class','struct'].includes(this.value(at))) at++;
    const tag=is_name(this.tokens[at]) ? this.value(at++) : '';
    at=this.decorated(at);
    if (this.value(at)==='final') at++;
    if (at!==end && this.value(at)!==':') return;
    return {kind,tag,base:at<end ? at+1 : end};
  }

  scopes(start,end,scope,depth) {
    if (depth>limits.depth) return;
    for (let i=start;i<end;) {
      const at=this.boundary(i,end,[';','{']);
      if (at===end) break;
      if (this.value(at)===';') {
        this.alias_or_forward(i,at,scope);
        i=at+1;continue;
      }
      const right=this.pairs.get(at);
      const header=this.aggregate_head(i,at);
      if (header) {
        const stop=this.boundary(right+1,end,[';','{']);
        this.definition(i,at,right,stop,header,scope,depth);
        i=stop<end && this.value(stop)===';' ? stop+1 : right+1;
      } else {
        if (this.value(i)==='namespace' && at===i+2 && is_name(this.tokens[i+1])) {
          const nested=qualify(scope,this.value(i+1));
          this.namespaces.add(nested);
          this.scopes(at+1,right,nested,depth+1);
        }
        if (this.value(i)==='extern' && at===i+2 && /^@+$/.test(this.value(i+1)))
          this.scopes(at+1,right,scope,depth+1);
        i=right+1;
      }
    }
  }

  declarator(start,end) {
    let i=this.decorated(start), indirect=false;
    while (i<end && (cv.has(this.value(i)) || ['*','&'].includes(this.value(i)))) {
      if (!cv.has(this.value(i))) indirect=true;
      i++;
    }
    if (!is_name(this.tokens[i]) || i>=end) return;
    const token=this.tokens[i++];
    while (i<end && this.value(i)==='[') i=this.pairs.get(i)+1;
    if (this.decorated(i)!==end) return;
    return {token,indirect};
  }

  alias_or_forward(start,end,scope) {
    const at=this.decorated(start);
    if (this.value(at)==='using') {
      if (this.value(at+1)==='namespace') this.index.imports.add(scope);
      else {
        const imported=this.type_name(at+1,end);
        if (imported) this.index.bind(scope,imported.name.split('::').at(-1));
      }
      return;
    }
    const head=this.aggregate_head(at,end);
    if (head?.tag) {
      this.index.forwards.add(qualify(scope,head.tag));
      this.index.forwards.add(qualify(scope,tag_key(head.tag)));
      this.index.bind(scope,head.tag);
      this.index.bind(scope,tag_key(head.tag));
      return;
    }
    if (this.value(at)!=='typedef') return;
    const type=this.type_name(at+1,end);
    const signature=this.text(at,end);
    for (let i=at+1;i<end;) {
      const comma=this.boundary(i,end,[',']);
      const shape=type && this.declarator(i===at+1 ? type.next : i,comma);
      const token=shape?.token || this.alias(i,comma);
      if (token) {
        const binding=shape && {type:type.key,scope,indirect:shape.indirect,
          conditional:token.conditional,branch:token.branch};
        this.index.bind(scope,token.value,binding,this.index.aliases);
        if (type?.name!==token.value) this.add_node(token,'typedef',qualify(scope,token.value),signature);
      }
      i=comma+1;
    }
  }

  add_node(token,kind,name,signature) {
    const node=this.item(token,{id:'t'+token.start,kind,name,members:[]});
    if (signature) node.signature=signature;
    if (this.model.nodes.length>=limits.nodes) {this.model.omitted.nodes++;return;}
    this.model.nodes.push(node);
    return node;
  }

  definition(start,left,right,end,header,scope,depth) {
    const aliases=[];
    if (this.value(this.decorated(start))==='typedef') {
      for (let i=right+1;i<end;) {
        const comma=this.boundary(i,end,[',']);
        const alias=this.declarator(i,comma);
        if (alias) aliases.push(alias);
        i=comma+1;
      }
    }
    const name=header.tag || aliases.find(alias=>!alias.indirect)?.token.value;
    if (!name) return;
    const full=qualify(scope,name);
    const node=this.add_node(this.tokens[start],header.kind,full);
    const binding=node ? {node,branch:this.tokens[start].branch} : {unavailable:true};
    this.index.bind(scope,name,binding);
    this.index.bind(scope,tag_key(name),binding);
    for (const alias of aliases) {
      this.index.bind(scope,alias.token.value,{type:tag_key(name),scope,indirect:alias.indirect,
        conditional:alias.token.conditional,branch:alias.token.branch},this.index.aliases);
    }
    if (!node || depth>=limits.depth) return;
    if (header.kind!=='enum') this.bases(header.base,left,node,scope);
    this.fields(left+1,right,node,full,depth);
  }

  bases(start,end,node,scope) {
    for (let at=start;at<end;) {
      const comma=this.boundary(at,end,[',']);
      let i=at;
      while (access.has(this.value(i)) || this.value(i)==='virtual') i++;
      const base=this.type_name(i,comma);
      if (base && base.next===comma) this.add_relation(node,scope,base.name,'inheritance',base.name,this.tokens[i]);
      at=comma+1;
    }
  }

  fields(start,end,node,scope,depth) {
    const is_enum=node.kind==='enum';
    for (let i=start;i<end;) {
      if (access.has(this.value(i)) && this.value(i+1)===':') {i+=2;continue;}
      const stop=this.boundary(i,end,is_enum ? [','] : [';','{']);
      if (i===stop) {i++;continue;}
      const body=this.value(stop)==='{';
      const right=body ? this.pairs.get(stop) : stop;
      const header=body && this.aggregate_head(i,stop);
      let last=stop;
      if (header) {
        last=this.boundary(right+1,end,[';']);
        this.definition(i,stop,right,last,header,scope,depth+1);
        if (header.tag && this.value(i)!=='typedef') {
          this.declarators(right+1,last,node,scope,tag_key(header.tag));
        }
      }
      const token=this.tokens[i];
      if (node.members.length<limits.members) node.members.push(this.item(token,{name:this.text(i,last)}));
      else this.model.omitted.members++;
      if (!body && !is_enum) {
        this.alias_or_forward(i,stop,scope);
        this.field_relations(i,stop,node,scope);
      }
      i=header ? last+1 : right+1;
    }
  }

  field_relations(start,end,node,scope) {
    let at=this.decorated(start);
    while (cv.has(this.value(at)) || this.value(at)==='mutable') at++;
    const type=this.type_name(at,end);
    if (type) this.declarators(type.next,end,node,scope,type.key,type.expected);
  }

  declarators(start,end,node,scope,type,expected) {
    for (let i=start;i<end;) {
      const comma=this.boundary(i,end,[',']);
      const decl=this.declarator(i,comma);
      if (decl) this.add_relation(node,scope,type,decl.indirect?'association':'composition',decl.token.value,decl.token,expected);
      i=comma+1;
    }
  }

  add_relation(node,scope,type,kind,label,token,expected) {
    this.pending.push({from:node.id,scope,type,kind,label,line:token.line,branch:token.branch,
      conditional:node.conditional || token.conditional,expected});
  }

  diagram(macros,cSource) {
    this.scopes(0,this.tokens.length,'',0);
    const unresolved=[];
    for (const use of this.pending) {
      const {from,scope,type,kind,label,line,conditional,branch}=use;
      const target=this.index.resolve(scope,type,[branch]);
      if (target?.ambiguous) {this.model.ambiguous++;continue;}
      if (!target?.node) {unresolved.push(use);continue;}
      if (this.model.edges.length>=limits.edges) {this.model.omitted.edges++;continue;}
      const edge={from,to:target.node.id,kind:target.indirect && kind==='composition'?'association':kind,label,line};
      if (conditional || target.conditional || target.node.conditional) edge.conditional=true;
      this.model.edges.push(edge);
    }
    register_header_evidence(this.model,{index:this.index,namespaces:this.namespaces,unresolved,limits,cSource,macroNames:[...macros.keys()].filter(name=>macros.get(name).defined!==0)});
    return this.model;
  }
}

function source_class_diagram(source,tokens,pairs,macros=new Map(),cSource=false) {
  return new class_reader(source,tokens,pairs).diagram(macros,cSource);
}

module.exports={source_class_diagram,link_header_diagram};
