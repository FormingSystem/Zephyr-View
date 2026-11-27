'use strict';

const assert=require('node:assert/strict');
const {test}=require('node:test');
const {uml_templates}=require('../extension/umlTemplates');

test('covers the UML diagram families, including four interaction diagrams',()=>{
  const ids=group=>uml_templates.filter(item=>item.group===group).map(item=>item.id).sort();
  assert.deepEqual(ids('structure'),['class','component','composite-structure','deployment','object','package','profile']);
  assert.deepEqual(ids('behavior'),['activity','state-machine','use-case']);
  assert.deepEqual(ids('interaction'),['communication','interaction-overview','sequence','timing']);
  assert.equal(uml_templates.length,14);
});

test('each template provides a bilingual purpose and one self-contained editable diagram',()=>{
  for (const item of uml_templates) {
    assert.match(item.zh,/[\u4e00-\u9fff]/);
    assert.match(item.en,/[A-Za-z]/);
    assert.match(item.descriptionZh,/[\u4e00-\u9fff]/);
    assert.match(item.descriptionEn,/[A-Za-z]/);
    assert.match(item.source,/^@startuml\n[\s\S]+\n@enduml\n$/);
    assert.equal(item.source.match(/^@startuml$/gm).length,1);
    assert.doesNotMatch(item.source,/^\s*!|https?:\/\//m);
  }
});

test('templates built from other PlantUML notations identify their representation',()=>{
  for (const id of ['composite-structure','profile','communication','interaction-overview']) {
    const template=uml_templates.find(item=>item.id===id);
    assert.match(template.descriptionZh,/PlantUML/);
    assert.match(template.descriptionEn,/PlantUML/);
  }
});
