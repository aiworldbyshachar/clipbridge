'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { formatCode, generateCode } = require('./code');

function defaultDeviceName() {
  const host = os.hostname().replace(/\.local$/i, '').trim();
  return host || (process.platform === 'darwin' ? 'Mac' : 'PC');
}

const DEFAULTS = {
  language: 'en',
  deviceName: '',
  code: '',
  applyIncoming: true,
  hideAfterCopy: true,
  notifyOnReceive: false,
  openAtLogin: true,
  paused: false,
  shortcut: 'CommandOrControl+Shift+Space',
  manualPeers: [],
  knownPeers: [],
};

class Settings {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    this.data = { ...DEFAULTS };
    this.isFirstRun = false;
  }

  load() {
    let saved = null;
    try {
      saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this.isFirstRun = true;
    }
    this.data = { ...DEFAULTS, ...(saved || {}) };
    if (!this.data.deviceName) this.data.deviceName = defaultDeviceName();
    this.data.code = this.data.code ? formatCode(this.data.code) : generateCode();
    this.save();
  }

  get(key) {
    return this.data[key];
  }

  set(patch) {
    Object.assign(this.data, patch);
    this.save();
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    try {
      fs.renameSync(tmp, this.file);
    } catch {
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    }
  }
}

module.exports = { Settings };
