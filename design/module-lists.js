'use strict';

function modulePageSize(kind) {
  const fontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const width = document.querySelector('[data-module-list="'+kind+'"]')?.clientWidth || document.getElementById('main').clientWidth;
  // Narrow rows wrap their path and status onto extra lines. Budget for those lines at the current font size.
  const verticalPadding = Math.min(window.innerHeight * .022, fontSize * 1.65);
  const narrowLines = matchMedia('(max-height: 620px)').matches ? 6 : 9;
  const rowHeight = width < 28*fontSize ? narrowLines*fontSize : width < 48*fontSize ? 6*fontSize : 3*fontSize+verticalPadding;
  const fraction = kind === 'selected' ? 0.23 : 0.44;
  const maximum = kind === 'selected' ? 4 : 10;
  const minimum = kind === 'selected' ? 2 : 1;
  return Math.max(minimum, Math.min(maximum, Math.floor(window.innerHeight * fraction / rowHeight)));
}

function initialLabel(letter) {
  if (!letter) return tr('全部','All');
  return letter === '#' ? tr('其他','Other') : letter;
}

function moduleInitialIndex(view) {
  if (view.letters.length < 2 && !view.letter) return '';
  const label = tr('按首字母查看','Browse by initial');
  const letters = ['', ...view.letters];
  const buttons = letters.map(letter => {
    const active = letter === view.letter;
    return '<button type="button" data-letter="'+esc(letter)+'" aria-pressed="'+active+'">'+esc(initialLabel(letter))+'</button>';
  }).join('');
  const options = letters.map(letter => '<option value="'+esc(letter)+'"'+(letter===view.letter?' selected':'')+'>'+esc(initialLabel(letter))+'</option>').join('');
  return '<div class="module-initials" role="group" aria-label="'+label+'">'+buttons+'</div>'+
    '<label class="module-initial-picker">'+tr('首字母','Initial')+' <select data-letter-picker aria-label="'+label+'">'+options+'</select></label>';
}

function modulePageBar(view) {
  const previous = tr('上一页','Previous page'), next = tr('下一页','Next page');
  const arrow = (step,title,disabled,symbol) => '<button type="button" data-page-step="'+step+'" aria-label="'+title+'" title="'+title+
    '"'+(disabled?' disabled':'')+'><span aria-hidden="true">'+symbol+'</span></button>';
  const range = view.first+'–'+view.last+' / '+view.total;
  const position = tr('第 '+view.page+' / '+view.pages+' 页','Page '+view.page+' of '+view.pages);
  const details = tr('第 '+view.first+' 至 '+view.last+' 项，共 '+view.total+' 项','Items '+view.first+' to '+view.last+' of '+view.total);
  return '<div class="module-pagination">'+moduleInitialIndex(view)+'<div class="module-page-controls">'+
    arrow(-1,previous,view.page===1,'‹')+'<span data-page-summary role="status" aria-live="polite" title="'+range+'">'+position+'<span class="module-sr-only"> · '+details+'</span></span>'+
    arrow(1,next,view.page===view.pages,'›')+'</div></div>';
}

class ModuleListView {
  constructor(kind) {
    this.kind = kind;
    this.reset();
  }

  reset() {
    this.page = 1;
    this.letter = '';
  }

  element() {
    return document.querySelector('[data-module-list="'+this.kind+'"]');
  }

  render(entries, row, empty) {
    this.entries = entries;
    this.row = row;
    this.empty = empty;
    return '<div data-module-list="'+this.kind+'">'+this.contents()+'</div>';
  }

  contents() {
    this.size = modulePageSize(this.kind);
    const view = modulePage(this.entries, {page:this.page, letter:this.letter, pageSize:this.size});
    this.page = view.page;
    this.letter = view.letter;
    if (!view.total) return '<p class="body subtle">'+esc(this.empty)+'</p>';
    const bar = this.entries.length > this.size || view.letter ? modulePageBar(view) : '';
    return bar+'<div class="module-page-rows">'+view.items.map(this.row).join('')+'</div>';
  }

  navigate(letter, step) {
    if (letter !== undefined) {
      this.letter = letter;
      this.page = 1;
    } else {
      this.page += step;
    }
    this.repaint();
  }

  repaint() {
    const list = this.element();
    if (!list) return;
    const focus = moduleControlFocus(list);
    list.innerHTML = this.contents();
    restoreModuleFocus(focus);
  }
}

const moduleLists = {selected:new ModuleListView('selected'), available:new ModuleListView('available')};

/** Refreshes can move a checked module to the other list. Keep keyboard users at the same row in the original list. */
function moduleControlFocus(container) {
  const control = document.activeElement;
  if (!control || !container?.contains(control)) return;
  if (control.matches('[data-module-selected-toggle]')) return {toggle:true};
  if (control.id === 'filter') return {filter:true, start:control.selectionStart, end:control.selectionEnd};
  const list = control.closest('[data-module-list]');
  if (!list) return;
  const inputs = [...list.querySelectorAll('[data-select]')];
  for (const attr of ['data-select','data-letter','data-page-step','data-letter-picker','data-act']) {
    if (control.hasAttribute(attr)) return {kind:list.dataset.moduleList, attr, value:control.getAttribute(attr), index:inputs.indexOf(control)};
  }
}

function restoreModuleFocus(focus) {
  if (!focus) return;
  if (focus.toggle) return document.querySelector('[data-module-selected-toggle]')?.focus({preventScroll:true});
  if (focus.filter) {
    const input = document.getElementById('filter');
    input?.focus({preventScroll:true});
    input?.setSelectionRange(focus.start,focus.end);
    return;
  }
  const list = moduleLists[focus.kind].element();
  if (!list) return;
  const selector = '['+focus.attr+'="'+CSS.escape(focus.value)+'"]:not(:disabled)';
  const inputs = list.querySelectorAll('[data-select]');
  const control = list.querySelector(selector) || inputs[Math.min(focus.index,inputs.length-1)] ||
    list.querySelector('button:not(:disabled), select, input') || document.getElementById('filter');
  control?.focus({preventScroll:true});
}

document.addEventListener('click', event => {
  const control = event.target.closest('[data-letter], [data-page-step]');
  const list = control?.closest('[data-module-list]');
  if (list) moduleLists[list.dataset.moduleList].navigate(control.dataset.letter, Number(control.dataset.pageStep));
});
document.addEventListener('change', event => {
  if (!event.target.matches('[data-letter-picker]')) return;
  const list = event.target.closest('[data-module-list]');
  moduleLists[list.dataset.moduleList].navigate(event.target.value);
});
let moduleResizeFrame;
window.addEventListener('resize', () => {
  cancelAnimationFrame(moduleResizeFrame);
  moduleResizeFrame = requestAnimationFrame(() => {
    for (const list of Object.values(moduleLists)) {
      if (list.element() && list.size !== modulePageSize(list.kind)) list.repaint();
    }
  });
});
