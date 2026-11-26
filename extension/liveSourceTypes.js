'use strict';

const type_kinds = new Set(['struct','union','enum']);
const identifier = /^[A-Za-z_]\w*$/;

/** Read members as written. Jump past nested declarators so their separators stay in their parent. */
function read_members(source,tokens,pairs,left,right,kind) {
  const separator = kind==='enum' ? ',' : ';', members=[];
  let start=left+1, count=0;
  for (let index=start;index<=right;index++) {
    if (index!==right && tokens[index].value!==separator) {
      if (pairs.get(index)>index) index=pairs.get(index);
      continue;
    }
    if (start<index) {
      count++;
      if (members.length<32) {
        const token=tokens[start], end=tokens[index-1].end;
        const text=source.slice(token.start,Math.min(end,token.start+160)).replace(/\s+/g,' ').trim();
        members.push({name:end-token.start>160 ? text+'…' : text, line:token.line});
      }
    }
    start=index+1;
  }
  return {members,count};
}

/** Index named aggregate definitions and simple aliases from the same tokens as the relationship scan. */
function source_types(source,tokens,pairs) {
  const types=[];
  for (let i=0;i<tokens.length;i++) {
    const token=tokens[i], kind=token.value;
    if (kind==='typedef') {
      let end=i+1;
      while (end<tokens.length && (identifier.test(tokens[end].value) || tokens[end].value==='*')) end++;
      const alias=tokens[end-1];
      if (end>i+2 && tokens[end]?.value===';' && identifier.test(alias.value)) {
        types.push({kind:'typedef',name:alias.value,line:alias.line,members:[],count:0});
      }
    }
    if (!type_kinds.has(kind)) continue;
    const tag=identifier.test(tokens[i+1]?.value || '') ? tokens[i+1] : undefined;
    const left=i+(tag ? 2 : 1);
    if (tokens[left]?.value!=='{') continue;
    const right=pairs.get(left);
    const alias=tokens[i-1]?.value==='typedef' && identifier.test(tokens[right+1]?.value || '') ? tokens[right+1] : undefined;
    if (!tag && !alias) continue;
    const name=tag && alias && tag.value!==alias.value ? tag.value+' / '+alias.value : (tag || alias).value;
    types.push({kind,name,line:token.line,...read_members(source,tokens,pairs,left,right,kind)});
  }
  return types;
}

module.exports = {source_types};
