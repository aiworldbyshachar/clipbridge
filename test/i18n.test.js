'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { LANGUAGES, STRINGS } = require('../src/shared/i18n');

const LONG_DASH = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]"); // en dash, em dash
const flat = (msg) => (msg && typeof msg === 'object' ? Object.values(msg) : [msg]);

test('every language has every string', () => {
  const keys = Object.keys(STRINGS.en);
  for (const { code } of LANGUAGES) {
    const table = STRINGS[code];
    assert.ok(table, `missing language ${code}`);
    for (const key of keys) assert.ok(key in table, `${code}: missing "${key}"`);
  }
});

test('short hyphens only: no em or en dashes in any string', () => {
  for (const { code } of LANGUAGES) {
    for (const [key, msg] of Object.entries(STRINGS[code])) {
      for (const s of flat(msg)) assert.ok(!LONG_DASH.test(s), `${code}.${key} has a long dash: ${s}`);
    }
  }
  for (const file of ['src/renderer/index.html', 'src/renderer/app.js', 'src/main/main.js', 'README.md', 'README.he.md', 'docs/index.html']) {
    const text = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.ok(!LONG_DASH.test(text), `${file} has a long dash`);
  }
});
