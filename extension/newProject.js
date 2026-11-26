'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

/** The directory must be new. On failure remove only entries still containing our bytes. */
async function writeNewProject(parent, name, files) {
  const root = path.join(parent, name);
  await fs.mkdir(root);
  const created = [];
  try {
    await fs.mkdir(path.join(root, 'src'));
    for (const [relative, content] of Object.entries(files)) {
      const target = path.join(root, relative);
      await fs.writeFile(target, content, {flag:'wx'});
      created.push([target, content]);
    }
    return root;
  } catch (error) {
    for (const [target, content] of created) {
      if (await fs.readFile(target, 'utf8').catch(() => null) === content) await fs.unlink(target).catch(() => {});
    }
    await fs.rmdir(path.join(root, 'src')).catch(() => {});
    await fs.rmdir(root).catch(() => {});
    throw error;
  }
}

module.exports = {writeNewProject};
