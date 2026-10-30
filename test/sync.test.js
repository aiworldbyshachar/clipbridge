'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { HistoryStore } = require('../src/main/store');
const { SyncEngine } = require('../src/main/sync');

const CODE = 'TEST-CODE-2345';
const PNG = fs.readFileSync(path.join(__dirname, '..', 'assets', 'tray@2x.png'));

function makeStore(name, dir) {
  dir = dir || fs.mkdtempSync(path.join(os.tmpdir(), `clipbridge-${name}-`));
  const store = new HistoryStore({ dir, deviceName: name, platform: 'test' });
  store.load();
  return store;
}

function makeEngine(store, port, peerPort, code = CODE) {
  return new SyncEngine({
    store,
    deviceName: store.deviceName,
    code,
    port,
    discoveryPort: 48999,
    manualPeers: [`127.0.0.1:${peerPort}`],
  });
}

async function waitFor(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timed out waiting for condition');
}

const online = (engine) => engine.getPeers().some((p) => p.online);

test('store: duplicates, delete, pin, clear and reload from disk', () => {
  const s = makeStore('solo');
  const a = s.addLocalClip({ ctype: 'text', text: 'alpha' });
  assert.strictEqual(s.addLocalClip({ ctype: 'text', text: 'alpha' }), null, 'same text twice in a row is ignored');
  s.addLocalClip({ ctype: 'text', text: 'beta' });
  s.addLocalClip({ ctype: 'text', text: 'alpha' }); // moves "alpha" to the top
  assert.deepStrictEqual(s.query().items.map((c) => c.text), ['alpha', 'beta']);
  assert.ok(!s.get(a.id), 'older duplicate was removed');

  const img = s.addLocalClip({ ctype: 'image', png: PNG, w: 32, h: 32 });
  assert.ok(fs.existsSync(s.imagePath(img.id)));
  const secret = s.addLocalClip({ ctype: 'text', text: 'password123' });
  s.deleteClip(secret.id);
  const keep = s.query({ q: 'beta' }).items[0];
  s.setPinned(keep.id, true);
  s.clearAll();
  assert.deepStrictEqual(s.query().items.map((c) => c.text), ['beta'], 'clear keeps starred items');
  s.flush();

  const raw = fs.readFileSync(s.logPath, 'utf8');
  assert.ok(!raw.includes('password123'), 'deleted text is purged from disk');
  assert.strictEqual(fs.readdirSync(s.imgDir).length, 0, 'deleted image file is removed');

  const again = makeStore('solo', s.dir);
  assert.strictEqual(again.deviceId, s.deviceId);
  assert.deepStrictEqual(again.query().items.map((c) => c.text), ['beta']);
  assert.ok(again.isPinned(keep.id));
  const next = again.addLocalClip({ ctype: 'text', text: 'gamma' });
  assert.strictEqual(next.seq, Math.max(...[...s.events.values()].map((e) => e.seq)) + 1, 'seq continues after reload');
});

test('sync: live push, images, offline catch-up, deletes and wrong code', async () => {
  const a = makeStore('A');
  const b = makeStore('B');
  const ea = makeEngine(a, 48101, 48102);
  let eb = makeEngine(b, 48102, 48101);
  await ea.start();
  await eb.start();
  try {
    await waitFor(() => online(ea) && online(eb));

    // Live push of text lands in B and fires remote-clip (used to fill the clipboard).
    const received = [];
    eb.on('remote-clip', (ev) => received.push(ev));
    a.addLocalClip({ ctype: 'text', text: 'שלום מהפיסי', html: '<b>שלום</b>' });
    ea.broadcast(a.takeOutbox());
    await waitFor(() => received.length === 1);
    assert.strictEqual(received[0].text, 'שלום מהפיסי');
    assert.strictEqual(b.query().items[0].html, '<b>שלום</b>');

    // Images travel the other way.
    const img = b.addLocalClip({ ctype: 'image', png: PNG, w: 32, h: 32 });
    eb.broadcast(b.takeOutbox());
    await waitFor(() => a.get(img.id));
    assert.deepStrictEqual(fs.readFileSync(a.imagePath(img.id)), PNG);

    // B goes offline; A keeps copying (enough to need several sync pages).
    eb.stop();
    await waitFor(() => !online(ea), 20000);
    const made = [];
    for (let i = 0; i < 700; i++) made.push(a.addLocalClip({ ctype: 'text', text: `item ${i}` }));
    a.deleteClip(made[5].id);
    a.setPinned(made[10].id, true);
    a.takeOutbox();

    // B comes back and pulls everything it missed.
    eb = makeEngine(b, 48102, 48101);
    await eb.start();
    await waitFor(() => b.count() === a.count(), 20000);
    assert.ok(!b.get(made[5].id), 'deletion replicated');
    assert.ok(b.isPinned(made[10].id), 'star replicated');
    assert.deepStrictEqual(b.getHave(), a.getHave());

    // A delete made on B reaches A.
    b.deleteClip(made[700 - 1].id);
    eb.broadcast(b.takeOutbox());
    await waitFor(() => !a.get(made[699].id));

    // A device with a different code is seen but never paired.
    const c = makeStore('C');
    const ec = makeEngine(c, 48103, 48101, 'OTHR-CODE-9999');
    await ec.start();
    try {
      await waitFor(() => ec.getForeign().length > 0);
      assert.strictEqual(c.count(), 0, 'nothing leaks to a device with another code');
      assert.ok(!ec.getPeers().some((p) => p.online));
    } finally {
      ec.stop();
    }
  } finally {
    ea.stop();
    eb.stop();
  }
});

test('long-poll: instant delivery even when one side cannot accept connections', async () => {
  const a = makeStore('A3');
  const b = makeStore('B3');
  // Something B copied a while ago: should reach A's history but not its clipboard.
  const old = b.addLocalClip({ ctype: 'text', text: 'copied a minute ago' });
  old.ts -= 60000;
  b.takeOutbox();

  const ea = makeEngine(a, 48121, 48122);
  const eb = new SyncEngine({ store: b, deviceName: 'B3', code: CODE, port: 48122, discoveryPort: 48999 });
  const received = [];
  ea.on('remote-clip', (ev) => received.push(ev));
  await ea.start();
  await eb.start();
  ea.server.close(); // nothing can connect to A anymore, like a blocking firewall
  try {
    await waitFor(() => online(ea) && online(eb) && a.get(old.id));
    assert.strictEqual(received.length, 0, 'old history is not pasted into the clipboard');

    await new Promise((r) => setTimeout(r, 300)); // let A's long-poll settle
    const started = Date.now();
    b.addLocalClip({ ctype: 'text', text: 'fresh copy' });
    eb.broadcast(b.takeOutbox()); // this direct push to A fails
    await waitFor(() => received.length === 1, 5000);
    const took = Date.now() - started;
    assert.strictEqual(received[0].text, 'fresh copy');
    assert.ok(took < 1500, `delivery took ${took}ms`);
  } finally {
    ea.stop();
    eb.stop();
  }
});
