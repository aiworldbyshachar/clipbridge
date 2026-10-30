'use strict';
// Stand-in for the Electron preload API, used only when the renderer is opened
// directly in a browser for design work. Not included in the built app.
(function () {
  const PC = '11111111-1111-4111-8111-111111111111';
  const MAC = '22222222-2222-4222-8222-222222222222';
  const now = Date.now();
  const min = 60e3;
  const img =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6e72f5"/><stop offset="1" stop-color="#8b4fe8"/></linearGradient></defs><rect width="640" height="360" fill="url(#g)"/><rect x="40" y="40" width="260" height="22" rx="6" fill="#fff" opacity=".85"/><rect x="40" y="80" width="420" height="14" rx="6" fill="#fff" opacity=".5"/><rect x="40" y="106" width="380" height="14" rx="6" fill="#fff" opacity=".5"/></svg>'
    );

  let items = [
    { origin: MAC, ts: now - 0.3 * min, ctype: 'text', text: 'https://www.figma.com/file/8sQx2/ClipBridge-onboarding?node-id=12-40' },
    { origin: PC, ts: now - 4 * min, ctype: 'text', text: 'נפגשים מחר ב-10:00 במשרד, קומה 3. להביא את המחשב הנייד ואת המטען.' },
    { origin: MAC, ts: now - 12 * min, ctype: 'image', w: 1280, h: 720, bytes: 412000, src: img },
    {
      origin: PC,
      ts: now - 38 * min,
      ctype: 'text',
      text: 'async function syncAll(peers) {\n  for (const peer of peers) {\n    if (!peer.online) continue;\n    await pull(peer);\n  }\n}\n\nmodule.exports = { syncAll };\n// TODO: retry with backoff',
      pinned: true,
    },
    { origin: MAC, ts: now - 95 * min, ctype: 'text', text: 'shachar@example.com' },
    { origin: PC, ts: now - 3.2 * 60 * min, ctype: 'text', text: 'Order #48213 — 2× USB-C cable, 1× 65W charger. Delivery Thursday.' },
    {
      origin: MAC,
      ts: now - 26 * 60 * min,
      ctype: 'text',
      text: 'סיכום פגישה:\n1. לסגור את גרסת הבטא עד סוף החודש\n2. לבדוק את הסנכרון ברשת של המשרד\n3. לשלוח ללקוח את המחירון המעודכן\n4. לתאם הדרכה לצוות\n5. לעדכן את המסמך המשותף\n6. פגישת המשך ביום ראשון',
    },
    { origin: PC, ts: now - 27 * 60 * min, ctype: 'text', text: '192.168.1.24' },
    { origin: MAC, ts: now - 4 * 24 * 60 * min, ctype: 'text', text: 'רחוב הרצל 12, תל אביב', pinned: true },
  ].map((it, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, length: it.text ? it.text.length : 0, pinned: false, ...it }));

  const params = new URLSearchParams(location.search);
  const state = {
    self: { id: PC, name: 'Shachar-PC', platform: 'win32' },
    settings: {
      language: params.get('lang') || 'en',
      deviceName: 'Shachar-PC',
      code: 'K7QM-4XRT-P9WE',
      applyIncoming: true,
      hideAfterCopy: true,
      notifyOnReceive: false,
      openAtLogin: true,
      paused: false,
      shortcut: 'CommandOrControl+Shift+Space',
      manualPeers: [],
    },
    peers: [{ id: MAC, name: 'MacBook Air', platform: 'darwin', address: '192.168.1.31', port: 47801, online: true, lastSeen: now, lastSyncAt: now - 20e3 }],
    foreign: [],
    devices: { [PC]: { name: 'Shachar-PC', platform: 'win32' }, [MAC]: { name: 'MacBook Air', platform: 'darwin' } },
    port: 47801,
    addresses: ['192.168.1.24'],
    listenError: null,
    loginStatus: params.get('login') || null,
    total: items.length,
    dataDir: 'C:\\Users\\me\\AppData\\Roaming\\ClipBridge\\history',
    version: '1.0.0',
  };

  const listeners = {};
  const emit = (ch) => (listeners[ch] || []).forEach((cb) => cb());
  if (params.has('alone')) {
    state.peers = [];
    state.devices = { [PC]: state.devices[PC] };
  }
  if (params.has('empty')) items = [];

  window.api = {
    platform: params.get('platform') || 'win32',
    getState: async () => ({ ...state, total: items.length }),
    list: async ({ q = '', filter = 'all', offset = 0, limit = 80 }) => {
      const needle = q.toLowerCase();
      const res = items.filter(
        (i) =>
          (filter !== 'pinned' || i.pinned) &&
          (filter !== 'text' || i.ctype === 'text') &&
          (filter !== 'image' || i.ctype === 'image') &&
          (!filter.startsWith('device:') || i.origin === filter.slice(7)) &&
          (!needle || (i.text || '').toLowerCase().includes(needle))
      );
      return { items: res.slice(offset, offset + limit), total: res.length };
    },
    copy: async () => ({ ok: true }),
    remove: async (id) => {
      items = items.filter((i) => i.id !== id);
    },
    pin: async (id, pinned) => {
      items.find((i) => i.id === id).pinned = pinned;
      emit('history:changed');
    },
    clear: async () => {
      items = items.filter((i) => i.pinned);
      emit('history:changed');
    },
    setSettings: async (patch) => {
      Object.assign(state.settings, patch);
      emit('state:changed');
      return { ok: true };
    },
    regenerateCode: async () => ({ ok: true }),
    addPeer: async () => ({ ok: true, found: false }),
    removePeer: async () => {},
    syncNow: async () => {},
    openDataDir: async () => {},
    hide: async () => {},
    on: (ch, cb) => {
      (listeners[ch] = listeners[ch] || []).push(cb);
      return () => {};
    },
  };
})();
