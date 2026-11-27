'use strict';

const {open_canvas}=require('./umletModeling');
const {uml_templates}=require('./umlTemplates');
const {model_uri,preview_model}=require('./plantumlPreview');

const filters={PlantUML:['puml','plantuml']};

function template_choices(vscode,t) {
  const choices=[{label:t('打开已有图…','Open existing diagram…'),action:'open'},
    {label:t('自由布局画布（UMLet）…','Free-layout canvas (UMLet)…'),action:'canvas',
      detail:t('拖放图元，编辑或新建 .uxf 文件','Drag shapes in a new or existing .uxf file')}];
  const groups={structure:t('结构图','Structure'),behavior:t('行为图','Behavior'),interaction:t('行为图 · 交互','Behavior · Interactions')};
  for (const [group,label] of Object.entries(groups)) {
    choices.push({label,kind:vscode.QuickPickItemKind.Separator});
    for (const item of uml_templates.filter(item=>item.group===group)) {
      choices.push({label:t(item.zh,item.en),description:t(item.en,item.zh),detail:t(item.descriptionZh,item.descriptionEn),item});
    }
  }
  return choices;
}

async function create_model(vscode,item,folder,t) {
  const {workspace,window}=vscode;
  const uri=await window.showSaveDialog({defaultUri:folder && vscode.Uri.joinPath(folder,item.id+'.puml'),
    title:t('新建 UML 图','Create UML diagram'),filters});
  if (!uri) return;
  if (!model_uri(uri)) {
    await window.showWarningMessage(t('请使用 .puml 或 .plantuml 扩展名。','Use a .puml or .plantuml file extension.'));
    return;
  }
  const edit=new vscode.WorkspaceEdit();
  edit.createFile(uri,{overwrite:false,contents:Buffer.from(item.source,'utf8')});
  if (!await workspace.applyEdit(edit)) {
    await window.showWarningMessage(t('无法新建图文件。请选一个可写目录和未使用的文件名。',
      'Could not create the diagram. Choose a writable directory and an unused filename.'));
    return;
  }
  return uri;
}

async function open_modeling(vscode,folder,t) {
  const {window,workspace}=vscode;
  const choice=await window.showQuickPick(template_choices(vscode,t),{title:t('UML 建模','UML modeling'),
    placeHolder:t('搜索图种、用途，或打开已有图','Find a diagram by type or purpose, or open an existing model'),
    matchOnDescription:true,matchOnDetail:true});
  if (!choice) return;
  if (choice.action==='canvas') return open_canvas(vscode,folder,t);
  const uri=choice.action==='open' ? (await window.showOpenDialog({defaultUri:folder,filters,canSelectMany:false,
    canSelectFiles:true,canSelectFolders:false}))?.[0] : await create_model(vscode,choice.item,folder,t);
  if (uri) return window.showTextDocument(await workspace.openTextDocument(uri),{preview:false});
}

function register_uml_modeling(vscode,register,target) {
  const t=(zh,en)=>vscode.env.language.startsWith('zh') ? zh : en;
  register('umlModeling',folder=>open_modeling(vscode,folder?.scheme ? folder : target.folder()?.uri,t));
  register('previewUml',uri=>preview_model(vscode,uri?.scheme ? uri : vscode.window.activeTextEditor?.document.uri,t));
}

module.exports={open_modeling,register_uml_modeling};
