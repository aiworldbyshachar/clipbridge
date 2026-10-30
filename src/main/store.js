'use strict';
// History store: an append-only, replicated event log.
//
// Every change is an event stamped with (origin device, seq). Events from one
// origin are numbered 1, 2, 3... so a device only needs to tell a peer the
// highest contiguous seq it has per origin ("have" map) to receive what it is
// missing. Event kinds:
//   clip  - something was copied (text or image)
//   del   - a clip was deleted (its content is stripped everywhere)
//   pin   - a clip was starred / unstarred (last writer wins)
//   clear - every unpinned clip copied up to `before` was deleted
// Deleted clips stay in the log as small stubs so seq numbers never have gaps.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_TEXT_CHARS = 16 * 1024 * 1024;
const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
const RECENT_DUPLICATE_WINDOW = 30;

class HistoryStore extends EventEmitter {
  constructor({ dir, deviceName, platform }) {
    super();
    this.dir = dir;
    this.deviceName = deviceName;
    this.platform = platform || process.platform;
    this.logPath = path.join(dir, 'history.jsonl');
    this.imgDir = path.join(dir, 'images');
    this.deviceId = null;

    this.events = new Map(); // id -> event, in apply order
    this.seqIndex = new Map(); // origin -> Map(seq -> id)
    this.maxSeen = {}; // origin -> highest seq seen
    this.hw = {}; // origin -> highest contiguous seq
    this.pending = {}; // origin -> Set of seqs above hw
    this.clips = []; // live clips sorted by ts ascending
    this.deletedIds = new Set();
    this.clearBefore = 0;
    this.pins = new Map(); // clip id -> { pinned, ts, id }
    this.names = {}; // origin -> { name, platform, ts }

    this._queue = [];
    this._outbox = [];
    this._dirty = false;
    this._compactTimer = null;
  }

