'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// PnPUtil emits CSV with quoted fields (including escaped quotes and line breaks).
function* csvRows(text) {
  let field = '', row = [], quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && c === ',') {
      row.push(field);
      field = '';
    } else if (!quoted && (c === '\r' || c === '\n')) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      yield [...row, field];
      row = [];
      field = '';
    } else field += c;
  }
  if (quoted) throw Error('Incomplete PnPUtil CSV field');
  if (row.length || field) yield [...row, field];
}

function readInventory(text) {
  const rows = csvRows(text.replace(/^\uFEFF/, ''));
  const header = rows.next().value || [];
  const columns = ['InstanceId', 'DeviceDescription', 'Status', 'ProblemCode'].map(name => header.indexOf(name));
  if (columns.includes(-1)) throw Error('PnPUtil did not return the device inventory columns');
  const devices = [];
  for (const row of rows) {
    const [id, name, status, problem] = columns.map(i => row[i]);
    if (!/^(USB|HID|FTDIBUS)\\/i.test(id)) continue;
    let code = null;
    if (problem) code = Number(problem);
    else if (status && !/^(problem|unknown)$/i.test(status)) code = 0;
    devices.push({PNPDeviceID:id, Name:name || id, ConfigManagerErrorCode:Number.isFinite(code) ? code : null});
  }
  return devices;
}

async function windowsProbeInventory(run, legacyReader) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zephyr-probe-'));
  const report = path.join(directory, 'devices.csv');
  const program = path.win32.join(process.env.SystemRoot, 'System32', 'pnputil.exe');
  try {
    // CSV file output is UTF-16LE independently of the console code page.
    await run(program, ['/enum-devices', '/connected', '/format', 'csv', '/output-file', report],
      {windowsHide:true, timeout:15000});
    return readInventory(await fs.readFile(report, 'utf16le'));
  } catch (error) {
    // Older PnPUtil releases reject /format or /output-file.
    if ([1, 87, 'ENOENT'].includes(error.code)) return legacyReader(run);
    throw error;
  } finally {
    await fs.rm(directory, {recursive:true, force:true});
  }
}

module.exports = {readInventory, windowsProbeInventory};
