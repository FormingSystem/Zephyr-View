'use strict';

const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const {pickDirectory} = require('./fileDialogs');
const t = (zh,en) => vscode.env.language.toLowerCase().startsWith('zh') ? zh : en;
const exists = async file => !!(await fs.lstat(file).catch(error=>{if(error.code!=='ENOENT')throw error;}));
const directory = async (s,title) => (await pickDirectory({defaultUri:s.folder.uri,title}))?.fsPath;
const select = async (title,choices) => (await vscode.window.showQuickPick(choices.map(([id,label])=>({id,label})),{title}))?.id;
const checkout = s => s.environment.ZEPHYR_BASE || s.target?.zephyrBase;

async function destination(s,leaf) {
  const parent=await directory(s,t('选择安装位置的父目录','Choose the installation parent directory'));
  if(!parent)return;
  const name=await vscode.window.showInputBox({title:t('新安装目录','New installation folder'),value:leaf,
    prompt:parent,validateInput:async value=>{
      const invalidWindowsName=process.platform==='win32' && (/[\\:*?"<>|]/.test(value)||/[. ]$/.test(value)||
        /^(?:CON|AUX|PRN|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(value));
      if(!value.trim() || value==='.' || value==='..' || /[/\x00-\x1f]/.test(value) || invalidWindowsName)
        return t('请输入有效的目录名称','Enter a valid directory name');
      if(await exists(path.join(parent,value)))return t('目录已存在，请选择新名称','This directory exists. Choose a new name.');
    }});
  return name && path.join(parent,name);
}

module.exports={t,exists,directory,select,checkout,destination};
