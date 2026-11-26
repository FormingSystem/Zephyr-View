'use strict';

/** Write ordinary DTS overrides at the end of an application overlay, leaving the user's declarations intact. */
const deviceTreeDraft = (() => {
  const heading = '/* Zephyr Extension: node overrides */';
  const node_path = /^\/(?:[\w,.+@#-]+(?:\/[\w,.+@#-]+)*)?$/;
  const property_name = /^[\w,.+?#-]+$/;
  const status_values = new Set(['okay', 'disabled', 'reserved', 'fail']);
  const structural = new Set(['compatible', 'phandle', 'linux,phandle', 'reg', 'interrupts', 'device_type', 'status']);
  const quoted = /"(?:[^"\\\r\n]|\\["\\nt])*"/;
  const assignment = new RegExp('\\s*([\\w,.+?#-]+)\\s*=\\s*(' + quoted.source + '|<[0-9]+>)\\s*;', 'y');

  function editableProperty(prop) {
    if (!prop || !property_name.test(prop.name) || prop.name.startsWith('#') || structural.has(prop.name)) return;
    if (prop.type === 'string' && typeof prop.scalar === 'string') return 'string';
    if (prop.type === 'num' && Number.isInteger(prop.scalar)) return 'int';
  }

  function encode(type, value) {
    if (type === 'string' && typeof value === 'string' && !/[\x00-\x08\x0b-\x1f\x7f]/.test(value))
      return JSON.stringify(value);
    const integer = String(value).trim();
    if (type === 'int' && /^(?:\d+|0x[\da-f]+)$/i.test(integer) && Number(integer) <= 0xffffffff)
      return '<' + Number(integer) + '>';
    throw Error(typeof tr === 'function' ? tr('请输入有效的属性值。整数范围为 0 至 4294967295。', 'Enter a valid property value. Integers must be between 0 and 4294967295.') : 'Invalid devicetree value');
  }

  function read_section(text, start) {
    const nodes = new Map();
    const opening = /\s*&\{(\/[^}\r\n]*)\}\s*\{/y;
    const closing = /\s*\};/y;
    let offset = start;
    while (text.slice(offset).trim()) {
      opening.lastIndex = offset;
      const node = opening.exec(text);
      if (!node || !node_path.test(node[1]) || nodes.has(node[1])) return;
      offset = opening.lastIndex;
      const fields = new Map();
      assignment.lastIndex = offset;
      let entry;
      while ((entry = assignment.exec(text))) {
        if (fields.has(entry[1])) return;
        fields.set(entry[1], entry[2]);
        offset = assignment.lastIndex;
      }
      closing.lastIndex = offset;
      if (!fields.size || !closing.test(text)) return;
      nodes.set(node[1], fields);
      offset = closing.lastIndex;
    }
    return nodes;
  }

  function read_overrides(text) {
    const index = text.lastIndexOf(heading);
    if (index < 0 || (index > 0 && text[index - 1] !== '\n')) return;
    const nodes = read_section(text, index + heading.length);
    if (nodes) return {index, nodes};
  }

  function update_field(text, path, name, expression) {
    if (!node_path.test(path || '')) throw Error('Invalid devicetree path');
    const section = read_overrides(text);
    const nodes = section?.nodes ?? new Map();
    const fields = nodes.get(path) ?? new Map();
    if (fields.get(name) === expression) return text;
    fields.set(name, expression);
    nodes.set(path, fields);
    const lines = [heading];
    for (const [node, properties] of nodes) {
      lines.push('&{' + node + '} {');
      for (const [key, value] of properties) lines.push('\t' + key + ' = ' + value + ';');
      lines.push('};');
    }
    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    const prefix = section ? text.slice(0, section.index) : text;
    const separator = section || !prefix ? '' : prefix.endsWith('\n') ? newline : newline + newline;
    return prefix + separator + lines.join(newline) + newline;
  }

  function status(text, record, value) {
    if (!status_values.has(value)) throw Error('Invalid devicetree status');
    return update_field(text, record?.path, 'status', encode('string', value));
  }

  function property(text, record, name, value) {
    const field = record?.properties?.find(prop => prop.name === name);
    return update_field(text, record?.path, name, encode(editableProperty(field), value));
  }

  function stagedProperty(text, record, name) {
    const field = read_overrides(text)?.nodes.get(record?.path)?.get(name);
    if (field === undefined) return;
    return field.startsWith('<') ? Number(field.slice(1, -1)) : JSON.parse(field);
  }
  const stagedStatus = (text, record) => stagedProperty(text, record, 'status');
  return {status, stagedStatus, property, stagedProperty, editableProperty};
})();
if (typeof module !== 'undefined') module.exports = deviceTreeDraft;
