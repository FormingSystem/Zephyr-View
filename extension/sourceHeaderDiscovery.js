'use strict';

const path=require('node:path').posix;
const {SourcePreprocessor,header_guard}=require('./sourcePreprocessor');
const {mask}=require('./threadSource');
const {max_bytes}=require('./liveSourceGraph');

const limits={includes:80,headers:32,candidates:768,bytes:2*1024*1024,database:32*1024*1024};
const database_cache=new WeakMap();
const roots_cache=new WeakMap();
const decode_utf8=bytes=>Buffer.from(bytes).toString('utf8').replace(/^\uFEFF/,'');

// Splice before tokenizing, as the C preprocessor does. Keep the first physical source line.
function logical_lines(text) {
  const rows=[],starts=[];
  let current='',first=1;
  const physical=text.split(/\r\n|\n|\r/);
  physical.forEach((row,index)=>{
    if (row.endsWith('\\') && index+1<physical.length) current+=row.slice(0,-1);
    else {rows.push(current+row);starts.push(first);current='';first=index+2;}
  });
  return {rows,starts};
}

function direct_includes(text) {
  const {rows,starts}=logical_lines(text);
  const syntax=mask(rows.join('\n')), pp=new SourcePreprocessor(),includes=[];
  const guard=header_guard(syntax);
  if (guard) pp.macros.set(guard,{defined:0,value:0});
  let depth=0;
  syntax.split('\n').forEach((row,i)=>{
    const trimmed=row.trimStart();
    if (!trimmed.startsWith('#')) {
      if (pp.active!==0) for (const brace of row.match(/[{}]/g)||[]) depth=Math.max(0,depth+(brace==='{'?1:-1));
      return;
    }
    if (pp.active!==0 && !depth) {
      const match=/^(\s*#\s*include\s*)(@+|<[^>]+>)\s*$/.exec(row);
      if (match) {
        const token=rows[i].slice(match[1].length,match[1].length+match[2].length);
        const literal=/^"([^"\0]+)"$|^<([^<>\0]+)>$/.exec(token);
        if (literal) includes.push({name:literal[1]||literal[2],quoted:!!literal[1],conditional:pp.active!==1,line:starts[i]});
      }
    }
    pp.directive(trimmed,starts[i]);
  });
  return includes;
}

const windows_uri=uri=>/^\/[a-z]:\//i.test(uri.path) || (uri.scheme==='file' && !!uri.authority);
const uri_key=uri=>windows_uri(uri)?uri.toString().toLowerCase():uri.toString();

