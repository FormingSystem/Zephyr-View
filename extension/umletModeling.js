'use strict';

const extension_id='theumletteam.umlet';
const view_type='uxfCustoms.umletEditor';
const filters={UMLet:['uxf']};

async function create_canvas(vscode,folder,t) {
  const uri=await vscode.window.showSaveDialog({
    title:t('新建 UMLet 画布','Create UMLet canvas'),filters,
    defaultUri:folder && vscode.Uri.joinPath(folder,'diagram.uxf')
  });
  if (!uri) return;
  if (!/\.uxf$/i.test(uri.path)) {
    await vscode.window.showWarningMessage(t('画布文件需要 .uxf 扩展名。','Use the .uxf extension for a canvas.'));
    return;
  }
  // UMLet opens an empty file as a new canvas. Refuse an existing target even after the dialog.
  const edit=new vscode.WorkspaceEdit();
  edit.createFile(uri,{overwrite:false});
  if (await vscode.workspace.applyEdit(edit)) return uri;
  await vscode.window.showWarningMessage(t('无法新建画布。请选择可写目录和未使用的文件名。',
    'Could not create the canvas. Choose a writable directory and an unused filename.'));
}

async function open_canvas(vscode,folder,t) {
  const {extensions,window,commands}=vscode;
  if (!extensions.getExtension(extension_id)) {
    const details=t('查看 UMLet 扩展','View UMLet extension');
    if (await window.showInformationMessage(t('拖放画布需要 UMLet 扩展。','The drag-and-drop canvas requires UMLet.'),details)===details) {
      await commands.executeCommand('extension.open',extension_id);
    }
    return;
  }
  const choices=[{label:t('新建画布…','Create canvas…'),create:true},{label:t('打开画布…','Open canvas…')}];
  const choice=await window.showQuickPick(choices,{title:t('自由布局画布（UMLet）','Free-layout canvas (UMLet)')});
  if (!choice) return;
  const uri=choice.create ? await create_canvas(vscode,folder,t) :
    (await window.showOpenDialog({defaultUri:folder,filters,canSelectFiles:true,canSelectFolders:false,canSelectMany:false}))?.[0];
  if (uri && /\.uxf$/i.test(uri.path)) await commands.executeCommand('vscode.openWith',uri,view_type);
}

module.exports={open_canvas};
