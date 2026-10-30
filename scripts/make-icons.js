'use strict';
// Generates the app and tray icons as PNG files with no external tools:
// shapes are rasterized with supersampling and written by a tiny PNG encoder.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- shapes (unit coordinates, 0..1) ---
const roundRect = (cx, cy, hw, hh, r) => (x, y) => {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r <= 0;
};

const capsule = (ax, ay, bx, by, r) => (x, y) => {
  const pax = x - ax, pay = y - ay, bax = bx - ax, bay = by - ay;
  const t = Math.min(1, Math.max(0, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * t, pay - bay * t) <= r;
};

const triangle = (p1, p2, p3) => (x, y) => {
  const side = (a, b) => (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
  const d1 = side(p1, p2), d2 = side(p2, p3), d3 = side(p3, p1);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};

const union = (...shapes) => (x, y) => shapes.some((s) => s(x, y));

const solid = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
  return () => c;
};

const diagonal = (from, to) => {
  const a = solid(from)(), b = solid(to)();
  return (x, y) => {
    const t = Math.min(1, Math.max(0, (x + y) / 2));
    return [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t).concat(255);
  };
};

// Each layer: { shape, paint } paints over what is below; { shape, erase: true } cuts a hole.
function render(size, layers, samples) {
  const out = Buffer.alloc(size * size * 4);
  const n = samples * samples;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = (px + (sx + 0.5) / samples) / size;
          const y = (py + (sy + 0.5) / samples) / size;
          let color = null;
          for (const layer of layers) {
            if (!layer.shape(x, y)) continue;
            color = layer.erase ? null : layer.paint(x, y);
          }
          if (color) {
            const alpha = color[3] / 255;
            r += color[0] * alpha; g += color[1] * alpha; b += color[2] * alpha; a += alpha;
          }
        }
      }
      const i = (py * size + px) * 4;
      if (a > 0) {
        out[i] = Math.round(r / a);
        out[i + 1] = Math.round(g / a);
        out[i + 2] = Math.round(b / a);
      }
      out[i + 3] = Math.round((a / n) * 255);
    }
  }
  return encodePNG(size, size, out);
}

const INDIGO = '#4F46E5';
const BG = diagonal('#6E72F5', '#8B4FE8');

// Full app icon with the macOS-style margin around the rounded square.
const appIcon = [
  { shape: roundRect(0.5, 0.5, 0.41, 0.41, 0.19), paint: BG },
  { shape: roundRect(0.5, 0.545, 0.215, 0.255, 0.05), paint: solid('#FFFFFF') },
  { shape: roundRect(0.5, 0.29, 0.105, 0.055, 0.035), paint: solid('#C7D2FE') },
  {
    shape: union(
      capsule(0.39, 0.5, 0.57, 0.5, 0.026),
      triangle([0.63, 0.5], [0.552, 0.44], [0.552, 0.56]),
      capsule(0.43, 0.64, 0.61, 0.64, 0.026),
      triangle([0.37, 0.64], [0.448, 0.58], [0.448, 0.7])
    ),
    paint: solid(INDIGO),
  },
];

// Small, full-bleed colored icon for the Windows tray.
const winTray = [
  { shape: roundRect(0.5, 0.5, 0.5, 0.5, 0.22), paint: BG },
  { shape: roundRect(0.5, 0.57, 0.31, 0.36, 0.08), paint: solid('#FFFFFF') },
  { shape: roundRect(0.5, 0.22, 0.16, 0.08, 0.05), paint: solid('#C7D2FE') },
  {
    shape: union(
      capsule(0.33, 0.5, 0.58, 0.5, 0.055),
      triangle([0.72, 0.5], [0.57, 0.38], [0.57, 0.62]),
      capsule(0.42, 0.74, 0.67, 0.74, 0.055),
      triangle([0.28, 0.74], [0.43, 0.62], [0.43, 0.86])
    ),
    paint: solid(INDIGO),
  },
];

// macOS menu bar template: black silhouette, arrows cut out (only alpha matters).
const macTray = [
  { shape: roundRect(0.5, 0.57, 0.34, 0.39, 0.11), paint: solid('#000000') },
  { shape: roundRect(0.5, 0.15, 0.17, 0.09, 0.06), paint: solid('#000000') },
  {
    shape: union(
      capsule(0.3, 0.48, 0.6, 0.48, 0.06),
      triangle([0.75, 0.48], [0.59, 0.35], [0.59, 0.61]),
      capsule(0.4, 0.74, 0.7, 0.74, 0.06),
      triangle([0.25, 0.74], [0.41, 0.61], [0.41, 0.87])
    ),
    erase: true,
  },
];

const root = path.join(__dirname, '..');
const outputs = [
  ['build/icon.png', 1024, appIcon, 3],
  ['assets/icon.png', 256, appIcon, 6],
  ['assets/icon-128.png', 128, appIcon, 8],
  ['assets/tray.png', 16, winTray, 8],
  ['assets/tray@2x.png', 32, winTray, 8],
  ['assets/trayTemplate.png', 16, macTray, 8],
  ['assets/trayTemplate@2x.png', 32, macTray, 8],
];

for (const [rel, size, layers, samples] of outputs) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, render(size, layers, samples));
  console.log('wrote', rel);
}
