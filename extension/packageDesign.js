'use strict';
const fs=require('node:fs');
const path=require('node:path');
const source=path.join(__dirname,'..','design'), output=path.join(__dirname,'media','design');
for(const name of ['index.html','fuzzy.js','pathDisplay.js','workbench.css','appearance.css','appearance.js','build-context.js','configuration-inputs.js','build-panel.js','toolchain-controls.js','build-panel.css','configuration-tree.js','configuration-workspace.js','configuration-map-navigation.css','configuration-workspace.css','module-pagination.js','module-lists.js','module-lists.css','module-sources.js','module-identification.js','probe-list.js','vendor/js-yaml/js-yaml.min.js','vendor/js-yaml/LICENSE']){
  const target=path.join(output,name);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.copyFileSync(path.join(source,name),target);
}
for (const name of ['flashPanel.js','flashPlan.js'])
  fs.copyFileSync(path.join(source,name),path.join(__dirname,'media',name));
