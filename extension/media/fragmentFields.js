'use strict';
// Locate assignments in the input itself. Zephyr evaluates dependencies on configure.
const fragmentFields=(()=>{
  let filter='',chosen='',context='';
  function scan(text,kind){
    if(kind==='kconfig')return kconfigFields.assignments(text);
    const property=/^([ \t]*)status\s*=\s*"(okay|disabled|reserved|fail(?:-[^"]+)?)"\s*;[ \t]*(?:\/\/[^\r\n]*)?\r?$/gm;
    return Array.from(text.matchAll(property),match=>{
      const line=match[0].replace(/\r$/,'');
      return {key:'status · L'+text.slice(0,match.index).split('\n').length,value:match[2],
        start:match.index,end:match.index+line.length,at:match.index+line.indexOf('"')+1};
    });
  }
  function render(file,text,catalog,editable=true){
    if(file.file!==context){context=file.file;chosen='';filter='';}
    const k=file.kind==='kconfig',values=scan(text,file.kind);
    const byName=new Map((catalog?.items||[]).map(item=>[item.name,item]));
    const names=new Set(values.map(o=>o.key));
    if(k)for(const key of byName.keys())names.add(key);
    const query=filter.trim().toLowerCase();
    const terms=[...names].filter(key=>[key,byName.get(key)?.prompt,byName.get(key)?.menu]
      .some(term=>term&&fuzzy(term.toLowerCase(),query)));
    const name=terms.includes(chosen)?chosen:terms[0],current=values.find(o=>o.key===name),item=byName.get(name);
    const label=k?tr('搜索符号、提示或菜单','Search symbols, prompts or menus'):tr('筛选配置项','Filter settings');
    const select='<input type="search" class="input" id="field-search" aria-label="'+label+'" placeholder="'+label+'" value="'+esc(filter)+'">'+
      '<select id="field-name" aria-label="'+tr('配置项','Setting')+'">'+terms.map(n=>'<option value="'+esc(n)+'"'+(name===n?' selected':'')+'>'+
      esc([n,byName.get(n)?.prompt].filter(Boolean).join(' · '))+'</option>').join('')+'</select>';
    if(!name)return '<div class="fragment-fields">'+select+'<small>'+tr('没有匹配项','No matches')+'</small></div>';
    const value=current?.value??'';
    const field=k?kconfigFields.control(item,current,values,byName):'<select id="field-value">'+[...new Set(['okay','disabled','reserved','fail',value])].map(v=>'<option '+(value===v?'selected':'')+'>'+esc(v)+'</option>').join('')+'</select>';
    const meta=item?'<small>'+esc([item.menu,item.type,item.range?.join(' … '),tr('构建值','Configured value')+' = '+item.value].filter(Boolean).join(' · '))+'</small>':'';
    const help=item?.help?'<details><summary>'+tr('符号帮助','Symbol help')+'</summary><p>'+esc(item.help)+'</p></details>':'';
    return '<div class="fragment-fields">'+select+meta+help+'<label>'+tr('草稿值','Draft value')+field+'</label><div class="actions">'+
      b(tr('加入草稿','Stage value'),'field:stage','','',!editable||(!item?.choice&&item?.allowed?.length<2))+
      (k&&current?b(tr('移除显式赋值','Remove assignment'),'field:remove','plain'):'')+'</div></div>';
  }
  function apply(file,text,name,value,remove,catalog){
    if(file.kind==='kconfig')return kconfigFields.apply(text,name,value,remove,catalog);
    const matches=scan(text,file.kind).filter(o=>o.key===name);
    if(matches.length>1)throw Error(tr('有重复赋值，请在文件草稿中核对。','Multiple assignments found. Review the file draft.'));
    const entry=matches[0];
    if(!entry)return text;
    return text.slice(0,entry.at)+value+text.slice(entry.at+entry.value.length);
  }
  return {render,apply,search(value){filter=value;},choose(value){chosen=value;}};
})();
