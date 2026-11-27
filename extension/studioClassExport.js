'use strict';

const path=require('node:path').posix;
const {class_diagram_text}=require('./plantumlClassDiagram');

/** Save a host-owned UML snapshot selected in the studio. Recheck its revision after the dialog. */
async function export_class_diagram(vscode, source_uri, current_graph, t) {
  if (!current_graph()?.nodes.length) return;
  const name=path.parse(source_uri.path).name+'.puml';
  const target=await vscode.window.showSaveDialog({
    defaultUri:vscode.Uri.joinPath(source_uri,'..',name),
    filters:{PlantUML:['puml','plantuml']},saveLabel:t('导出类图','Export class diagram')
  });
  if (!target) return;
  if (!/\.(puml|plantuml)$/i.test(target.path)) {
    return vscode.window.showWarningMessage(t('请选择 .puml 或 .plantuml 文件。','Choose a .puml or .plantuml file.'));
  }
  const diagram=current_graph();
  if (!diagram?.nodes.length) {
    return vscode.window.showWarningMessage(t('源码已变化，请从当前类图重新导出。','The source changed. Export again from the current diagram.'));
  }
  const open_target=vscode.workspace.textDocuments.find(doc=>doc.uri.toString()===target.toString());
  if (open_target?.isDirty) {
    return vscode.window.showWarningMessage(t('目标图有未保存的编辑，请保存它或选择另一个文件。','The diagram has unsaved edits. Save them or choose another file.'));
  }
  await vscode.workspace.fs.writeFile(target,Buffer.from(class_diagram_text(diagram),'utf8'));
  const edit=t('打开图文件','Open diagram file'), preview=t('用 PlantUML 预览','Preview with PlantUML');
  const actions=vscode.extensions.getExtension('jebbs.plantuml') ? [edit,preview] : [edit];
  const choice=await vscode.window.showInformationMessage(t('已导出类图','Class diagram exported')+' · '+path.basename(target.path),...actions);
  if (!choice) return;
  const doc=await vscode.workspace.openTextDocument(target);
  await vscode.window.showTextDocument(doc,{preview:false});
  if (choice===preview && vscode.window.activeTextEditor?.document.uri.toString()===target.toString()) {
    await vscode.commands.executeCommand('plantuml.preview');
  }
}

module.exports={export_class_diagram};