function resolve_uri(base,name) {
  if (!base || !name || /[\0\r\n]/.test(name)) return;
  let input=name;
  if (windows_uri(base)) {
    input=input.replace(/\\/g,'/');
    if (/^[a-z]:\//i.test(input)) input='/'+input;
    if (input.startsWith('//')) {
      const [,authority,rest]=/^\/\/([^/]+)(\/.*)$/.exec(input)||[];
      if (!authority || base.scheme!=='file') return;
      return base.with({authority,path:path.normalize(rest)});
    }
  } else if (/^[a-z]:[\\/]/i.test(input) || input.includes('\\')) return;
  return base.with({path:path.resolve(base.path,input)});
}

function within(uri,root) {
  if (!root || uri.scheme!==root.scheme || uri.authority!==root.authority) return false;
  const key=value=>windows_uri(root)?value.toLowerCase():value;
  const rel=path.relative(key(root.path),key(uri.path));
  return rel!=='..' && !rel.startsWith('../') && !path.isAbsolute(rel);
}

// Decode quoted paths without executing a command. Keep backslashes used in Windows paths.
function command_args(command,windows) {
  if (typeof command!=='string') return [];
  const args=[];
  let value='',quote='';
  for (let i=0;i<command.length;i++) {
    const ch=command[i],next=command[i+1];
    if (ch==='\\' && next && quote!=="'" &&
        ((windows && next==='"') || (!windows && (!quote || ['"','\\','$'].includes(next))))) {
      value+=next;i++;continue;
    }
    if (quote) {if (ch===quote) quote='';else value+=ch;continue;}
    if (ch==='"' || (ch==="'" && !windows)) {quote=ch;continue;}
    if (/\s/.test(ch)) {if (value) args.push(value);value='';continue;}
    value+=ch;
  }
  if (quote) return [];
  if (value) args.push(value);
  return args;
}

function include_roots(entry,directory) {
  const args=Array.isArray(entry.arguments)?entry.arguments:command_args(entry.command,windows_uri(directory));
  const roots={quote:[],normal:[],system:[]};
  for (let i=0;i<args.length;i++) {
    const arg=args[i];
    if (typeof arg!=='string' || arg.startsWith('@') || arg==='-I-') return;
    const match=/^(-iquote|-isystem|-I|\/I)(.*)$/.exec(arg);
    if (!match) continue;
    const name=match[2] || args[++i];
    if (typeof name!=='string' || name.startsWith('=') || name.startsWith('$')) return;
    const uri=resolve_uri(directory,name);
    if (!uri) return;
    const key=match[1]==='-iquote'?'quote':match[1]==='-isystem'?'system':'normal';
    roots[key].push(uri);
  }
  return roots;
}

async function database_entries(vscode,uri,cancelled) {
  const fs=vscode.workspace.fs, open=vscode.workspace.textDocuments.find(d=>d.isDirty && uri_key(d.uri)===uri_key(uri));
  const stat=open ? undefined:await fs.stat(uri);
  if (cancelled?.()) return [];
  const stamp=open?'d'+open.version:stat.mtime+':'+stat.size;
  let cache=database_cache.get(fs);
  if (!cache) {cache=new Map();database_cache.set(fs,cache);}
  const cached=cache.get(uri_key(uri));
  if (cached?.stamp===stamp && cached.open===open) return cached.entries;
  if (stat && stat.size>limits.database) return [];
  const content=open?open.getText():decode_utf8(await fs.readFile(uri));
  if (cancelled?.() || content.length>limits.database) return [];
  const entries=JSON.parse(content.replace(/^\uFEFF/,''));
  if (!Array.isArray(entries)) return [];
  if (cache.size>=3) cache.delete(cache.keys().next().value);
  cache.set(uri_key(uri),{stamp,open,entries});
  return entries;
}

async function compiler_roots(vscode,build,file,watch,cancelled) {
  if (!build) return;
  const database=resolve_uri(build,'compile_commands.json');
  watch(database);
  let entries;
  try {entries=await database_entries(vscode,database,cancelled);} catch {return;}
  if (cancelled?.()) return;
  let cache=roots_cache.get(entries);
  if (!cache) {cache=new Map();roots_cache.set(entries,cache);}
  const key=uri_key(file);
  if (cache.has(key)) return cache.get(key);
  const roots=await matching_roots(entries,build,key,cancelled);
  if (!cancelled?.()) cache.set(key,roots);
  return roots;
}

async function matching_roots(entries,build,fileKey,cancelled) {
  let found,signature,ambiguous=false;
  for (let i=0;i<entries.length;i++) {
    if (cancelled && i>0 && i%1024===0) await new Promise(resolve=>setImmediate(resolve));
    if (cancelled?.()) return;
    const entry=entries[i];
    if (typeof entry?.directory!=='string' || typeof entry.file!=='string') continue;
    const directory=resolve_uri(build,entry.directory), source=resolve_uri(directory,entry.file);
    if (!source || uri_key(source)!==fileKey) continue;
    const roots=include_roots(entry,directory);
    if (!roots) return {ambiguous:true,skipCurrent:true};
    const key=JSON.stringify(Object.values(roots).map(list=>list.map(uri_key)));
    if (signature && key!==signature) ambiguous=true;
    signature=key;found=roots;
  }
  return ambiguous?{ambiguous:true}:found;
}

function search_candidates(options,include,roots) {
  const {document,folder,application,zephyrBase}=options;
  const current=resolve_uri(document.uri,'..');
  const locations=[];
  if (include.quoted && !roots?.skipCurrent) locations.push(current);
  if (!roots && zephyrBase && include.name.startsWith('zephyr/')) locations.push(resolve_uri(zephyrBase,'include'));
  if (roots && !roots.ambiguous) locations.push(...(include.quoted?roots.quote:[]),...roots.normal,...roots.system);
  return locations.flatMap(base=>{
    const uri=resolve_uri(base,include.name);
    if (!uri) return [];
    // Respect parent-relative includes inside this application, never infer sibling checkout roots.
    if (within(uri,base) || within(uri,application) || within(uri,zephyrBase) ||
        (!application && within(uri,folder?.uri))) return [uri];
    return [];
  });
}

class header_reader {
  constructor(options) {
    this.options=options;
    this.open=new Map(options.vscode.workspace.textDocuments.map(doc=>[uri_key(doc.uri),doc]));
    this.cached=new Map();
    this.watched=new Map();
    this.found=new Map();
    this.bytes=0;
    this.omitted=0;
    this.unresolved=0;
  }
  watch(uri) {this.watched.set(uri_key(uri),uri);}

  async read(uri) {
    const doc=this.open.get(uri_key(uri));
    if (doc) {
      const text=doc.getText();
      return Buffer.byteLength(text)>max_bytes?{omitted:true}:{uri:doc.uri,document:doc,version:doc.version,text};
    }
    const {vscode}=this.options;
    const stat=await vscode.workspace.fs.stat(uri);
    if (this.options.cancelled?.() || !(stat.type & vscode.FileType.File)) return;
    if (stat.size>max_bytes) return {omitted:true};
    const raw=await vscode.workspace.fs.readFile(uri);
    return raw.byteLength>max_bytes?{omitted:true}:{uri,text:decode_utf8(raw)};
  }

  async locate(include,roots) {
    for (const uri of search_candidates(this.options,include,roots)) {
      if (this.options.cancelled?.()) return;
      const key=uri_key(uri);
      if (!this.cached.has(key)) {
        if (this.cached.size>=limits.candidates) {this.omitted++;return;}
        this.watch(uri);
        const item=await this.read(uri).catch(error=>
          ['FileNotFound','ENOENT','ENOTDIR','FileNotADirectory'].includes(error.code)?undefined:{omitted:true});
        this.cached.set(key,item);
      }
      const hit=this.cached.get(key);
      if (hit?.omitted) {this.omitted++;return;}
      if (hit) return hit;
    }
    this.unresolved++;
  }

  async scan() {
    const {vscode,document,build,cancelled}=this.options;
    const stopped=()=>({headers:[],watchUris:[],omitted:0,unresolved:0,cancelled:true});
    if (cancelled?.()) return stopped();
    const includes=this.options.includes ?? direct_includes(document.getText());
    const roots=includes.length && await compiler_roots(vscode,build,document.uri,uri=>this.watch(uri),cancelled);
    this.omitted+=Math.max(0,includes.length-limits.includes);
    for (const include of includes.slice(0,limits.includes)) {
      if (cancelled?.()) return stopped();
      const hit=await this.locate(include,roots);
      if (cancelled?.()) return stopped();
      if (!hit || uri_key(hit.uri)===uri_key(document.uri)) continue;
      const key=uri_key(hit.uri),previous=this.found.get(key);
      if (previous) {
        previous.lines.push(include.line);
        previous.conditional&&=include.conditional;
        if (!include.conditional) previous.line=Math.min(previous.line??Infinity,include.line);
      } else {
        const size=Buffer.byteLength(hit.text);
        if (this.found.size>=limits.headers || this.bytes+size>limits.bytes) {this.omitted++;continue;}
        this.bytes+=size;
        this.found.set(key,{...hit,lines:[include.line],line:include.conditional?undefined:include.line,conditional:include.conditional});
      }
    }
    return {headers:[...this.found.values()],watchUris:[...this.watched.values()],omitted:this.omitted,unresolved:this.unresolved};
  }
}

/** Discover direct literal includes from this buffer using this translation unit's include order. */
async function discover_source_headers(options) {return new header_reader(options).scan();}
module.exports={discover_source_headers,direct_includes};
