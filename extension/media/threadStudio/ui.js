'use strict';

globalThis.ThreadStudioUI = (() => {
  function el(tag, className, ...children) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.append(...children.filter(value => value !== undefined && value !== null));
    return node;
  }

  function button(label, click, className = '') {
    const node = el('button', className, label);
    node.type = 'button';
    node.addEventListener('click', click);
    return node;
  }

  function select(label, entries, value, change) {
    const node = el('select', 'ts-select');
    node.setAttribute('aria-label', label);
    for (const [id, text] of entries) {
      const option = el('option', '', text);
      option.value = String(id);
      node.append(option);
    }
    node.value = String(value);
    node.addEventListener('change', () => change(node.value));
    return node;
  }

  const shapes = {
    msgq: ['M3 5h14v4H3z M3 12h14v4H3z'],
    sem: ['M5 18V3 M5 4h11l-3 3 3 3H5'],
    mutex: ['M5 9h11v9H5z M7 9V6a3.5 3.5 0 0 1 7 0v3 M10.5 12v3'],
    thread: ['M5 4h3v3H5z M13 13h3v3h-3z M8 5.5h4a3 3 0 1 1 0 6H9a3 3 0 0 0 0 6'],
    source: ['m7 5-5 5 5 5 M13 5l5 5-5 5']
  };
  function icon(id) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 21 21');
    svg.setAttribute('class', 'ts-icon');
    svg.setAttribute('aria-hidden', 'true');
    for (const d of shapes[id] || []) {
      const p = document.createElementNS(svg.namespaceURI, 'path');
      p.setAttribute('d', d);
      svg.append(p);
    }
    return svg;
  }

  function section(title, ...content) {
    return el('section', 'ts-section', el('h3', 'ts-subtitle', title), ...content);
  }

  function details(title, ...content) {
    return el('details', 'ts-details', el('summary', '', title), ...content);
  }

  function codeBlock(text) {
    const pre = el('pre', 'ts-code', el('code', '', text));
    pre.tabIndex = 0;
    return pre;
  }
  return {el, button, select, icon, section, details, codeBlock};
})();
