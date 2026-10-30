'use strict';
// LAN sync engine.
//
// Discovery: every device broadcasts a small UDP announcement. Devices that
// share a connection code have the same fingerprint and pair automatically;
// devices with a different code are listed as "foreign" so the UI can say so.
// Known peers are also probed directly over HTTP, which keeps things working on
// networks that drop broadcasts once a device has been found (or added by IP).
//
// Transport: plain HTTP between peers, every body sealed with AES-256-GCM using
// a key derived from the connection code. New events reach a peer two ways:
//  - push: the device that copied sends the event straight away, and
//  - watch: every device keeps a long-poll /api/sync open to each peer, which
//    the peer answers the moment it has something new.
// Either one is enough, so delivery stays instant even when one side can't
// accept incoming connections (a firewall, macOS local network rules, ...).
// Anything missed (sleep, offline, other network) is pulled with /api/sync.
const dgram = require('dgram');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { normalizeCode } = require('./code');

const APP_TAG = 'clipbridge';
const PROTO = 1;
const DEFAULT_PORT = 47801;
const DEFAULT_DISCOVERY_PORT = 47800;
const ANNOUNCE_INTERVAL = 3000;
const PROBE_INTERVAL = 5000;
const PROBE_WHEN_SILENT = 6000;
const PEER_TIMEOUT = 15000;
const PERIODIC_SYNC = 30000;
const MAX_BODY = 100 * 1024 * 1024;
const PAGE_COUNT = 300;
const PAGE_BYTES = 16 * 1024 * 1024;
const WATCH_HOLD = 10000; // how long a server holds an idle long-poll
const WATCH_TIMEOUT = 25000;
const LIVE_WINDOW = 10000; // a clip this fresh also goes to the receiver's clipboard

function deriveKey(code) {
  return crypto.scryptSync(normalizeCode(code), 'clipbridge/v1', 32);
}

function seal(key, obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

function unseal(key, buf) {
  if (buf.length < 28) throw new Error('short body');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8'));
}

function readBody(stream, limit) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    stream.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        stream.destroy();
        return;
      }
      parts.push(c);
    });
    stream.on('end', () => resolve(Buffer.concat(parts)));
    stream.on('error', reject);
  });
}

const ipToInt = (ip) => ip.split('.').reduce((n, part) => ((n << 8) | Number(part)) >>> 0, 0);
const intToIp = (n) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');

function ipv4Interfaces() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push(a);
    }
  }
  return out;
}

function localAddresses() {
  return ipv4Interfaces().map((a) => a.address);
}

function broadcastAddresses() {
  const set = new Set(['255.255.255.255']);
  for (const a of ipv4Interfaces()) {
    set.add(intToIp((ipToInt(a.address) | ~ipToInt(a.netmask)) >>> 0));
  }
  return [...set];
}

function cleanAddress(addr) {
  return String(addr || '').replace(/^::ffff:/, '');
}

function parseTarget(text) {
  const m = String(text || '').trim().match(/^([a-zA-Z0-9.\-]+)(?::(\d{1,5}))?$/);
  if (!m) return null;
  return { host: m[1], port: m[2] ? Number(m[2]) : DEFAULT_PORT };
}

class SyncEngine extends EventEmitter {
  constructor(opts) {
    super();
    this.store = opts.store;
    this.id = opts.store.deviceId;
    this.name = opts.deviceName;
    this.platform = opts.platform || process.platform;
    this.preferredPort = opts.port || DEFAULT_PORT;
    this.discoveryPort = opts.discoveryPort || DEFAULT_DISCOVERY_PORT;
    this.manualPeers = opts.manualPeers || [];
    this.knownPeers = opts.knownPeers || [];
    this.log = opts.log || (() => {});
    this.port = null;
    this.peers = new Map();
    this.foreign = new Map();
    this.syncing = new Set();
    this.resync = new Set();
    this.syncTimers = new Map();
    this.links = new Set(); // peers we hold a long-poll to
    this.waiters = new Set(); // long-polls peers hold to us
    this.requests = new Set(); // outgoing requests in flight
    this.liveIds = new Map(); // clip id -> when it arrived live from a peer
    this.timers = [];
    this.running = false;
    this.listenError = null;
    this.setCode(opts.code, true);
  }

