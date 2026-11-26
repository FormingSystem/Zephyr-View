'use strict';

const kconfigFields=(()=>{
  function assignments(text){
    const entries=[];
    const lines=/^([ \t]*)(?:(CONFIG_[\w]+)([ \t]*=[ \t]*)("(?:\\.|[^"\\])*"|[^#\s]*)|# (CONFIG_[\w]+) is not set)([^\r\n]*)\r?$/gm;
    for(const match of text.matchAll(lines)){
      const [line,indent,name,separator,value,unset,suffix]=match;
      const start=match.index,end=start+line.replace(/\r$/,'').length;
      entries.push({key:name||unset,value:unset?'n':value,start,end,indent,unset:Boolean(unset),suffix,
        at:unset?undefined:start+indent.length+name.length+separator.length});
    }
    return entries;
  }
  function replace(text,name,value){
    const matches=assignments(text).filter(entry=>entry.key===name);
    if(matches.length>1)throw Error(tr('有重复赋值，请在文件草稿中核对。','Multiple assignments found. Review the file draft.'));
    const entry=matches[0];
    if(!entry){
      if(value===undefined)return text;
      const newline=text.includes('\r\n')?'\r\n':'\n';
      return text+(text&&!text.endsWith('\n')?newline:'')+name+'='+value+newline;
    }
    if(value===undefined){
      const tail=text.slice(entry.end);
      const comment=entry.suffix.trimStart();
      return text.slice(0,entry.start)+(comment.startsWith('#')?entry.indent+comment+tail:tail.replace(/^\r?\n/,''));
    }
    if(entry.unset)return value==='n'?text:text.slice(0,entry.start)+entry.indent+name+'='+value+entry.suffix+text.slice(entry.end);
    return text.slice(0,entry.at)+value+text.slice(entry.at+entry.value.length);
  }
  const stringValue=raw=>/^"(?:\\.|[^"\\])*"$/.test(raw)?raw.slice(1,-1).replace(/\\(.)/g,'$1'):raw;
  function encode(item,value){
    if(!item)return value;
    if(item.type==='string')return '"'+value.replace(/["\\]/g,'\\$&')+'"';
    if(item.allowed&&!item.allowed.includes(value))throw Error(tr('当前依赖不允许此取值。','This value is unavailable under the current dependencies.'));
    if(['hex','int'].includes(item.type)){
      const hex=item.type==='hex';
      if(!(hex?/^(?:0[xX])?[\da-f]+$/i:/^-?\d+$/).test(value))
        throw Error(tr('请输入有效的整数。','Enter a valid integer.'));
      const number=s=>BigInt(hex&&!/^0x/i.test(s)?'0x'+s:s);
      if(item.range&&(number(value)<number(item.range[0])||number(value)>number(item.range[1])))
        throw Error(tr('允许范围','Allowed range')+' '+item.range.join(' … '));
      return hex&&!/^0x/i.test(value)?'0x'+value:value;
    }
    return value;
  }
  function apply(text,name,value,remove,catalog){
    if(!/^CONFIG_\w+$/.test(name))throw Error(tr('请选择配置符号。','Select a symbol.'));
    const item=catalog?.items?.find(entry=>entry.name===name);
    if(remove)return replace(text,name,undefined);
    if(!item?.choice)return replace(text,name,encode(item,value));
    if(!item.choice.includes(value))throw Error(tr('请选择可用的选项。','Select an available choice.'));
    for(const entry of assignments(text)){
      if(entry.key!==value&&item.choice.includes(entry.key)&&entry.value==='y')text=replace(text,entry.key,'n');
    }
    return replace(text,value,'y');
  }
  function control(item,current,entries,byName){
    const value=current?.value??item?.value??'';
    let options;
    if(item?.choice){
      const staged=entries.filter(entry=>item.choice.includes(entry.key)&&entry.value==='y').at(-1)?.key;
      const selected=staged||item.choice.find(name=>byName.get(name)?.value==='y');
      options=item.choice.map(name=>[name,byName.get(name)?.prompt||name,name===selected]);
    }else if(item?.allowed){
      options=item.allowed.map(v=>[v,v,v===value]);
    }
    if(options)return '<select id="field-value"'+(!options.length?' disabled':'')+'>'+
      options.map(([v,label,selected])=>'<option value="'+esc(v)+'"'+(selected?' selected':'')+'>'+esc(label)+'</option>').join('')+'</select>';
    const raw=item?.type==='string'&&current?stringValue(value):value;
    const numeric=item?.type==='int'?' inputmode="numeric"':'';
    return '<input id="field-value" class="input"'+numeric+' value="'+esc(raw)+'">';
  }
  return {assignments,apply,control};
})();
if(typeof module!=='undefined')module.exports=kconfigFields;
