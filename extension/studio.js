'use strict';
const vscode=require('vscode');
const path=require('node:path');
const {createHash}=require('node:crypto');
const fs=require('node:fs/promises');
const execute=require('node:util').promisify(require('node:child_process').execFile);
const {pickFile,saveFileAs}=require('./fileDialogs');
const {hasCurrentBuild,readText,hasFile}=require('./target');
const fingerprint=text=>createHash('sha256').update(text).digest('hex');
const inputTypes={kconfig:{extension:'conf',label:'Kconfig fragment'},device:{extension:'overlay',label:'Devicetree overlay'}};
const maxSize=2*1024*1024;
function inside(directory,file){
  const relative=path.relative(directory,file);
  return relative!==''&&!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep);
}
async function projectFile(app,filename,kind,creating){
  const type=inputTypes[kind];
  if(!type||!inside(app,filename)||path.extname(filename).toLowerCase()!=='.'+type.extension)
    throw Error(vscode.l10n.t('Choose a .{0} file inside the active application.',type?.extension||''));
  const root=await fs.realpath(app);
  const location=creating?path.join(await fs.realpath(path.dirname(filename)),path.basename(filename)):await fs.realpath(filename);
  if(!inside(root,location)||path.extname(location).toLowerCase()!=='.'+type.extension)
    throw Error(vscode.l10n.t('The selected path resolves outside the active application or has another file type.'));
  return location;
}
async function pickInput(s,kind,creating){
  if(!vscode.workspace.isTrusted||!s.setup.app||!Object.hasOwn(inputTypes,kind))return;
  const type=inputTypes[kind],label=vscode.l10n.t(type.label),app=vscode.Uri.file(s.setup.app);
  const options={filters:{[label]:[type.extension]},defaultUri:app};
  const defaultName=creating&&kind==='kconfig'&&!await hasFile(vscode.Uri.joinPath(app,'prj.conf'))?'prj.conf':'extra.'+type.extension;
  const uri=creating?await saveFileAs({...options,title:vscode.l10n.t('Choose a location for a new {0}',label),
    defaultUri:vscode.Uri.joinPath(app,defaultName)}):
    await pickFile({...options,title:vscode.l10n.t('Open {0}',label)});
  if(!uri)return;
  if(uri.scheme!=='file')throw Error(vscode.l10n.t('Choose a file on the application filesystem.'));
  const actual=await projectFile(s.setup.app,uri.fsPath,kind,creating);
  if(creating){
    const exists=await fs.lstat(actual).catch(error=>{if(error.code!=='ENOENT')throw error;});
    if(exists)throw Error(vscode.l10n.t('This file already exists. Use Open file to edit it.'));
  }else{
    const stat=await fs.stat(actual);
    if(!stat.isFile()||stat.size>maxSize)throw Error(vscode.l10n.t('Select a regular configuration file up to 2 MiB.'));
  }
  return {file:uri.fsPath,kind,creating};
}
async function inputs(s,opened=[]){
  if(!s.setup.app)return [];
  const current=hasCurrentBuild(s),tree=s.target.devicetree;
  const app=vscode.Uri.file(s.setup.app);
  const configs=current?s.target.files.filter(uri=>path.extname(uri.fsPath).toLowerCase()==='.conf'):[vscode.Uri.joinPath(app,'prj.conf')];
  const overlays=current?tree.overlays.filter(uri=>path.extname(uri.fsPath).toLowerCase()==='.overlay'):[];
  const defaults = {kconfig:vscode.Uri.joinPath(app,'prj.conf'), device:vscode.Uri.joinPath(app,'app.overlay')};
  const planned=['kconfig','overlay'].flatMap(kind=>s.configurationFiles?.[kind]?.files || []).map(file=>vscode.Uri.file(file));
  const files=[...planned,...configs,...overlays,...Object.values(defaults),...opened.map(input=>vscode.Uri.file(input.file))];
  const key=file=>process.platform==='win32'?file.fsPath.toLowerCase():file.fsPath;
  const unique=new Map(files.map(uri=>[key(uri),uri]));
  const applied=new Set([...configs,...overlays].map(key));
  const result=[];
  const extras=new Map(opened.map(input=>[key(vscode.Uri.file(input.file)),input]));
  for(const [id,uri] of unique){
    if(!inside(app.fsPath,uri.fsPath)||(current&&tree.base&&id===key(tree.base)))continue;
    const extra=extras.get(id);
    if(extra?.creating){result.push({...extra,base:null,text:''});continue;}
    if(!await hasFile(uri)){
      const fallback = Object.entries(defaults).find(([, file]) => key(file) === id);
      if (fallback && !await fs.lstat(uri.fsPath).catch(error => { if (error.code !== 'ENOENT') throw error; })) {
        result.push({file:uri.fsPath, kind:fallback[0], creating:true, automatic:true, base:null, text:''});
      }
      continue;
    }
    const kind=extra?.kind||(uri.fsPath.toLowerCase().endsWith('.overlay')?'device':'kconfig');
    try{await projectFile(app.fsPath,uri.fsPath,kind,false);}
    catch{continue;}
    const stat=await vscode.workspace.fs.stat(uri);
    if(stat.size>maxSize)continue;
    const text=await readText(uri);
    result.push({file:uri.fsPath,text:text.replace(/^\uFEFF/,''),base:fingerprint(text),bom:text.startsWith('\uFEFF'),kind,
      applied:current&&(kind==='device'?tree.sourcesKnown:s.target.kconfigSourcesKnown)?applied.has(id):undefined,...extra});
  }
  return result;
}
let lastCatalog;
async function symbols(s,env){
  if(!s.build||!hasCurrentBuild(s))return {source:'unconfigured',items:[]};
  if(!vscode.workspace.isTrusted)return {source:'restricted',items:[]};
  const python=s.tools.python||s.target.cache.get('WEST_PYTHON');
  if(!python)return {source:'unavailable',items:[]};
  const dir=(s.target.buildDir || s.build).fsPath;
  const stamps=await Promise.all(['zephyr/.config','zephyr/.cmake.dotconfig.checksum','CMakeCache.txt','build.ninja',
    'CMakeFiles/menuconfig.dir/build.make'].map(name=>fs.stat(path.join(dir,name)).then(stat=>stat.mtimeMs).catch(()=>null)));
  const key=JSON.stringify([dir,python,...stamps]);
  if(lastCatalog?.key===key)return lastCatalog.pending;
  const pending=execute(python,[path.join(__dirname,'kconfig_catalog.py'),dir],
    {env,windowsHide:true,timeout:25000,maxBuffer:16*1024*1024}).then(({stdout})=>({source:'menu',items:JSON.parse(stdout)}))
    .catch(error=>{
      if(lastCatalog?.key===key)lastCatalog=undefined;
      console.warn('Zephyr Kconfig menu:',error.stderr||error.message);
      return {source:'unavailable',items:[]};
    });
  lastCatalog={key,pending};
  return pending;
}
function draft_input(s, draft) {
  const file = s.inputs?.find(item => item.file === draft?.file);
  if (!vscode.workspace.isTrusted || !file || typeof draft.text !== 'string')
    throw Error(vscode.l10n.t('Reopen the configuration input before saving.'));
  if (Buffer.byteLength(draft.text, 'utf8') > maxSize)
    throw Error(vscode.l10n.t('Select a regular configuration file up to 2 MiB.'));
  return file;
}

