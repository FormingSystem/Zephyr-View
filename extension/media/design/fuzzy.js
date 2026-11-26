'use strict';

/** Match the search characters in order, allowing gaps in a name or path. */
function fuzzy(text, query) {
  const term = Array.from(query.trim().toLowerCase().replaceAll('\\', '/'));
  if (!term.length) return true;
  let offset = 0;
  for (const character of text.toLowerCase().replaceAll('\\', '/')) {
    if (character === term[offset] && ++offset === term.length) return true;
  }
  return false;
}

if (typeof module !== 'undefined') module.exports = {fuzzy};
