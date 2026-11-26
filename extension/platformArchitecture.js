'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const yaml = require('js-yaml');

function platformTarget(identifier, board) {
  if (typeof identifier !== 'string') return;
  const match = /^([^@/]+)(?:@([^@/]+))?(?:\/([^@]+))?$/.exec(identifier);
  if (!match) return;
  const [, name, revision, qualifiers = ''] = match;
  const parts = qualifiers.split('/');
  if (name !== board.name || (revision && !board.revisions?.includes(revision))) return;
  if (!board.socs.length && !board.qualifiers?.length && !revision && !qualifiers) return name;
  if (!parts[0] && board.socs.length === 1) parts[0] = board.socs[0];
  if (board.qualifiers && !board.qualifiers.includes(parts.join('/'))) return;
  const effective = revision || board.defaultRevision;
  return [name + (effective ? '@' + effective : ''), ...parts].join('/');
}

async function readDescriptor(file) {
  try { return yaml.load(await fs.readFile(file, 'utf8'), {schema: yaml.FAILSAFE_SCHEMA}); }
  catch (error) {
    if (error.code === 'ENOENT' || error instanceof yaml.YAMLException) return undefined;
    throw error;
  }
}

/** Twister applies defaults from the primary board directory and variants from all board roots. */
async function readPlatformArchitectures(board) {
  const platforms = await Promise.all(board.directories.map(dir => readDescriptor(path.join(dir, 'twister.yaml'))));
  const overrides = new Map();
  function remember(identifier, arch) {
    const target = platformTarget(identifier, board);
    if (target && typeof arch === 'string') {
      overrides.set(target, overrides.has(target) && overrides.get(target) !== arch ? undefined : arch);
    }
  }
  const defaults = platforms[0];
  if (defaults) {
    for (const descriptor of platforms) {
      for (const [target, variant] of Object.entries(descriptor?.variants || {})) remember(target, variant?.arch);
    }
  } else {
    for (const dir of board.directories) {
      const entries = await fs.readdir(dir, {withFileTypes: true});
      const files = entries.filter(file => file.isFile() && file.name.endsWith('.yaml'));
      for (const data of await Promise.all(files.map(file => readDescriptor(path.join(dir, file.name))))) {
        remember(data?.identifier, data?.arch);
      }
    }
  }
  return identifier => {
    const target = platformTarget(identifier, board);
    if (target) return overrides.has(target) ? overrides.get(target) : defaults?.arch;
  };
}

module.exports = {platformTarget, readPlatformArchitectures};
