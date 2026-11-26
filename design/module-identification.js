'use strict';

const descriptions=['zephyr/module.yml','zephyr/module.yaml'];
const legacy=['zephyr/CMakeLists.txt','zephyr/Kconfig'];
let recognized=null, serial=0, recognitionTimer;
const inputValue=id=>$(id)?.value.trim()||'';
const sourceKey=()=>JSON.stringify([inputValue('#origin-url'),inputValue('#origin-rev'),inputValue('#origin-path')]);
function resetRecognition(){
  serial++;clearTimeout(recognitionTimer);recognized=null;
  if($('#identity-result'))$('#identity-result').textContent='';
  if($('[data-act="originadd"]'))$('[data-act="originadd"]').disabled=true;
}
function identify(record,token){
  if(serial!==token||!$('#identity-result'))return;
  const fallback=inputValue('#origin-path').split(/[\\/]/).filter(Boolean).pop();
  let name=record.subdir?.split('/').pop()||fallback;
  if(!record.legacy){
    const meta=jsyaml.load(record.yaml,{schema:jsyaml.JSON_SCHEMA});
    if(!meta||typeof meta!=='object'||Array.isArray(meta))throw Error('模块描述文件需要 YAML 映射。');
    name=Object.hasOwn(meta,'name')?meta.name:fallback;
  }
  if(typeof name!=='string'||!name.trim())throw Error('模块名称无效。');
  const evidence=record.file||legacy.join(' + ');
  if(record.repo&&record.revision&&!inputValue('#origin-rev'))$('#origin-rev').value=record.revision;
  recognized={key:sourceKey(),name,evidence,sha:record.sha,subdir:record.subdir||'',url:record.repo?.url,revision:record.revision};
  const file=record.subdir?record.subdir+'/'+evidence:evidence;
  $('#identity-result').textContent=['已识别 '+name,ZephyrPathDisplay.path(file),record.sha?'提交 '+record.sha.slice(0,12):''].filter(Boolean).join(' · ');
  if($('[data-act="originadd"]'))$('[data-act="originadd"]').disabled=false;
  sourceMessage('');
}
function repositoryLink(value){
  const address=value.replace(/^(?:www\.)?(github\.com|gitee\.com)\//i,'https://$1/');
  if(!usableUrl(address))throw Error('请输入 GitHub、Gitee 网页链接或 Git 仓库地址。');
  const scp=/^git@([^:]+):(.+)$/.exec(address);
  const url=new URL(scp?'ssh://git@'+scp[1]+'/'+scp[2]:address);
  const name=url.pathname.split('/').filter(Boolean).pop()?.replace(/\.git$/,'');
  if(!name)throw Error('地址缺少仓库名。');
  const host=url.hostname.toLowerCase().replace(/^www\./,'');
  const platform={'github.com':'GitHub','gitee.com':'Gitee'}[host];
  if(!platform)return {url:address,name,platform:host};
  const [owner,repo,route,...rest]=url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if(!owner||!repo||![owner,repo].every(s=>/^[\w.-]+$/.test(s)))throw Error('地址中缺少有效的仓库所有者或仓库名。');
  if(route&&(!['tree','blob'].includes(route)||!rest.length))throw Error('请粘贴仓库首页、分支目录页或模块入口文件页。');
  const slug=owner+'/'+repo.replace(/\.git$/,'');
  return {platform,slug,name:slug.split('/')[1],route,tail:rest.join('/'),url:url.protocol==='ssh:'?address:'https://'+host+'/'+slug+'.git'};
}
async function providerJson(repo,resource){
  const base=repo.platform==='GitHub'?'https://api.github.com/repos/':'https://gitee.com/api/v5/repos/';
  const r=await fetch(base+repo.slug+resource,{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(15000)});
  if(r.status===404||r.status===422)return null;
  if(!r.ok)throw Error(repo.platform+' 返回 '+r.status+'；可在本机预览中使用 Git 凭据读取。');
  return r.json();
}
async function browserRef(repo,override){
  const parts=repo.tail?repo.tail.split('/'):[];
  // A ref can contain slashes. A commit lookup proves which prefix names a ref.
  for(let count=parts.length;count>0;count--){
    const ref=parts.slice(0,count).join('/');
    const commit=await providerJson(repo,'/commits/'+encodeURIComponent(ref));
    if(!commit?.sha)continue;
    let subdir=parts.slice(count).join('/');
    if(repo.route==='blob'){
      const marker=[...descriptions,...legacy].find(f=>subdir===f||subdir.endsWith('/'+f));
      if(!marker)throw Error('请选择模块入口文件或模块目录。');
      subdir=subdir.slice(0,-marker.length).replace(/\/$/,'');
    }
    return {revision:override||ref,subdir,sha:!override||override===ref?commit.sha:undefined};
  }
  if(parts.length)throw Error('该链接的版本无法访问。');
  return {revision:override||(await providerJson(repo,''))?.default_branch||'HEAD',subdir:''};
}
async function browserMetadata(repo,override){
  if(!repo.slug)throw Error('请在本机预览服务中识别此 Git 地址。');
  const result=await browserRef(repo,override);
  result.sha??=(await providerJson(repo,'/commits/'+encodeURIComponent(result.revision)))?.sha;
  if(!result.sha)throw Error('仓库或版本无法访问。');
  const dir=(result.subdir?result.subdir.split('/').map(encodeURIComponent).join('/')+'/':'')+'zephyr';
  const endpoint='/contents/'+dir,ref='?ref='+result.sha;
  const entries=await providerJson(repo,endpoint+ref);
  const files=new Map((Array.isArray(entries)?entries:[]).filter(e=>e.type==='file').map(e=>['zephyr/'+e.name,e]));
  for(const file of descriptions){
    if(!files.has(file))continue;
    if(files.get(file).size>1048576)throw Error('描述文件过大。');
    const blob=await providerJson(repo,endpoint+'/'+file.split('/')[1]+ref);
    if(blob?.encoding!=='base64')throw Error('无法读取模块描述。');
    return {...result,file,yaml:new TextDecoder().decode(Uint8Array.from(atob(blob.content),c=>c.charCodeAt(0)))};
  }
  if(legacy.every(f=>files.has(f)))return {...result,legacy:true};
  throw Error('该版本的指定目录没有 Zephyr 模块入口。');
}
async function detectSource(){
  resetRecognition();const token=serial,remote=!!$('#origin-url'),rev=inputValue('#origin-rev');
  try{
    const repo=remote?repositoryLink(inputValue('#origin-url')):null;
    if(repo&&!inputValue('#origin-path')){
      $('#origin-path').value='modules/'+repo.name;$('#origin-path').dataset.generated='true';
    }
    if(repo&&model.env.offline&&!onlineInspection)throw Error('当前为离线模式；可选择已有检出目录，或允许联网后识别。');
    if(!inputValue('#origin-path'))return;
    sourceMessage('正在读取模块入口…');
    let record;
    if(!repo&&globalThis.zephyrModules){record=await zephyrModules.inspect(inputValue('#origin-path'));}
    else if(location.protocol==='http:'&&location.hostname==='127.0.0.1'){
      const response=await fetch(repo?.route?'/inspect-repository':'/inspect',{method:'POST',headers:{'Content-Type':'application/json','X-Zephyr-Preview':'inspect'},
        body:JSON.stringify({kind:remote?'git':'local',location:repo?.url||inputValue('#origin-path'),revision:rev,route:repo?.route,tail:repo?.tail})});
      if(repo?.route&&[403,404].includes(response.status))record=await browserMetadata(repo,rev);
      else {record=await response.json();if(!response.ok)throw Error(record.error||'无法读取该来源。');}
    }else{
      if(!repo)throw Error('请使用目录选择器，或使用本机预览服务解析目录路径。');
      record=await browserMetadata(repo,rev);
    }
    identify({...record,repo},token);
  }catch(e){if(serial===token)sourceMessage(e.message);}
}
async function checkModuleFolder(files){
  resetRecognition();const token=serial,entries=Array.from(files),root=entries[0]?.webkitRelativePath.split('/')[0];
  if(!root)return;
  try{
    const input=$('#origin-path');
    if(input.value.trim()&&input.value.trim().split(/[\\/]/).filter(Boolean).pop()!==root)throw Error('所选目录与填写路径不同，请核对路径。');
    if(!input.value.trim())input.value=root;
    const map=new Map(entries.map(f=>[f.webkitRelativePath.slice(root.length+1),f]));
    const file=descriptions.find(f=>map.has(f));
    if(!file&&!legacy.every(f=>map.has(f)))throw Error('目录中没有 Zephyr 模块入口。');
    if(file&&map.get(file).size>1048576)throw Error('描述文件过大。');
    identify(file?{file,yaml:await map.get(file).text()}:{legacy:true},token);
  }catch(e){if(token===serial)sourceMessage(e.message);}
}
document.addEventListener('input',e=>{
  if(!$('#identity-result')||!['origin-url','origin-path','origin-rev'].includes(e.target.id))return;
  resetRecognition();sourceMessage('');
  if(e.target.id==='origin-url'&&$('#origin-path').dataset.generated)$('#origin-path').value='';
  if(e.target.id==='origin-path')delete e.target.dataset.generated;
  recognitionTimer=setTimeout(detectSource,700);
});
document.addEventListener('change',e=>{if(e.target.id==='module-folder'&&e.target.files.length){
  const files=Array.from(e.target.files),root=files[0].webkitRelativePath.split('/')[0];e.target.value='';
  query=root;$('#filter').value=root;previewSource('local','');$('#origin-path').value=root;
  $('#import-preview code').textContent=root;checkModuleFolder(files);
}});
document.addEventListener('close',e=>{if(e.target.id==='dialog'&&!e.target.open)resetRecognition();},true);





