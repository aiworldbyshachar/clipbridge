// Runs `hyperframes check --json` and prints a short summary of every section's findings.
//   node tools/check.mjs            (errors and warnings)
//   node tools/check.mjs all        (info too)
import { execSync } from 'node:child_process';

let out = '';
try {
  out = execSync('npx hyperframes check --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
} catch (err) {
  out = err.stdout || '';
}
out = out.replace(/^﻿/, '');
const report = JSON.parse(out.slice(out.indexOf('{')));
const showInfo = process.argv[2] === 'all';
console.log('ok:', report.ok);

// Findings live in arrays inside each section; collect anything that looks like one.
function walk(node, section, found) {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, section, found);
  } else if (node && typeof node === 'object') {
    if (typeof node.message === 'string' && (node.severity || node.level || node.rule || node.code)) {
      found.push({ section, ...node });
      return;
    }
    for (const value of Object.values(node)) walk(value, section, found);
  }
}
for (const section of ['lint', 'runtime', 'layout', 'motion', 'contrast', 'craft', 'audio', 'hdr']) {
  const found = [];
  walk(report[section], section, found);
  const shown = found.filter((f) => showInfo || !/info/i.test(f.severity || f.level || ''));
  if (!shown.length) continue;
  console.log(`== ${section} (${shown.length})`);
  for (const f of shown.slice(0, 30)) {
    const where = [f.file, f.selector, f.time != null ? '@' + f.time : '', f.composition].filter(Boolean).join(' ');
    console.log(`  ${f.severity || f.level || ''} ${f.rule || f.code || ''}: ${f.message.slice(0, 200)} ${where ? '[' + where + ']' : ''}`);
    if (f.fix) console.log('     fix:', String(f.fix).slice(0, 200));
  }
}
