'use strict';

const path = require('node:path');
const vscode = require('vscode');
const {profiles} = require('./probeDiagnostics');
const {listProbeTools, probeDevices, selectProbeLocation, resetProbeLocation} = require('./probeInventory');
const {deploymentActions, deployProbe} = require('./probeDeployment');
const {pickDirectory, inputDirectory, pickFile} = require('./fileDialogs');
const {t} = require('./installationDialogs');

function runnerProfile(runner) {
  if (Object.hasOwn(profiles, runner)) return runner;
  if (['esp32', 'mcumgr', 'bossac'].includes(runner)) return 'serial';
}

function accessHint(id) {
  if (process.platform === 'darwin') return t('首次连接时请允许 USB 配件。','Allow the USB accessory when prompted.');
  if (process.platform === 'linux') return id === 'serial'
    ? t('检查串口所属组及读写权限。','Check the serial port group and read/write permissions.')
    : t('检查厂商的 udev 规则，应用后重新插拔探针。','Check the vendor udev rules and reconnect the probe after applying them.');
  const windows = {
    pyocd: ['CMSIS-DAP v1 使用 HID，v2 使用 WinUSB。','CMSIS-DAP v1 uses HID. Version 2 uses WinUSB.'],
    stm32cubeprogrammer: ['ST-LINK 的 Windows 驱动包为 STSW-LINK009。','STSW-LINK009 provides the ST-LINK drivers.'],
    jlink: ['SEGGER 安装包包含 J-Link USB 驱动。','The SEGGER installer includes the J-Link USB driver.'],
    'dfu-util': ['检查开发板 DFU 接口的 USB 驱动绑定。','Check the USB driver binding for the DFU interface.'],
    serial: ['CDC ACM 使用系统 Usbser 驱动。USB 转串口桥可能需要厂商驱动。','CDC ACM uses Usbser. USB-to-UART bridges may need a vendor driver.']
  };
  if (process.platform === 'win32') return t(...windows[id]);
}

function probeProfiles() {
  return Object.entries(profiles).map(([id, {label, program}]) => ({
    id, label, program, ...deploymentActions(id), accessHint: accessHint(id)
  }));
}

async function chooseTool(context, s, row, op, current) {
  const previous = row.path || row.selectedPath;
  const directory = op !== 'executable';
  const title = directory ? t('选择工具安装目录','Select the tool installation directory') : t('选择可执行文件','Select the executable');
  const defaultUri = previous ? vscode.Uri.file(directory ? path.dirname(previous) : previous) : s.folder.uri;
  const options = {title: row.label + ' · ' + title, defaultUri};
  const uri = op === 'typedDirectory' ? await inputDirectory({...options, baseUri:s.folder.uri}) :
    await (directory ? pickDirectory : pickFile)(options);
  if (!uri || !current()) return;
  if (!await selectProbeLocation(context, s.folder, row.id, uri.fsPath, directory ? 'directory' : 'executable')) {
    throw Error(t('所选位置没有可用的工具','Tool not found at the selected location') + ' · ' + row.program);
  }
}

function deploymentStatus(result) {
  switch (result?.status) {
    case 'external': return t('已打开厂商下载页。完成安装后可重新检测。','Vendor download opened. Detect again after installation.');
    case 'diskImage': return t('已打开磁盘映像。运行其中的安装程序后，请重新检测。','Disk image opened. Run its installer, then detect again.');
    case 'installed': return t('安装程序已结束。','Installer finished.');
    case 'reconnect': return t('请重新插拔探针，然后重新识别。','Reconnect the probe, then choose Detect again.');
    case 'restart': return t('系统需要重启才能完成驱动安装。重启后请重新识别。','Restart the system to finish driver installation, then choose Detect again.');
  }
}

class ProbeSupport {
  constructor(context, publish) {
    this.context = context;
    this.publish = publish;
    this.active = new Set();
  }

  reset() { this.session = undefined; }

  forWorkspace(s) {
    const key = JSON.stringify([s.folder?.uri.toString(), vscode.workspace.isTrusted, s.tools?.python, s.toolDirectories]);
    if (this.session?.key !== key) {
      this.session = {key, folder: s.folder?.uri.fsPath, rows: probeProfiles(), checked: 0};
    }
    return this.session;
  }

  report(session) {
    if (this.session !== session) return;
    const rows = session.rows.map(row => ({...row, busy: this.active.has(row.id)}));
    return this.publish({folder: session.folder, rows, scanning: Boolean(session.scan), error: session.error});
  }

  async list(s, fresh = false) {
    const session = this.forWorkspace(s);
    if (!vscode.workspace.isTrusted) return this.report(session);
    if (session.scan) {
      await this.report(session);
      return session.scan;
    }
    if (!fresh && Date.now() - session.checked < 5000) return this.report(session);
    session.error = undefined;
    session.scan = this.scan(s, session, fresh).finally(() => {
      session.scan = undefined;
      session.checked = Date.now();
      return this.report(session);
    });
    await this.report(session);
    return session.scan;
  }

  async scan(s, session, fresh) {
    // A slow USB bus must not hold back locally available tool paths.
    const tools = listProbeTools(this.context, s.folder, s, fresh).then(entries => {
      for (const row of session.rows) {
        const entry = entries.find(item => item.id === row.id);
        row.path = entry?.path;
        row.source = entry?.source;
        row.selectedPath = entry?.selectedPath;
        row.toolChecked = Boolean(entry);
      }
      return this.report(session);
    });
    const devices = probeDevices().then(groups => {
      for (const row of session.rows) {
        row.devices = groups[row.id]?.devices;
        row.deviceError = groups[row.id]?.problem;
      }
      return this.report(session);
    });
    const results = await Promise.allSettled([tools, devices]);
    session.error = results.filter(result => result.status === 'rejected').map(result => result.reason.message).join(' · ');
  }

  async act(s, {id, op} = {}, current) {
    if (op === 'refresh') return this.list(s, true);
    if (!Object.hasOwn(profiles, id)) return;
    if (op === 'download' || op === 'guide') {
      return vscode.env.openExternal(vscode.Uri.parse(op === 'guide' ? profiles[id].guide : profiles[id].url));
    }
    if (!s.folder || !vscode.workspace.isTrusted || !current() || this.active.has(id)) return;
    const session = this.forWorkspace(s);
    const row = session.rows.find(item => item.id === id);
    const supported = {directory:row.program, typedDirectory:row.program, executable:row.program, reset:row.program,
      deploy:row.canDeploy, localInstaller:row.canInstallLocal, driver:row.canDeployDriver, localDriver:row.canInstallLocalDriver};
    if (!Object.hasOwn(supported, op) || !supported[op]) return;
    this.active.add(id);
    row.statusMessage = undefined;
    try {
      await this.report(session);
      if (!current()) return;
      if (op === 'reset') await resetProbeLocation(this.context, s.folder, id);
      else if (['directory','typedDirectory','executable'].includes(op)) await chooseTool(this.context, s, row, op, current);
      else {
        const result = await deployProbe(this.context, s, id, op, current);
        if (result?.file && current()) await selectProbeLocation(this.context, s.folder, id, result.file, 'executable');
        row.statusMessage = deploymentStatus(result);
      }
    } catch (error) {
      row.statusMessage = error.message;
    } finally {
      this.active.delete(id);
      if (session.scan) await session.scan;
      if (current()) await this.list(s, true);
      else if (this.session && this.session !== session) await this.report(this.session);
    }
  }
}

module.exports = {ProbeSupport, probeProfiles, runnerProfile};