  load() {
    fs.mkdirSync(this.imgDir, { recursive: true });
    this.deviceId = this._loadDeviceId();

    let raw = '';
    try {
      raw = fs.readFileSync(this.logPath, 'utf8');
    } catch {}
    let bad = 0;
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let ev;
      try {
        ev = this._sanitize(JSON.parse(line));
      } catch {
        ev = null;
      }
      if (!ev) {
        bad++;
        continue;
      }
      if (ev.kind === 'clip' && ev.ctype === 'image' && !ev.deleted && !fs.existsSync(this._imgPath(ev.id))) {
        ev.deleted = true;
        this._dirty = true;
      }
      this._apply(ev, null, false);
    }
    this._removeOrphanImages();
    if (bad || this._dirty) this.compact();
  }

  // ---------- local changes ----------

  addLocalClip(data) {
    if (data.ctype === 'text') {
      // Copying the same text again moves it to the top instead of piling up duplicates.
      const start = Math.max(0, this.clips.length - RECENT_DUPLICATE_WINDOW);
      const dupes = this.clips.slice(start).filter((c) => c.ctype === 'text' && c.text === data.text);
      if (dupes.length && dupes[dupes.length - 1] === this.clips[this.clips.length - 1]) return null;
      for (const d of dupes) if (!this.isPinned(d.id)) this._local('del', { target: d.id });
    }
    const ev = this._newEvent('clip');
    ev.originName = this.deviceName;
    ev.originPlatform = this.platform;
    ev.ctype = data.ctype;
    if (data.ctype === 'text') {
      ev.text = data.text;
      if (data.html) ev.html = data.html;
    } else {
      ev.w = data.w;
      ev.h = data.h;
      ev.bytes = data.png.length;
    }
    this._apply(ev, data.png || null, true);
    this._outbox.push(ev);
    this._commit();
    return ev;
  }

  deleteClip(id) {
    return this._localOp('del', { target: id });
  }

  setPinned(id, pinned) {
    return this._localOp('pin', { target: id, pinned: !!pinned });
  }

  clearAll() {
    return this._localOp('clear', { before: Date.now() });
  }

  setDeviceName(name) {
    this.deviceName = name;
  }

  // Events created locally since the last call, for broadcasting to peers.
  takeOutbox() {
    const out = this._outbox;
    this._outbox = [];
    return out;
  }

  // ---------- replication ----------

  getHave() {
    return { ...this.hw };
  }

  hasGaps() {
    return Object.values(this.pending).some((s) => s.size > 0);
  }

  // Events the requester is missing, ordered by (origin, seq) and paginated.
  // `exclude` skips one origin (the requester always has its own events).
  eventsSince(have, cursor, maxCount, maxBytes, exclude) {
    if (!have || typeof have !== 'object') have = {};
    if (cursor && (typeof cursor.origin !== 'string' || !Number.isSafeInteger(cursor.seq))) cursor = null;
    const origins = [...this.seqIndex.keys()].sort();
    const events = [];
    let bytes = 0;
    for (const origin of origins) {
      if (origin === exclude || (cursor && origin < cursor.origin)) continue;
      const index = this.seqIndex.get(origin);
      let from = Math.max(1, (Number(have[origin]) || 0) + 1);
      if (cursor && origin === cursor.origin) from = Math.max(from, cursor.seq + 1);
      for (let seq = from; seq <= (this.maxSeen[origin] || 0); seq++) {
        const id = index.get(seq);
        if (!id) continue;
        const wire = this.toWire(this.events.get(id));
        const size = 300 + (wire.text ? wire.text.length : 0) + (wire.html ? wire.html.length : 0) + (wire.data ? wire.data.length : 0);
        if (events.length && (events.length >= maxCount || bytes + size > maxBytes)) {
          const last = events[events.length - 1];
          return { events, more: true, cursor: { origin: last.origin, seq: last.seq } };
        }
        events.push(wire);
        bytes += size;
      }
    }
    return { events, more: false, cursor: null };
  }

  toWire(ev) {
    const wire = { ...ev };
    if (ev.kind === 'clip' && ev.ctype === 'image' && !ev.deleted) {
      try {
        wire.data = fs.readFileSync(this._imgPath(ev.id)).toString('base64');
      } catch {
        wire.deleted = true;
      }
    }
    return wire;
  }

  applyRemote(list) {
    const applied = [];
    for (const wire of Array.isArray(list) ? list : []) {
      const ev = this._sanitize(wire);
      if (!ev || this.events.has(ev.id)) continue;
      let image = null;
      if (ev.kind === 'clip' && ev.ctype === 'image' && !ev.deleted) {
        image = typeof wire.data === 'string' ? Buffer.from(wire.data, 'base64') : null;
        if (!image || !image.length || image.length > MAX_IMAGE_BYTES) {
          ev.deleted = true;
          image = null;
        } else {
          ev.bytes = image.length;
        }
      }
      if (this._apply(ev, image, true)) applied.push(ev);
    }
    if (applied.length) this._commit();
    return applied;
  }

  // ---------- queries ----------

  query({ q = '', filter = 'all', offset = 0, limit = 80 } = {}) {
    const needle = String(q).trim().toLowerCase();
    const device = filter.startsWith('device:') ? filter.slice(7) : null;
    const items = [];
    let total = 0;
    for (let i = this.clips.length - 1; i >= 0; i--) {
      const c = this.clips[i];
      if (filter === 'pinned' && !this.isPinned(c.id)) continue;
      if (filter === 'text' && c.ctype !== 'text') continue;
      if (filter === 'image' && c.ctype !== 'image') continue;
      if (device && c.origin !== device) continue;
      if (needle && !(c.ctype === 'text' && c.text.toLowerCase().includes(needle))) continue;
      if (total >= offset && items.length < limit) items.push(c);
      total++;
    }
    return { items, total };
  }

  get(id) {
    const ev = this.events.get(id);
    return ev && ev.kind === 'clip' && !ev.deleted ? ev : null;
  }

  latest(n) {
    return this.clips.slice(-n).reverse();
  }

  count() {
    return this.clips.length;
  }

  isPinned(id) {
    const p = this.pins.get(id);
    return !!(p && p.pinned);
  }

  imagePath(id) {
    const ev = this.get(id);
    return ev && ev.ctype === 'image' ? this._imgPath(id) : null;
  }

  getNames() {
    return { ...this.names };
  }

  // ---------- persistence ----------

  compact() {
    const lines = [];
    for (const ev of this.events.values()) lines.push(JSON.stringify(ev));
    const body = lines.length ? lines.join('\n') + '\n' : '';
    const tmp = this.logPath + '.tmp';
    fs.writeFileSync(tmp, body);
    try {
      fs.renameSync(tmp, this.logPath);
    } catch {
      fs.writeFileSync(this.logPath, body);
      fs.rmSync(tmp, { force: true });
    }
    this._dirty = false;
  }

  flush() {
    if (this._compactTimer) {
      clearTimeout(this._compactTimer);
      this._compactTimer = null;
    }
    if (this._dirty) this.compact();
  }

  // ---------- internals ----------

  _loadDeviceId() {
    // The device id lives next to the history so that wiping the history also
    // gives the device a fresh identity (and fresh seq numbers).
    const file = path.join(this.dir, 'device.json');
    try {
      const id = JSON.parse(fs.readFileSync(file, 'utf8')).deviceId;
      if (ID_RE.test(id)) return id;
    } catch {}
    const id = crypto.randomUUID();
    fs.writeFileSync(file, JSON.stringify({ deviceId: id }));
    return id;
  }

  _newEvent(kind) {
    const seq = Math.max(this.maxSeen[this.deviceId] || 0, this.hw[this.deviceId] || 0) + 1;
    return { id: crypto.randomUUID(), origin: this.deviceId, seq, ts: Date.now(), kind };
  }

  _local(kind, fields) {
    const ev = Object.assign(this._newEvent(kind), fields);
    this._apply(ev, null, true);
    this._outbox.push(ev);
    return ev;
  }

  _localOp(kind, fields) {
    const ev = this._local(kind, fields);
    this._commit();
    return ev;
  }

  _commit() {
    if (this._queue.length) {
      fs.appendFileSync(this.logPath, this._queue.join('\n') + '\n');
      this._queue = [];
    }
    if (this._dirty) this._scheduleCompact();
    this.emit('changed');
  }

  _scheduleCompact() {
    if (this._compactTimer) return;
    this._compactTimer = setTimeout(() => {
      this._compactTimer = null;
      if (this._dirty) this.compact();
    }, 3000);
  }

  _apply(ev, image, persist) {
    if (this.events.has(ev.id)) return false;
    this.events.set(ev.id, ev);
    let index = this.seqIndex.get(ev.origin);
    if (!index) this.seqIndex.set(ev.origin, (index = new Map()));
    index.set(ev.seq, ev.id);
    this.maxSeen[ev.origin] = Math.max(this.maxSeen[ev.origin] || 0, ev.seq);
    this._markSeq(ev.origin, ev.seq);

    if (ev.kind === 'clip') {
      const known = this.names[ev.origin];
      if (ev.originName && (!known || ev.ts >= known.ts)) {
        this.names[ev.origin] = { name: ev.originName, platform: ev.originPlatform || '', ts: ev.ts };
      }
      const killed = ev.deleted || this.deletedIds.has(ev.id) || (ev.ts <= this.clearBefore && !this.isPinned(ev.id));
      if (killed) {
        if (!ev.deleted) {
          this._stripFields(ev);
          this._dirty = true;
        }
      } else {
        if (ev.ctype === 'image' && image) fs.writeFileSync(this._imgPath(ev.id), image);
        this._insertClip(ev);
      }
    } else if (ev.kind === 'del') {
      this.deletedIds.add(ev.target);
      this._strip(ev.target);
    } else if (ev.kind === 'pin') {
      const cur = this.pins.get(ev.target);
      if (!cur || cur.ts < ev.ts || (cur.ts === ev.ts && cur.id < ev.id)) {
        this.pins.set(ev.target, { pinned: ev.pinned, ts: ev.ts, id: ev.id });
      }
    } else if (ev.kind === 'clear' && ev.before > this.clearBefore) {
      this.clearBefore = ev.before;
      const kept = [];
      for (const c of this.clips) {
        if (c.ts <= ev.before && !this.isPinned(c.id)) this._stripFields(c);
        else kept.push(c);
      }
      if (kept.length !== this.clips.length) this._dirty = true;
      this.clips = kept;
    }

    if (persist) this._queue.push(JSON.stringify(ev));
    return true;
  }

  _markSeq(origin, seq) {
    let hw = this.hw[origin] || 0;
    if (seq <= hw) return;
    const pending = this.pending[origin] || (this.pending[origin] = new Set());
    pending.add(seq);
    while (pending.has(hw + 1)) pending.delete(++hw);
    this.hw[origin] = hw;
  }

  _strip(id) {
    const ev = this.events.get(id);
    if (!ev || ev.kind !== 'clip' || ev.deleted) return;
    this._stripFields(ev);
    const i = this.clips.indexOf(ev);
    if (i >= 0) this.clips.splice(i, 1);
    this._dirty = true;
  }

  _stripFields(ev) {
    if (ev.ctype === 'image') fs.rmSync(this._imgPath(ev.id), { force: true });
    ev.deleted = true;
    delete ev.text;
    delete ev.html;
    delete ev.w;
    delete ev.h;
    delete ev.bytes;
  }

  _insertClip(ev) {
    const list = this.clips;
    let lo = 0, hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].ts <= ev.ts) lo = mid + 1;
      else hi = mid;
    }
    list.splice(lo, 0, ev);
  }

  _imgPath(id) {
    return path.join(this.imgDir, `${id}.png`);
  }

  _removeOrphanImages() {
    let files = [];
    try {
      files = fs.readdirSync(this.imgDir);
    } catch {}
    for (const f of files) {
      const id = f.replace(/\.png$/, '');
      if (!this.imagePath(id)) fs.rmSync(path.join(this.imgDir, f), { force: true });
    }
  }

  // Whitelists fields so nothing unexpected from the network reaches disk.
  _sanitize(w) {
    if (!w || typeof w !== 'object') return null;
    if (!ID_RE.test(w.id) || !ID_RE.test(w.origin)) return null;
    if (!Number.isSafeInteger(w.seq) || w.seq < 1) return null;
    if (!Number.isFinite(w.ts)) return null;
    const ev = { id: w.id, origin: w.origin, seq: w.seq, ts: w.ts, kind: w.kind };
    switch (w.kind) {
      case 'clip': {
        if (w.ctype !== 'text' && w.ctype !== 'image') return null;
        ev.originName = typeof w.originName === 'string' ? w.originName.slice(0, 100) : '';
        ev.originPlatform = typeof w.originPlatform === 'string' ? w.originPlatform.slice(0, 20) : '';
        ev.ctype = w.ctype;
        if (w.deleted === true) {
          ev.deleted = true;
        } else if (w.ctype === 'text') {
          if (typeof w.text !== 'string' || !w.text || w.text.length > MAX_TEXT_CHARS) return null;
          ev.text = w.text;
          if (typeof w.html === 'string' && w.html && w.html.length <= MAX_TEXT_CHARS) ev.html = w.html;
        } else {
          ev.w = Number.isSafeInteger(w.w) ? w.w : 0;
          ev.h = Number.isSafeInteger(w.h) ? w.h : 0;
          ev.bytes = Number.isSafeInteger(w.bytes) ? w.bytes : 0;
        }
        return ev;
      }
      case 'del':
        if (!ID_RE.test(w.target)) return null;
        ev.target = w.target;
        return ev;
      case 'pin':
        if (!ID_RE.test(w.target)) return null;
        ev.target = w.target;
        ev.pinned = w.pinned === true;
        return ev;
      case 'clear':
        if (!Number.isFinite(w.before)) return null;
        ev.before = w.before;
        return ev;
      default:
        return null;
    }
  }
}

module.exports = { HistoryStore };
