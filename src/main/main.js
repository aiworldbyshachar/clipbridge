'use strict';
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  clipboard,
  nativeImage,
  nativeTheme,
  ipcMain,
  globalShortcut,
  shell,
  Notification,
  protocol,
  net,
  dialog,
  systemPreferences,
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');
const { Settings } = require('./settings');
const { HistoryStore } = require('./store');
const { SyncEngine, localAddresses, parseTarget, DEFAULT_PORT } = require('./sync');
const { ClipboardWatcher } = require('./clipwatch');
const { formatCode, isValidCode, generateCode } = require('./code');
const { LANGUAGES, createTranslator } = require('../shared/i18n');

const isMac = process.platform === 'darwin';
const ASSETS = path.join(__dirname, '..', '..', 'assets');

let tr = createTranslator('en');
const t = (key, vars) => tr.t(key, vars);

// CLIPBRIDGE_PROFILE runs an independent second instance (separate data, port)
// on the same machine, which is handy for testing.
const profile = process.env.CLIPBRIDGE_PROFILE;
if (profile) app.setPath('userData', path.join(app.getPath('appData'), `ClipBridge-${profile}`));

protocol.registerSchemesAsPrivileged([
  { scheme: 'clipimg', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let settings, store, sync, watcher, tray, win;
let quitting = false;

// A small log file in the data folder, for troubleshooting connection problems.
let logFile = null;
function log(...args) {
  const line = `${new Date().toISOString()} ${args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ')}\n`;
  if (!app.isPackaged) process.stdout.write(line);
  if (!logFile) return;
  try {
    fs.appendFileSync(logFile, line);
  } catch {}
}
process.on('uncaughtException', (err) => log('uncaught:', err));
process.on('unhandledRejection', (err) => log('unhandled rejection:', err));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow(true));
  app.whenReady().then(init).catch((err) => {
    dialog.showErrorBox('ClipBridge', `ClipBridge failed to start:\n${err.stack || err}`);
    app.quit();
  });
}

// macOS: clicking the Dock icon opens the window. Ignored right after launch,
// so starting at login doesn't pop the window up.
let acceptActivate = false;
app.on('activate', () => {
  if (acceptActivate) showWindow(true);
});

app.on('before-quit', () => {
  quitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (watcher) watcher.stop();
  if (sync) sync.stop();
  if (store) store.flush();
});

// Keep running in the tray when the window is closed.
app.on('window-all-closed', () => {});

async function init() {
  if (isMac) {
    // App Nap slows the timers of background apps, which would delay noticing
    // new copies. Info.plist opts out too (LSAppNapIsDisabled).
    try {
      systemPreferences.setUserDefault('NSAppSleepDisabled', 'boolean', true);
    } catch {}
  }

  const userData = app.getPath('userData');
  fs.mkdirSync(userData, { recursive: true });
  logFile = path.join(userData, 'clipbridge.log');
  try {
    if (fs.statSync(logFile).size > 1024 * 1024) fs.rmSync(logFile);
  } catch {}
  log(`starting ClipBridge ${app.getVersion()} on ${process.platform}`);

  settings = new Settings(userData);
  settings.load();
  tr = createTranslator(settings.get('language'));
  buildAppMenu();

  store = new HistoryStore({
    dir: path.join(userData, 'history'),
    deviceName: settings.get('deviceName'),
    platform: process.platform,
  });
  store.load();

  protocol.handle('clipimg', (req) => {
    const id = new URL(req.url).pathname.replace(/^\//, '');
    const file = store.imagePath(id);
    if (!file) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  sync = new SyncEngine({
    store,
    deviceName: settings.get('deviceName'),
    code: settings.get('code'),
    port: Number(process.env.CLIPBRIDGE_PORT) || DEFAULT_PORT,
    manualPeers: settings.get('manualPeers'),
    knownPeers: settings.get('knownPeers'),
    log: (...args) => log('[sync]', ...args),
  });
  sync.on('remote-clip', onRemoteClip);
  sync.on('peers', onPeersChanged);
  store.on('changed', onHistoryChanged);
  await sync.start();
  log(`listening on port ${sync.port}, addresses ${localAddresses().join(', ')}, ${store.count()} items in history`);

  watcher = new ClipboardWatcher({
    clipboard,
    nativeImage,
    onClip: onLocalClip,
    onError: (err) => log('clipboard error:', err),
  });
  watcher.start();

  setupIpc();
  createTray();
  registerShortcut();
  applyLoginItem();

  if (settings.isFirstRun || !launchedAtLogin()) showWindow(true);
  setTimeout(() => (acceptActivate = true), 1500);
  if (process.env.CLIPBRIDGE_SCREENSHOT) captureForTesting(process.env.CLIPBRIDGE_SCREENSHOT);
}

// ---------- clipboard flow ----------

function onLocalClip(clip) {
  if (settings.get('paused')) return;
  if (!store.addLocalClip(clip)) return; // same as the newest item
  log(`local ${clip.ctype} copied, sending to ${sync.getPeers().filter((p) => p.online).length} device(s)`);
  sync.broadcast(store.takeOutbox());
}

function onRemoteClip(ev, from) {
  log(`received ${ev.ctype} from ${from.name}`);
  if (settings.get('paused') || !settings.get('applyIncoming')) return;
  watcher.write(ev, store.imagePath(ev.id));
  if (settings.get('notifyOnReceive') && Notification.isSupported()) {
    new Notification({
      title: t('receivedFrom', { name: from.name }),
      body: ev.ctype === 'text' ? ev.text.slice(0, 140) : t('trayImage', { w: ev.w, h: ev.h }),
      silent: true,
    }).show();
  }
}

function localChange() {
  sync.broadcast(store.takeOutbox());
}

// ---------- UI notifications ----------

let historyTimer = null;
function onHistoryChanged() {
  if (historyTimer) return;
  historyTimer = setTimeout(() => {
    historyTimer = null;
    send('history:changed');
    updateTrayMenu();
  }, 120);
}

function onPeersChanged(peers, foreign) {
  log('peers:', peers.map((p) => `${p.name}@${p.address}:${p.port}${p.online ? '' : ' (offline)'}`).join(', ') || 'none',
    foreign.length ? `| other code: ${foreign.map((f) => `${f.name}@${f.address}`).join(', ')}` : '');
  const known = new Set(settings.get('knownPeers'));
  let changed = false;
  for (const p of peers) {
    if (!p.online || !p.address) continue;
    const key = `${p.address}:${p.port}`;
    if (!known.has(key)) {
      known.add(key);
      changed = true;
    }
  }
  if (changed) settings.set({ knownPeers: [...known].slice(-8) });
  sendState();
  updateTrayMenu();
}

function send(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

function sendState() {
  send('state:changed');
}

// ---------- state for the renderer ----------

function deviceDirectory() {
  const dir = {};
  for (const [id, n] of Object.entries(store.getNames())) dir[id] = { name: n.name, platform: n.platform };
  for (const p of sync.getPeers()) dir[p.id] = { name: p.name, platform: p.platform };
  dir[store.deviceId] = { name: settings.get('deviceName'), platform: process.platform };
  return dir;
}

function getState() {
  const s = settings.data;
  return {
    self: { id: store.deviceId, name: s.deviceName, platform: process.platform },
    settings: {
      language: tr.code,
      deviceName: s.deviceName,
      code: s.code,
      applyIncoming: s.applyIncoming,
      hideAfterCopy: s.hideAfterCopy,
      notifyOnReceive: s.notifyOnReceive,
      openAtLogin: s.openAtLogin,
      paused: s.paused,
      shortcut: s.shortcut,
      manualPeers: s.manualPeers,
    },
    peers: sync.getPeers(),
    foreign: sync.getForeign(),
    devices: deviceDirectory(),
    port: sync.port,
    addresses: localAddresses(),
    listenError: sync.listenError,
    loginStatus: isMac && app.isPackaged ? app.getLoginItemSettings().status : null,
    total: store.count(),
    dataDir: app.getPath('userData'),
    version: app.getVersion(),
  };
}

function toView(c) {
  const v = { id: c.id, origin: c.origin, ts: c.ts, ctype: c.ctype, pinned: store.isPinned(c.id) };
  if (c.ctype === 'text') {
    v.text = c.text.length > 6000 ? c.text.slice(0, 6000) : c.text;
    v.length = c.text.length;
  } else {
    v.w = c.w;
    v.h = c.h;
    v.bytes = c.bytes;
    v.src = `clipimg://img/${c.id}`;
  }
  return v;
}

// ---------- IPC ----------

function setupIpc() {
  ipcMain.handle('state:get', () => getState());

  ipcMain.handle('history:list', (_e, opts) => {
    const { items, total } = store.query(opts || {});
    return { items: items.map(toView), total };
  });

  ipcMain.handle('history:copy', (_e, id) => {
    const ev = store.get(id);
    if (!ev) return { ok: false };
    const ok = watcher.write(ev, store.imagePath(id));
    if (ok && settings.get('hideAfterCopy')) hideWindow();
    return { ok };
  });

  ipcMain.handle('history:delete', (_e, id) => {
    if (store.get(id)) {
      store.deleteClip(id);
      localChange();
    }
  });

  ipcMain.handle('history:pin', (_e, id, pinned) => {
    if (store.get(id)) {
      store.setPinned(id, pinned);
      localChange();
    }
  });

  ipcMain.handle('history:clear', () => {
    store.clearAll();
    localChange();
  });

  ipcMain.handle('settings:set', (_e, patch) => applySettings(patch || {}));

  ipcMain.handle('settings:regen-code', () => applySettings({ code: generateCode() }));

  ipcMain.handle('peer:add', async (_e, text) => {
    const target = parseTarget(text);
    if (!target) return { ok: false, error: t('errAddress') };
    const entry = target.port === DEFAULT_PORT ? target.host : `${target.host}:${target.port}`;
    const list = [...new Set([...settings.get('manualPeers'), entry])];
    settings.set({ manualPeers: list });
    sync.setManualPeers(list);
    sendState();
    try {
      const hello = await sync.probe(target.host, target.port);
      if (hello.id === store.deviceId) return { ok: true, found: true, self: true };
      return { ok: true, found: true, name: hello.name, sameCode: hello.fp === sync.fp };
    } catch {
      return { ok: true, found: false };
    }
  });

  ipcMain.handle('peer:remove', (_e, entry) => {
    const list = settings.get('manualPeers').filter((p) => p !== entry);
    settings.set({ manualPeers: list });
    sync.setManualPeers(list);
    sendState();
  });

  ipcMain.handle('sync:now', () => sync.syncAll());
  ipcMain.handle('app:open-data-dir', () => shell.openPath(app.getPath('userData')));
  ipcMain.handle('app:hide', () => hideWindow());
}

function applySettings(patch) {
  if ('language' in patch && LANGUAGES.some((l) => l.code === patch.language)) {
    settings.set({ language: patch.language });
    tr = createTranslator(patch.language);
    buildAppMenu();
    updateTrayMenu();
  }
  if ('deviceName' in patch) {
    const name = String(patch.deviceName || '').trim().slice(0, 60);
    if (!name) return { ok: false, error: t('errNameEmpty') };
    settings.set({ deviceName: name });
    store.setDeviceName(name);
    sync.setDeviceName(name);
  }
  if ('code' in patch) {
    if (!isValidCode(patch.code)) return { ok: false, error: t('errCodeShort') };
    const code = formatCode(patch.code);
    if (code !== settings.get('code')) {
      settings.set({ code });
      sync.setCode(code);
    }
  }
  for (const key of ['applyIncoming', 'hideAfterCopy', 'notifyOnReceive', 'paused']) {
    if (key in patch) settings.set({ [key]: !!patch[key] });
  }
  if ('openAtLogin' in patch) {
    settings.set({ openAtLogin: !!patch.openAtLogin });
    applyLoginItem();
  }
  if ('shortcut' in patch) {
    const previous = settings.get('shortcut');
    settings.set({ shortcut: String(patch.shortcut || '') });
    if (!registerShortcut()) {
      settings.set({ shortcut: previous });
      registerShortcut();
      return { ok: false, error: t('errShortcut') };
    }
  }
  if ('paused' in patch) updateTrayMenu();
  sendState();
  return { ok: true };
}

function applyLoginItem() {
  if (!app.isPackaged) return;
  try {
    // `args` is Windows-only; it tells this app it was started at login.
    app.setLoginItemSettings({ openAtLogin: !!settings.get('openAtLogin'), args: ['--hidden'] });
  } catch (err) {
    log('login item:', err);
  }
}

// Started automatically at login (as opposed to by the user)? Windows passes
// --hidden. Newer macOS no longer reports it, so a launch within the first
// minutes after boot while "Launch at login" is on counts as one.
function launchedAtLogin() {
  if (process.argv.includes('--hidden')) return true;
  if (!isMac) return false;
  if (app.getLoginItemSettings().wasOpenedAtLogin) return true;
  return !!settings.get('openAtLogin') && os.uptime() < 180;
}

function registerShortcut() {
  globalShortcut.unregisterAll();
  const accelerator = settings.get('shortcut');
  if (!accelerator) return true;
  try {
    return globalShortcut.register(accelerator, () => toggleWindow());
  } catch {
    return false;
  }
}

// ---------- window ----------

function createWindow() {
  win = new BrowserWindow({
    width: 500,
    height: 720,
    minWidth: 380,
    minHeight: 480,
    show: false,
    title: 'ClipBridge',
    icon: isMac ? undefined : path.join(ASSETS, 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#14141b' : '#f5f5f8',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // The language is passed along so the first paint is already translated.
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { query: { lang: tr.code } });
  win.webContents.on('console-message', (e) => {
    if (e.level === 'warning' || e.level === 'error') log(`renderer ${e.level}: ${e.message} (${e.sourceId}:${e.lineNumber})`);
  });
  win.webContents.on('render-process-gone', (_e, details) => log('renderer gone:', details.reason));
  win.webContents.on('did-finish-load', () => log('window loaded'));
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      hideWindow();
    }
  });
  // Never navigate away from the app page; open links in the browser instead.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function showWindow(focusSearch) {
  if (!win || win.isDestroyed()) createWindow();
  if (isMac) app.focus({ steal: true });
  const reveal = () => {
    win.show();
    win.focus();
    if (focusSearch) send('ui:focus-search');
  };
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', reveal);
  else reveal();
}

function hideWindow() {
  if (!win || win.isDestroyed()) return;
  win.hide();
  // Hand focus back to the app the user was in, so they can paste right away.
  if (isMac) app.hide();
}

function toggleWindow() {
  if (win && !win.isDestroyed() && win.isVisible() && win.isFocused()) hideWindow();
  else showWindow(true);
}

function openSettings() {
  showWindow(false);
  send('ui:open-settings');
}

// ---------- tray ----------

function createTray() {
  let icon;
  if (isMac) {
    icon = nativeImage.createFromPath(path.join(ASSETS, 'trayTemplate.png'));
    icon.setTemplateImage(true);
  } else {
    icon = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
  }
  tray = new Tray(icon);
  tray.setToolTip('ClipBridge');
  if (!isMac) tray.on('click', () => toggleWindow());
  updateTrayMenu();
}

let trayTimer = null;
function updateTrayMenu() {
  if (!tray || trayTimer) return;
  trayTimer = setTimeout(() => {
    trayTimer = null;
    buildTrayMenu();
  }, 200);
}

function buildTrayMenu() {
  const online = sync.getPeers().filter((p) => p.online);
  const status = settings.get('paused')
    ? t('statusPaused')
    : online.length
    ? t('trayConnected', { names: online.map((p) => p.name).join(', ') })
    : t('statusSearching');
  tray.setToolTip(`ClipBridge — ${status}`);

  const recent = store.latest(10).map((c) => ({
    label: c.ctype === 'text' ? trayLabel(c.text) : `🖼  ${t('trayImage', { w: c.w, h: c.h })}`,
    click: () => watcher.write(c, store.imagePath(c.id)),
  }));

  const accel = settings.get('shortcut');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: status, enabled: false },
      { type: 'separator' },
      { label: t('trayOpen'), accelerator: accel || undefined, registerAccelerator: false, click: () => showWindow(true) },
      { label: t('trayRecent'), submenu: recent.length ? recent : [{ label: t('trayNothing'), enabled: false }] },
      { type: 'separator' },
      {
        label: t('trayPause'),
        type: 'checkbox',
        checked: !!settings.get('paused'),
        click: (item) => applySettings({ paused: item.checked }),
      },
      { label: t('traySettings'), click: openSettings },
      { type: 'separator' },
      { label: t('trayQuit'), click: () => app.quit() },
    ])
  );
}

// macOS shows the app's menu bar while ClipBridge is in front; it also makes
// copy/paste shortcuts work in text fields. Windows needs none.
function buildAppMenu() {
  if (!isMac) {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { label: t('traySettings'), accelerator: 'Command+,', click: openSettings },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { label: t('trayQuit'), accelerator: 'Command+Q', click: () => app.quit() },
        ],
      },
      { role: 'editMenu' },
      { role: 'windowMenu' },
    ])
  );
}

function trayLabel(text) {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 48 ? line.slice(0, 47) + '…' : line;
}

// ---------- test helper ----------

function captureForTesting(file) {
  setTimeout(async () => {
    try {
      const image = await win.webContents.capturePage();
      fs.writeFileSync(file, image.toPNG());
      log('captured window to', file);
    } catch (err) {
      log('capture failed', err);
    }
    if (process.env.CLIPBRIDGE_EXIT_AFTER_CAPTURE) app.quit();
  }, Number(process.env.CLIPBRIDGE_CAPTURE_DELAY) || 2500);
}
