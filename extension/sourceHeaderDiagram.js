'use strict';

// Do not serialize compiler evidence, alias tables or branch objects into the webview.
const evidence=new WeakMap();
const register_header_evidence=(diagram,details)=>evidence.set(diagram,details);

function exported_bindings(diagram) {
  const info=evidence.get(diagram);
  if (!info) return [];
  if (info.exports) return info.exports;
  const result=[];
  const {index,namespaces}=info;
  for (const key of new Set([...index.bindings.keys(),...index.aliases.keys()])) {
    const end=key.lastIndexOf('::');
    if (end>=0 && !namespaces.has(key.slice(0,end))) continue;
    const resolved=index.resolve('','::'+key,[]);
    // A declaration without a definition may accompany a complete definition in another header.
    if (!resolved && index.forwards.has(key) && !index.aliases.has(key) && !index.at(key).length) continue;
    const tagOnly=!key.split('::').at(-1).startsWith('#') && !index.aliases.has(key);
    result.push([key,{...resolved,tagOnly}]);
  }
  info.exports=result;
  return result;
}

function header_catalog(headers) {
  const names=new Map(),macros=new Map();
  for (const header of headers) {
    for (const name of evidence.get(header.diagram)?.macroNames || []) {
      macros.set(name,Math.min(macros.get(name) ?? Infinity,header.line || 0));
    }
    for (const [key,binding] of exported_bindings(header.diagram)) {
      if (!names.has(key)) names.set(key,[]);
      names.get(key).push({header,binding});
    }
  }
  return {names,macros};
}

function macro_at(catalog,spelling,line) {
  return spelling.split(/::|#/).some(name=>catalog.macros.get(name)<=line);
}

function available_at(catalog,key,line,cSource) {
  if (macro_at(catalog,key,line)) return [{unavailable:true}];
  const rows=catalog.names.get(key);
  if (!rows) return;
  const matches=new Map();
  for (const {header,binding} of rows) {
    if (header.line && header.line>line || cSource && binding.tagOnly) continue;
    // Multiple include paths to the same URI and definition represent a single choice.
    if (matches.has(header.uri) && header.conditional) continue;
    matches.set(header.uri,{header,binding});
  }
  if (!matches.size) return;
  if (matches.size>1) return [{ambiguous:true}];
  const [{header,binding}]=matches.values();
  if (binding.ambiguous) return [binding];
  if (!binding.node || binding.conditional || binding.node.conditional || header.conditional) return [{unavailable:true}];
  return [{node:binding.node,indirect:binding.indirect,file:header.uri}];
}

function compatible_kind(expected,actual) {
  if (!expected || expected===actual) return true;
  return ['class','struct'].includes(expected) && ['class','struct'].includes(actual);
}

/** Link uses in a root class diagram to definitions from its resolved, direct includes. */
function link_header_diagram(root,headers) {
  const info=evidence.get(root);
  if (!info?.unresolved.length || !headers.length) return root;
  const catalog=header_catalog(headers);
  const nodes=[...root.nodes], edges=[...root.edges], imported=new Map();
  const omitted={...root.omitted};
  let ambiguous=root.ambiguous;
  for (const use of info.unresolved) {
    if (macro_at(catalog,use.type,use.line) || macro_at(catalog,use.label,use.line)) continue;
    const target=info.index.resolve(use.scope,use.type,[use.branch],key=>available_at(catalog,key,use.line,info.cSource));
    if (target?.ambiguous) {ambiguous++;continue;}
    if (!target?.file || !compatible_kind(use.expected,target.node.kind)) continue;
    const id=JSON.stringify([target.file,target.node.id]);
    if (edges.length>=info.limits.edges) {omitted.edges++;continue;}
    if (!imported.has(id)) {
      if (nodes.length>=info.limits.nodes) {omitted.edges++;continue;}
      imported.set(id,true);
      nodes.push({...target.node,id,file:target.file});
    }
    const kind=use.kind==='composition' && target.indirect ? 'association' : use.kind;
    const edge={from:use.from,to:id,kind,line:use.line,label:use.label};
    if (use.conditional || target.conditional) edge.conditional=true;
    edges.push(edge);
  }
  return {...root,nodes,edges,omitted,ambiguous};
}

module.exports={register_header_evidence,link_header_diagram};
