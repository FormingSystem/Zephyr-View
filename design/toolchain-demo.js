'use strict';

/* Fixtures for the interactive design. They never execute a compiler or inspect the host PATH. */
const demo_compiler = new compiler_selection((scope,id) => {
  if (demo_compiler_scope() !== scope) return;
  const selected = model.demoCompilerSelection ??= {};
  if (id === 'auto') delete selected[scope];
  else selected[scope] = id;
  commitDemo();
}, (scope, action) => demo_prefix_picker(scope, action === 'compilerBrowse'));

function demo_compiler_scope() {return JSON.stringify([model.activeWs,appKey(),model.board]);}
function demo_board_roots() {return model.demoBoardRoots?.[model.activeWs || appKey()] || [];}

function demo_compiler_definition(name) {
  return ['CMAKE_C_COMPILER','CMAKE_TOOLCHAIN_FILE','ZEPHYR_TOOLCHAIN_VARIANT','TOOLCHAIN_VARIANT_COMPILER','CROSS_COMPILE'].includes(name) ||
    name === 'CROSS_COMPILE_'+(model.board || '').replace(/@[^/]*/,'').replaceAll('/','_');
}

function demo_target_compiler_inputs(definitions) {
  const chosen = model.demoCompilerSelection?.[demo_compiler_scope()];
  if (!chosen) return definitions;
  const external = model.demoExternalGcc?.[chosen];
  const settings = external ? ['ZEPHYR_TOOLCHAIN_VARIANT=cross-compile','CROSS_COMPILE='+external.path.replace(/gcc(?:\.exe)?$/i,'')] :
    ['ZEPHYR_TOOLCHAIN_VARIANT=zephyr'];
  return [...settings.map(setting=>({...parseExampleDefinition(setting),source:'当前目标编译器'})),
    ...definitions.filter(definition=>!demo_compiler_definition(definition.name))];
}

function demo_compiler_catalog() {
  const scope = demo_compiler_scope();
  const sdk = settingsFor('SDK'), cross = activeVariant() === 'cross-compile';
  // Only the board metadata shipped with this sample identifies the architecture.
  const architecture = model.board === 'mps2/an386' ? 'arm' : undefined;
  const options = [];
  if (architecture && sdk?.source && sdk.ok) {
    options.push({id:'sdk:gnu',label:'GNU · arm-zephyr-eabi',source:'sdk',family:'gnu',compatibility:'sdk',
      path:sdk.source+'/arm-zephyr-eabi/bin/arm-zephyr-eabi-gcc'});
  }
  for (const [id, option] of Object.entries(model.demoExternalGcc || {})) options.push({...option,id});
  const chosen = model.demoCompilerSelection?.[scope];
  for (const option of options) option.selected = option.id === chosen;
  const configured = matchingExampleCache()?.values.CMAKE_C_COMPILER?.value;
  const requestedDefinitions = exampleArguments().split(/\r?\n/).map(line=>line.trim().replace(/^-D/,''))
    .filter(line=>demo_compiler_definition(line.split(/[=:]/,1)[0]));
  const requested = requestedDefinitions[0];
  return {scope, options, architecture, architecture_source:architecture ? 'board metadata' : undefined,
    mode:cross?'cross':'sdk', variant:activeVariant(), configured, requested, requestedDefinitions, overridden:Boolean(chosen),
    recommendedId:requested && !chosen ? undefined : options.find(option=>option.compatibility==='sdk')?.id,
    reason:!model.board?'selectBoard':requested && !chosen?'explicit':!architecture?'architecture':!options.length?'unavailable':undefined};
}