  // ---------- lifecycle ----------

  async start() {
    this.running = true;
    this._onStoreChanged = () => this._wakeWaiters();
    this.store.on('changed', this._onStoreChanged);
    try {
      await this._listen();
    } catch (err) {
      this.listenError = err.message;
      this.log('listen failed:', err.message);
    }
    this._startDiscovery();
    this.timers.push(setInterval(() => this._announce(), ANNOUNCE_INTERVAL));
    this.timers.push(setInterval(() => this._probeTick(), PROBE_INTERVAL));
    this.timers.push(setInterval(() => this._checkPeers(), 2000));
    this.timers.push(setInterval(() => this.syncAll(), PERIODIC_SYNC));
    this._probeTick();
  }

  stop() {
    this.running = false;
    if (this._onStoreChanged) this.store.off('changed', this._onStoreChanged);
    this._dropConnections();
    for (const t of this.timers) clearInterval(t);
    for (const t of this.syncTimers.values()) clearTimeout(t);
    this.timers = [];
    this.syncTimers.clear();
    if (this.udp) {
      try {
        this.udp.close();
      } catch {}
      this.udp = null;
    }
    if (this.server) {
      this.server.close();
      if (this.server.closeAllConnections) this.server.closeAllConnections();
      this.server = null;
    }
  }

  // ---------- configuration ----------

  setCode(code, silent) {
    this.key = deriveKey(code);
    this.fp = crypto.createHash('sha256').update(this.key).update('fingerprint').digest('hex').slice(0, 16);
    if (silent) return;
    this.peers.clear();
    this.foreign.clear();
    this._dropConnections();
    this._emitPeers();
    this._announce();
    this._probeTick();
  }

  setDeviceName(name) {
    this.name = name;
    this._announce();
  }

  setManualPeers(list) {
    this.manualPeers = list;
    this._probeTick();
  }

  // ---------- public API ----------

  getPeers() {
    return [...this.peers.values()].map((p) => ({
      id: p.id,
      name: p.name,
      platform: p.platform,
      address: p.address,
      port: p.port,
      online: p.online,
      lastSeen: p.lastSeen,
      lastSyncAt: p.lastSyncAt,
      lastError: p.lastError || null,
    }));
  }

  getForeign() {
    return [...this.foreign.values()].map((f) => ({ ...f }));
  }

  broadcast(events) {
    if (!events || !events.length) return;
    const body = { from: this._me(), events: events.map((e) => this.store.toWire(e)) };
    for (const p of this.peers.values()) {
      if (!p.online) continue;
      const send = (retry) =>
        this._post(p, '/api/push', body, 30000).catch((err) => {
          this.log(`push to ${p.name} failed: ${err.message}`);
          if (retry) setTimeout(() => send(false), 3000);
        });
      send(true);
    }
  }

  syncAll() {
    for (const p of this.peers.values()) if (p.online) this._scheduleSync(p.id, 0);
  }

