'use strict';

const extension_id='jebbs.plantuml';
const model_uri=uri=>/\.(puml|plantuml)$/i.test(uri?.path || '');

async function preview_model(vscode,uri,t) {
  if (!model_uri(uri)) return;
  const {window,workspace,extensions,commands}=vscode;
  if (!extensions.getExtension(extension_id)) {
    const details=t('查看 PlantUML 扩展','View PlantUML extension');
    const choice=await window.showInformationMessage(t('预览需要 PlantUML 扩展。图文件可以继续编辑。',
      'Install PlantUML to preview this diagram. You can continue editing the file.'),details);
    if (choice===details) return commands.executeCommand('extension.open',extension_id);
    return;
  }
  if (!workspace.isTrusted) return window.showInformationMessage(t('预览需要受信任的工作区。','Preview requires a trusted workspace.'));
  const editor=await window.showTextDocument(await workspace.openTextDocument(uri),{preview:false});
  if (workspace.getConfiguration('plantuml',uri).get('render')==='PlantUMLServer') {
    const confirm=t('使用已配置的服务器预览','Preview using configured server');
    if (await window.showInformationMessage(t('PlantUML 将把图的文本发送到配置的渲染服务器。',
      'PlantUML will send the diagram text to the configured rendering server.'),confirm)!==confirm) return;
  }
  if (window.activeTextEditor===editor && editor.document.uri.toString()===uri.toString())
    return commands.executeCommand('plantuml.preview');
}

module.exports={extension_id,model_uri,preview_model};