function demo_environment_state() {
  const fields = exampleEnvironment().map(row=>({name:row.name,value:row.value,source:row.source}));
  const prefix = model.env.workspacePrefix;
  if (prefix !== undefined && !fields.some(row=>row.name==='CROSS_COMPILE')) fields.push({name:'CROSS_COMPILE',value:prefix,source:'override'});
  const cache = matchingExampleCache()?.values || {};
  for (const field of fields) {
    field.cached=cache[field.name]?.value;field.matches=field.value===field.cached;field.cacheKey=field.name;
  }
  return {folder:model.activeWs||appKey(),board:model.board,page,trusted:true,compilerChoices:demo_compiler_catalog(),environmentRows:fields,
    extraRoots:demo_board_roots(),overrides:prefix ? ['CROSS_COMPILE'] : []};
}

async function demo_prefix_picker(scope, browse, workspace=false) {
  const entry=browse?await chooseBrowserEntry(false):undefined;
  if (scope!==demo_compiler_scope() || (browse&&!entry))return;
  const suffix=entry?.name.match(/^(.+-)gcc(?:\.exe)?$/i);
  if(entry&&!suffix)return notify('请选择以 -gcc 或 -gcc.exe 结尾的交叉编译器。');
  const prefix=suffix?.[1] || (workspace ? model.env.workspacePrefix : '') || '';
  show('外部 GNU 工具链',inputField('demo-gnu-prefix','工具名前缀 · CROSS_COMPILE',ZephyrPathDisplay.path(prefix),'arm-none-eabi-')+
    '<small>设计演示使用所选文件的名称。可补全本地目录或保留由 PATH 解析的工具名前缀。</small>'+
    '<button type="button" id="demo-use-prefix" class="primary">应用前缀</button>');
  $('#demo-use-prefix').onclick=()=>{
    const field=$('#demo-gnu-prefix'), value=field.value.trim();
    field.setCustomValidity(value.endsWith('-')?'':'请输入以连字符结尾的 GNU 工具名前缀。');
    if(!field.reportValidity()||scope!==demo_compiler_scope())return;
    const id='external:'+value;
    (model.demoExternalGcc??={})[id]={label:value+'gcc',path:value+'gcc',source:'prefix',family:'gnu',compatibility:'unverified'};
    if(workspace)model.env.workspacePrefix=value;
    else (model.demoCompilerSelection??={})[scope]=id;
    $('#dialog').close();commitDemo();
  };
}

async function demo_board_root_picker(browse) {
  const key=model.activeWs||appKey(),entry=browse?await chooseBrowserEntry(true):undefined;
  if((browse&&!entry)||key!==(model.activeWs||appKey()))return;
  show('添加自定义开发板目录',inputField('demo-board-root','包含 boards/ 的目录',entry?.name||'','相对或绝对目录')+
    '<button id="demo-use-board-root" type="button" class="primary">添加目录</button>');
  $('#demo-use-board-root').onclick=()=>{
    const path=$('#demo-board-root').value.trim().replaceAll('\\','/').replace(/\/boards\/?$/,'').replace(/\/+$/,'');
    if(!path||key!==(model.activeWs||appKey()))return;
    (model.demoBoardRoots??={})[key]=[...new Set([...demo_board_roots(),path])];
    $('#dialog').close();invalidate();commitDemo();
  };
}

function demo_toolchain_action(action,name) {
  if(name==='BOARD_ROOT'){
    if(action==='inherit'){if(model.demoBoardRoots)delete model.demoBoardRoots[model.activeWs||appKey()];invalidate();return commitDemo();}
    return demo_board_root_picker(action==='edit');
  }
  if(name==='CROSS_COMPILE'){
    if(action==='inherit'){delete model.env.workspacePrefix;return commitDemo();}
    return demo_prefix_picker(demo_compiler_scope(),action==='edit',true);
  }
}
document.addEventListener('click',event=>{
  const remove=event.target.closest('[data-remove-board-root]');
  if(!remove)return;
  (model.demoBoardRoots??={})[model.activeWs||appKey()]=demo_board_roots().filter(path=>path!==remove.dataset.removeBoardRoot);
  invalidate();commitDemo();
});
