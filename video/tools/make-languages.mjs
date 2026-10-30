// Writes compositions/languages.html from the app's own translations
// (src/shared/i18n.js), so every string in the scene is the real UI text.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { LANGUAGES, createTranslator } = require(path.join(here, '..', '..', 'src', 'shared', 'i18n.js'));

// Spoken anchor times, film time minus the scene start (67.6 s).
const at = { en: 0.6, he: 1.33, es: 2.1, fr: 2.55, ru: 3.46, ar: 4.06 };
const laptop = '<svg class="i" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19.5h20"/></svg>';
const desktop = '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8.5 20h7M12 16v4"/></svg>';
const gear = '<svg viewBox="0 0 24 24"><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/></svg>';
const star = '<svg class="i" viewBox="0 0 24 24" style="width:14px;height:14px"><path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></svg>';
const searchIcon = '<svg class="i" viewBox="0 0 24 24" style="width:16px;height:16px"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

const panes = LANGUAGES.map(({ code, dir }) => {
  const { t } = createTranslator(code);
  const rtf = new Intl.RelativeTimeFormat(code, { numeric: 'auto' });
  return `
      <div id="l-${code}" class="l-pane cb cb-window" dir="${dir}" lang="${code}">
        <div class="cb-topbar">
          <div class="cb-brand"><img src="assets/img/icon-128.png" alt="" />ClipBridge</div>
          <span class="cb-status"><span class="cb-dot"></span>${t('statusConnectedTo', { name: 'MacBook Air' })}</span>
          <span class="cb-icon-btn">${gear}</span>
        </div>
        <div class="cb-search">${searchIcon}<span>${t('searchPlaceholder')}</span></div>
        <div class="cb-filters"><span class="cb-chip on">${t('filterAll')}</span><span class="cb-chip">${star}${t('filterStarred')}</span><span class="cb-chip">${t('filterText')}</span><span class="cb-chip">${t('filterImages')}</span></div>
        <div class="cb-list">
          <div class="cb-day">${t('today')}</div>
          <div class="cb-item"><div class="cb-meta"><span class="cb-dev mac">${laptop}MacBook Air</span><span class="cb-time">${rtf.format(0, 'second')}</span></div><div class="cb-text" dir="ltr" style="text-align:${dir === 'rtl' ? 'right' : 'left'}">docs.company.com/q3-launch-final-v7</div></div>
          <div class="cb-item"><div class="cb-meta"><span class="cb-dev pc">${desktop}<span dir="auto">${t('thisDevice', { name: 'Home-PC' })}</span></span><span class="cb-time">${rtf.format(-1, 'minute')}</span></div><div class="cb-text" dir="ltr" style="text-align:${dir === 'rtl' ? 'right' : 'left'}">221B Baker Street, London</div></div>
        </div>
      </div>`;
}).join('');

const names = LANGUAGES.map(({ code, name, dir }) => `<div id="n-${code}" class="l-name display" dir="${dir}" lang="${code}">${name}</div>`).join('\n      ');

const order = LANGUAGES.map((l) => l.code);
const html = `<template>
  <link rel="stylesheet" href="assets/ui.css" />
  <style>
    @font-face { font-family: "CB Sans"; src: local("Segoe UI"); font-weight: 400; }
    @font-face { font-family: "CB Sans"; src: local("Segoe UI Semibold"); font-weight: 600; }
    @font-face { font-family: "CB Sans"; src: local("Segoe UI Bold"); font-weight: 700; }
    @font-face { font-family: "CB Mono"; src: local("Consolas"); font-weight: 400; }
    #root { position: absolute; inset: 0; overflow: hidden; background: #e9e8ef; }
    .l-pane { left: 110px; top: 175px; height: auto; padding-bottom: 6px; }
    .l-pane .cb-list { padding-bottom: 6px; }
    .l-name { position: absolute; left: 1200px; top: 470px; width: 640px; font-family: "CB Sans", sans-serif; font-size: 112px; font-weight: 700; line-height: 1.1; color: #191923; white-space: nowrap; }
    .l-name[dir="rtl"] { text-align: left; }
    #l-rule { position: absolute; left: 1200px; top: 610px; width: 120px; height: 8px; border-radius: 4px; background: #5550d8; }
  </style>

  <div id="root" data-composition-id="languages" data-width="1920" data-height="1080">${panes}
      ${names}
      <div id="l-rule"></div>
  </div>

  <script>
    const tl = gsap.timeline({ paused: true });
    // Scene time = film time - 67.6. Each language takes over on the word that names it.
    const order = ${JSON.stringify(order)};
    const at = ${JSON.stringify(at)};
    gsap.set(".l-pane", { scale: 1.68, transformOrigin: "0 0" });
    gsap.set(order.slice(1).map((c) => "#l-" + c), { opacity: 0 });
    gsap.set(order.map((c) => "#n-" + c), { opacity: 0 });
    tl.fromTo("#l-en", { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.5, ease: "expo.out" }, 0.05);
    tl.fromTo("#l-rule", { scaleX: 0, transformOrigin: "0 50%" }, { scaleX: 1, duration: 0.5, ease: "expo.out" }, 0.35);
    order.forEach((code, i) => {
      const t = at[code];
      if (i > 0) {
        const prev = order[i - 1];
        tl.to("#l-" + prev, { opacity: 0, filter: "blur(6px)", duration: 0.1 }, t - 0.04);
        tl.fromTo("#l-" + code, { opacity: 0, filter: "blur(6px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.12 }, t + 0.02);
        tl.to("#n-" + prev, { opacity: 0, y: -60, duration: 0.1, ease: "power2.in" }, t - 0.04);
      }
      tl.fromTo("#n-" + code, { opacity: 0, y: 60 }, { opacity: 1, y: 0, duration: 0.16, ease: "power3.out" }, t + 0.02);
    });
    window.__timelines["languages"] = tl;
  </script>
</template>
`;

fs.writeFileSync(path.join(here, '..', 'compositions', 'languages.html'), html);
console.log('wrote compositions/languages.html');
