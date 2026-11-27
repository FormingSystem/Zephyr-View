'use strict';

// Emit source spelling as literal text, including macro punctuation and PlantUML delimiters.
function literal(value) {
  return Array.from(String(value).replace(/\s+/g,' ').trim(), ch =>
    /^[\p{L}\p{N}_ .,:*()&=/+-]$/u.test(ch) ? ch : '<U+'+ch.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')+'>'
  ).join('');
}

const arrows = {composition:'*--',association:'-->',inheritance:'--|>'};
const type_kinds = new Set(['struct','union','enum','class']);

/** Serialize the same resolved types shown in the studio. IDs stay internal to this file. */
function class_diagram_text(diagram) {
  const lines=['@startuml','hide empty members','skinparam classAttributeIconSize 0'];
  const aliases=new Map();
  for (const node of diagram.nodes) {
    const alias='T'+(aliases.size+1);
    aliases.set(node.id,alias);
    const kind=type_kinds.has(node.kind) ? node.kind : 'type';
    const suffix=node.conditional ? ' <<conditional>>' : '';
    lines.push('class "'+literal(node.name)+'" as '+alias+' <<'+kind+'>>'+suffix+' {');
    for (const member of node.members) {
      lines.push('  '+literal(member.name)+(member.conditional?' [conditional]':''));
    }
    lines.push('}');
  }
  for (const edge of diagram.edges) {
    const from=aliases.get(edge.from),to=aliases.get(edge.to),arrow=arrows[edge.kind];
    if (!from || !to || !arrow) continue;
    const caption=[literal(edge.label || ''),edge.conditional?'[conditional]':''].filter(Boolean).join(' ');
    lines.push(from+' '+arrow+' '+to+(caption?' : '+caption:''));
  }
  return [...lines,'@enduml',''].join('\n');
}

module.exports={class_diagram_text};