  // Asks a host directly who it is. Pairs with it when the code matches.
  probe(host, port) {
    return new Promise((resolve, reject) => {
      const req = http.get({ host, port: port || DEFAULT_PORT, path: '/api/hello', timeout: 2500 }, (res) => {
        readBody(res, 64 * 1024).then((buf) => {
          let hello;
          try {
            hello = JSON.parse(buf.toString('utf8'));
          } catch {
            return reject(new Error('not a ClipBridge device'));
          }
          if (!hello || hello.app !== APP_TAG || typeof hello.id !== 'string') return reject(new Error('not a ClipBridge device'));
          if (hello.id !== this.id) {
            if (hello.fp === this.fp) this._touchPeer(hello, host, 'probe');
            else this._touchForeign(hello, host);
          }
          resolve(hello);
        }, reject);
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
    });
  }

  // ---------- HTTP server ----------

  _listen() {
    return new Promise((resolve, reject) => {
      let port = this.preferredPort;
      let attempts = 0;
      const server = http.createServer((req, res) => this._handle(req, res));
      server.keepAliveTimeout = 5000;
      const onError = (err) => {
        if (err.code === 'EADDRINUSE' && attempts < 10) {
          attempts++;
          port++;
          server.listen(port, '0.0.0.0');
        } else {
          reject(err);
        }
      };
      server.on('error', onError);
      server.once('listening', () => {
        server.off('error', onError);
        server.on('error', (err) => this.log('server error:', err.message));
        this.server = server;
        this.port = server.address().port;
        resolve();
      });
      server.listen(port, '0.0.0.0');
    });
  }

  async _handle(req, res) {
    const url = (req.url || '').split('?')[0];
    try {
      if (req.method === 'GET' && url === '/api/hello') return this._json(res, 200, this._hello());
      if (req.method !== 'POST' || (url !== '/api/push' && url !== '/api/sync')) return this._json(res, 404, { error: 'not found' });
      const body = await readBody(req, MAX_BODY);
      let msg;
      try {
        msg = unseal(this.key, body);
      } catch {
        return this._json(res, 403, { error: 'wrong connection code' });
      }
      const from = msg && msg.from;
      if (!from || typeof from.id !== 'string' || from.id === this.id) return this._json(res, 400, { error: 'bad request' });
      this._touchPeer(from, cleanAddress(req.socket.remoteAddress), 'http');
      if (url === '/api/push') return this._reply(res, this._onPush(msg));
      if (msg.wait) return this._watch(msg, res);
      this._reply(res, this._page(msg.have, msg.cursor, from.id));
    } catch (err) {
      this.log('request failed:', err.message);
      if (!res.headersSent) this._json(res, 500, { error: 'internal error' });
    }
  }

  _reply(res, obj) {
    const sealed = seal(this.key, obj);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': sealed.length });
    res.end(sealed);
  }

  _onPush(msg) {
    const applied = this.store.applyRemote(msg.events);
    const live = applied.filter((e) => e.kind === 'clip' && !e.deleted).pop();
    if (live) this._emitLive(live, msg.from);
    // A seq gap means an earlier push was missed: pull the rest.
    if (this.store.hasGaps()) this._scheduleSync(msg.from.id, 300);
    return { ok: true };
  }

  // One page of what the requester is missing (never its own events), plus the
  // id of a clip that is fresh enough to go to the requester's clipboard.
  _page(have, cursor, requester) {
    const page = this.store.eventsSince(have, cursor, PAGE_COUNT, PAGE_BYTES, requester);
    page.live = this._liveClipId(page.events);
    return page;
  }

  // Freshness is judged on this device's own clock, so clock differences
  // between computers don't matter.
  _liveClipId(events) {
    const now = Date.now();
    let best = null;
    for (const e of events) {
      if (e.kind !== 'clip' || e.deleted) continue;
      const fresh = e.origin === this.id ? now - e.ts < LIVE_WINDOW : now - (this.liveIds.get(e.id) || 0) < LIVE_WINDOW;
      if (fresh && (!best || e.ts > best.ts)) best = e;
    }
    return best ? best.id : null;
  }

  _emitLive(ev, from) {
    this.liveIds.set(ev.id, Date.now());
    this.emit('remote-clip', ev, { id: from.id, name: from.name });
  }

  // ---------- long-poll, server side ----------

  _watch(msg, res) {
    const page = this._page(msg.have, null, msg.from.id);
    if (page.events.length) return this._reply(res, page);
    const waiter = { have: msg.have, from: msg.from.id, res, done: false };
    waiter.timer = setTimeout(() => this._finishWaiter(waiter, { events: [], more: false, cursor: null, live: null }), WATCH_HOLD);
    res.on('close', () => this._dropWaiter(waiter));
    this.waiters.add(waiter);
  }

  _wakeWaiters() {
    for (const w of [...this.waiters]) {
      const page = this._page(w.have, null, w.from);
      if (page.events.length) this._finishWaiter(w, page);
    }
  }

  _finishWaiter(w, body) {
    if (w.done) return;
    this._dropWaiter(w);
    try {
      this._reply(w.res, body);
    } catch {}
  }

  _dropWaiter(w) {
    w.done = true;
    clearTimeout(w.timer);
    this.waiters.delete(w);
  }

  _dropConnections() {
    for (const w of [...this.waiters]) {
      this._dropWaiter(w);
      w.res.destroy();
    }
    for (const req of this.requests) req.destroy();
    this.requests.clear();
  }

  _json(res, status, obj) {
    const body = Buffer.from(JSON.stringify(obj));
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': body.length });
    res.end(body);
  }

  _post(peer, urlPath, obj, timeout) {
    const payload = seal(this.key, obj);
    return new Promise((resolve, reject) => {
      const req = http.request({
        host: peer.address,
        port: peer.port,
        path: urlPath,
        method: 'POST',
        timeout,
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': payload.length },
      });
      this.requests.add(req);
      req.on('close', () => this.requests.delete(req));
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
      req.on('response', (res) => {
        readBody(res, MAX_BODY).then((buf) => {
          if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
          try {
            resolve(unseal(this.key, buf));
          } catch {
            reject(new Error('could not decrypt reply'));
          }
        }, reject);
      });
      req.end(payload);
    });
  }

  // ---------- discovery ----------

  _hello() {
    return { app: APP_TAG, proto: PROTO, id: this.id, name: this.name, platform: this.platform, port: this.port, fp: this.fp };
  }

  _me() {
    return { id: this.id, name: this.name, platform: this.platform, port: this.port };
  }

  _startDiscovery() {
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    sock.on('error', (err) => this.log('udp error:', err.message));
    sock.on('message', (buf, rinfo) => this._onAnnounce(buf, rinfo));
    sock.bind(this.discoveryPort, () => {
      try {
        sock.setBroadcast(true);
      } catch {}
      this._announce();
    });
    this.udp = sock;
  }

  _announce(target) {
    if (!this.udp || !this.port) return;
    const msg = Buffer.from(JSON.stringify({ ...this._hello(), reply: !!target }));
    const targets = target ? [target] : broadcastAddresses();
    if (!target) {
      // Unicast as well: some routers and mesh Wi-Fi drop broadcasts.
      for (const p of this.peers.values()) if (p.address) targets.push(p.address);
    }
    for (const addr of new Set(targets)) {
      try {
        this.udp.send(msg, this.discoveryPort, addr, () => {});
      } catch {}
    }
  }

  _onAnnounce(buf, rinfo) {
    let m;
    try {
      m = JSON.parse(buf.toString('utf8'));
    } catch {
      return;
    }
    if (!m || m.app !== APP_TAG || typeof m.id !== 'string' || m.id === this.id) return;
    if (m.fp !== this.fp) return this._touchForeign(m, rinfo.address);
    const wasOnline = this.peers.get(m.id)?.online;
    this._touchPeer(m, rinfo.address, 'udp');
    if (!wasOnline && !m.reply) this._announce(rinfo.address);
  }

  _touchPeer(info, address, via) {
    let p = this.peers.get(info.id);
    const cameOnline = !p || !p.online;
    if (!p) {
      p = { id: info.id, lastSyncAt: 0 };
      this.peers.set(info.id, p);
    }
    const now = Date.now();
    const name = String(info.name || '').slice(0, 100) || 'device';
    const port = Number.isInteger(info.port) ? info.port : p.port;
    // A machine with several network adapters (Wi-Fi + VPN/WSL) is heard on all
    // of them; stick with the current address while it keeps working.
    if (address === p.address) p.addressSeen = now;
    const keepAddress = p.address && address !== p.address && now - (p.addressSeen || 0) < ANNOUNCE_INTERVAL * 2.5;
    if (keepAddress) address = p.address;
    const changed = cameOnline || p.name !== name || p.address !== address || p.port !== port;
    p.name = name;
    p.platform = typeof info.platform === 'string' ? info.platform : p.platform;
    if (address && address !== p.address) {
      p.address = address;
      p.addressSeen = now;
    }
    p.port = port;
    p.lastSeen = now;
    p.online = true;
    p.via = via;
    if (this.foreign.delete(info.id) || changed) this._emitPeers();
    if (cameOnline) this._startLink(p.id);
  }

  _touchForeign(info, address) {
    const isNew = !this.foreign.has(info.id);
    this.foreign.set(info.id, {
      id: info.id,
      name: String(info.name || '').slice(0, 100),
      platform: info.platform,
      address,
      lastSeen: Date.now(),
    });
    const p = this.peers.get(info.id);
    if (p && p.online) p.online = false;
    if (isNew) this._emitPeers();
  }

  _probeTick() {
    const now = Date.now();
    const targets = new Map();
    const add = (text) => {
      const t = parseTarget(text);
      if (t) targets.set(`${t.host}:${t.port}`, t);
    };
    this.manualPeers.forEach(add);
    this.knownPeers.forEach(add);
    for (const p of this.peers.values()) if (p.address && p.port) add(`${p.address}:${p.port}`);
    for (const p of this.peers.values()) {
      // Peers that are announcing themselves over UDP don't need probing.
      if (p.online && now - p.lastSeen < PROBE_WHEN_SILENT) targets.delete(`${p.address}:${p.port}`);
    }
    for (const t of targets.values()) this.probe(t.host, t.port).catch(() => {});
  }

  _checkPeers() {
    const now = Date.now();
    let changed = false;
    for (const p of this.peers.values()) {
      if (p.online && now - p.lastSeen > PEER_TIMEOUT) {
        p.online = false;
        changed = true;
      }
    }
    for (const [id, f] of this.foreign) {
      if (now - f.lastSeen > PEER_TIMEOUT * 2) {
        this.foreign.delete(id);
        changed = true;
      }
    }
    for (const [id, at] of this.liveIds) if (now - at > LIVE_WINDOW * 6) this.liveIds.delete(id);
    if (changed) this._emitPeers();
  }

  _emitPeers() {
    this.emit('peers', this.getPeers(), this.getForeign());
  }

  // ---------- long-poll, client side ----------

  _startLink(id) {
    if (!this.running || this.links.has(id)) return;
    this.links.add(id);
    this._runLink(id).finally(() => this.links.delete(id));
  }

  // While a peer is online: catch up on history, then keep a long-poll open
  // so its new copies arrive the moment they happen.
  async _runLink(id) {
    let caughtUp = false;
    let failures = 0;
    while (this.running) {
      const p = this.peers.get(id);
      if (!p || !p.online || !p.address || !p.port) return;
      try {
        if (!caughtUp) {
          await this._pull(p);
          this._markSynced(p);
          caughtUp = true;
        } else {
          const res = await this._post(p, '/api/sync', { from: this._me(), have: this.store.getHave(), wait: true }, WATCH_TIMEOUT);
          this._applyPage(res, p);
          if (res.more) caughtUp = false;
        }
        failures = 0;
      } catch (err) {
        caughtUp = false;
        if (!failures++) this.log(`connection to ${p.name} failed: ${err.message}`);
        p.lastError = err.message;
        await new Promise((r) => setTimeout(r, Math.min(30000, 2000 * failures)).unref());
      }
    }
  }

  // ---------- pulling missed history ----------

  async _pull(p) {
    let cursor = null;
    for (;;) {
      const res = await this._post(p, '/api/sync', { from: this._me(), have: this.store.getHave(), cursor }, 60000);
      this._applyPage(res, p);
      if (!res.more || !res.cursor) return;
      cursor = res.cursor;
    }
  }

  _applyPage(res, p) {
    const applied = this.store.applyRemote(res && res.events);
    if (res && res.live) {
      const ev = applied.find((e) => e.id === res.live);
      if (ev && ev.kind === 'clip' && !ev.deleted) this._emitLive(ev, p);
    }
  }

  _markSynced(p) {
    const first = !p.lastSyncAt || p.lastError;
    p.lastSyncAt = Date.now();
    p.lastError = null;
    if (first) this._emitPeers();
  }

  _scheduleSync(id, delay) {
    if (this.syncTimers.has(id)) return;
    const timer = setTimeout(() => {
      this.syncTimers.delete(id);
      this._syncWith(id);
    }, delay);
    this.syncTimers.set(id, timer);
  }

  async _syncWith(id) {
    const p = this.peers.get(id);
    if (!p || !p.online || !p.address || !p.port) return;
    if (this.syncing.has(id)) {
      this.resync.add(id);
      return;
    }
    this.syncing.add(id);
    try {
      await this._pull(p);
      this._markSynced(p);
    } catch (err) {
      p.lastError = err.message;
      this.log(`sync with ${p.name} failed: ${err.message}`);
    } finally {
      this.syncing.delete(id);
      if (this.resync.delete(id)) this._scheduleSync(id, 100);
    }
  }
}

module.exports = { SyncEngine, localAddresses, parseTarget, DEFAULT_PORT };
