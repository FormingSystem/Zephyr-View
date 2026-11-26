'use strict';

// Module identifiers use the same dictionary order in the Chinese and English workbenches.
const moduleNameOrder = new Intl.Collator('en', {sensitivity: 'accent', numeric: false});
const moduleInitials = ['0–9', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'];

function moduleInitial(name) {
  const initial = name.trimStart().normalize('NFKD').toUpperCase().charAt(0);
  if (/^[A-Z]$/.test(initial)) return initial;
  return /^[0-9]$/.test(initial) ? '0–9' : '#';
}

/** Paginate the current search results while preserving row identity and the order of equal names. */
function modulePage(items, {nameOf = item => item.name, letter = '', page = 1, pageSize = 8} = {}) {
  const groups = new Map();
  for (const item of items) {
    const name = nameOf(item);
    const initial = moduleInitial(name);
    if (!groups.has(initial)) groups.set(initial, []);
    groups.get(initial).push({name, item});
  }
  const letters = moduleInitials.filter(initial => groups.has(initial));
  const activeLetter = groups.has(letter) ? letter : '';
  const entries = (activeLetter ? [activeLetter] : letters).flatMap(initial =>
    groups.get(initial).sort((left, right) => moduleNameOrder.compare(left.name, right.name)));

  const total = entries.length;
  const size = Number.isSafeInteger(pageSize) && pageSize > 0 ? pageSize : 8;
  const pages = Math.max(1, Math.ceil(total / size));
  const requestedPage = Number.isSafeInteger(page) && activeLetter === letter ? page : 1;
  const currentPage = Math.min(pages, Math.max(1, requestedPage));
  const start = (currentPage - 1) * size;
  const visible = entries.slice(start, start + size).map(entry => entry.item);
  return {
    items: visible, letters, letter: activeLetter, page: currentPage, pages, total,
    first: total ? start + 1 : 0, last: start + visible.length
  };
}

if (typeof module !== 'undefined') module.exports = {modulePage};
