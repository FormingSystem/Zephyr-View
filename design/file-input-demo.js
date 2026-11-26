'use strict';

// The browser prototype uses sample files; the installed extension obtains paths from VS Code.
const demo_input_variables = {dts:'DTS_SOURCE', kconfig:'CONF_FILE', overlay:'DTC_OVERLAY_FILE'};
const demo_file_scope = () => JSON.stringify([exampleAppId(),model.board,dir()]);
const demo_file_choices = () => model.chosenInputs?.[demo_file_scope()] || {};

function demo_input_groups() {
  const tree = currentExampleDevicetree(), app = appKey();
  const defaults = {dts:tree.boardFile ? [tree.boardFile] : [], kconfig:[app+'/prj.conf'], overlay:tree.overlays || []};
  const samples = {dts:defaults.dts,kconfig:[app+'/prj.conf',app+'/profiles/debug.conf'],overlay:[app+'/app.overlay']};
  const raw = exampleArguments().split(/\r?\n/).map(line => {
    try { return parseExampleDefinition(line); } catch { return {}; }
  });
  return Object.fromEntries(Object.entries(demo_input_variables).map(([kind,variable]) => {
    const manual = demo_file_choices()[kind], arg = raw.findLast(entry => entry.name === variable);
    const files = manual || (arg ? arg.value.split(';').filter(Boolean) : defaults[kind]);
    const source = manual ? 'manual' : arg ? 'argument' : model.configured ? 'configured' : 'automatic';
    const status = files.length ? 'resolved' : kind === 'overlay' ? 'optional' : 'configure';
    return [kind,{variable,files,source,status,candidates:[...new Set([...files,...samples[kind]])],missing:[]}];
  }));
}

function save_demo_files(kind, files) {
  const id = demo_file_scope();
  model.chosenInputs ??= {};
  const choices = model.chosenInputs[id] ??= {};
  if (files) choices[kind] = files;
  else delete choices[kind];
  invalidate();
  $('#dialog').close();
  commitDemo();
}

function browse_demo_inputs(kind) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = {dts:'.dts',kconfig:'.conf',overlay:'.overlay'}[kind];
  input.multiple = kind !== 'dts';
  input.onchange = () => { if(input.files.length)save_demo_files(kind,[...input.files].map(file=>file.name)); };
  input.click();
}

function choose_demo_inputs(kind,action) {
  const group = demo_input_groups()[kind];
  const items = action === 'order' ? [...group.files] : group.candidates;
  const selected = action === 'order' ? [] : items.filter(file=>group.files.includes(file));
  const title = (action === 'order' ? '按合并顺序依次勾选 · ' : '')+group.variable;
  show(title,'<label>搜索文件<input id="demo-input-search" type="search"></label><div id="demo-input-items"></div>'+
    '<button id="demo-input-apply" class="primary">应用</button>');
  function refresh() {
    const choices = items.filter(file=>fuzzy(file,$('#demo-input-search').value));
    $('#demo-input-items').innerHTML = choices.map(file=>'<label><input type="'+(kind==='dts'?'radio':'checkbox')+
      '" name="demo-file" value="'+esc(file)+'"'+(selected.includes(file)?' checked':'')+'> '+esc(file)+'</label>').join('');
    $('#demo-input-apply').disabled = action === 'order' ? selected.length !== items.length : !selected.length;
  }
  $('#demo-input-search').oninput = refresh;
  $('#demo-input-items').onchange = ({target}) => {
    if (kind === 'dts') selected.length = 0;
    if (target.checked) selected.push(target.value);
    else selected.splice(selected.indexOf(target.value),1);
    refresh();
  };
  $('#demo-input-apply').onclick = () => save_demo_files(kind,selected);
  refresh();
}

document.addEventListener('click',event => {
  const button = event.target.closest('[data-input-action],[data-input-path]');
  if (!button || button.disabled) return;
  if (button.dataset.inputPath) return show('构建输入文件','<code>'+esc(button.dataset.inputPath)+'</code>');
  const {inputKind:kind,inputAction:action} = button.dataset;
  if (action === 'reset') return save_demo_files(kind,null);
  if (action === 'browse') return browse_demo_inputs(kind);
  choose_demo_inputs(kind,action);
});