/** Create exactly one new file. A cancelled or failed copy must never truncate an existing input. */
async function write_new_file(destination, text) {
  let handle;
  try {
    handle = await fs.open(destination, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') throw Error(vscode.l10n.t('Choose a new filename. An existing file occupies that location.'));
    throw error;
  }
  try {
    await handle.writeFile(text, 'utf8');
  } catch (error) {
    await handle.close();
    await fs.unlink(destination);
    throw error;
  }
  await handle.close();
}

async function save(s, draft, still_current = () => true) {
  const file = draft_input(s, draft);
  const conflict = () => Error(vscode.l10n.t('The file has changed. Your draft is still available.'));
  if (file.base !== draft.base) throw conflict();
  const actual = await projectFile(s.setup.app, file.file, file.kind, file.creating);
  if (!still_current()) throw conflict();
  if (file.creating) return write_new_file(actual, draft.text);

  const uri = vscode.Uri.file(file.file);
  const doc = await vscode.workspace.openTextDocument(uri);
  const original = await readText(uri);
  if (!still_current() || doc.isDirty || fingerprint(original) !== file.base || doc.getText() !== file.text) throw conflict();
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, new vscode.Range(doc.positionAt(0),doc.positionAt(doc.getText().length)), draft.text);
  if (!await vscode.workspace.applyEdit(edit) || !await doc.save())
    throw Error(vscode.l10n.t('Could not save the configuration input.'));
}

/** A copy belongs to the location explicitly chosen in the native dialog. Keep the active draft intact. */
async function save_copy(s, draft, still_current) {
  const file = draft_input(s, draft);
  const type = inputTypes[file.kind];
  const source = path.parse(file.file);
  const uri = await saveFileAs({
    title:vscode.l10n.t('Save a copy of the configuration draft'),
    filters:{[vscode.l10n.t(type.label)]:[type.extension]},
    defaultUri:vscode.Uri.file(path.join(source.dir, source.name + '-copy' + source.ext))
  });
  if (!uri || !still_current()) return;
  if (uri.scheme !== 'file' || path.extname(uri.fsPath).toLowerCase() !== '.' + type.extension)
    throw Error(vscode.l10n.t('Choose a local .{0} file for the copy.', type.extension));
  const source_path = path.join(await fs.realpath(source.dir), source.base);
  const output_path = path.join(await fs.realpath(path.dirname(uri.fsPath)), path.basename(uri.fsPath));
  if (!path.relative(source_path, output_path))
    throw Error(vscode.l10n.t('Choose a different filename for the copy.'));
  if (!still_current()) return;
  await write_new_file(output_path, (file.bom ? '\uFEFF' : '') + draft.text);
  return output_path;
}

module.exports={inputs,symbols,save,save_copy,pickInput,projectFile};
