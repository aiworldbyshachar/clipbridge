'use strict';

(async function main() {
  const I18N = window.ClipBridgeI18n;
  let tr = I18N.createTranslator(new URLSearchParams(location.search).get('lang') || 'en');
  const t = (key, vars) => tr.t(key, vars);

  // Locale-aware formatters, rebuilt whenever the language changes.
  let fmt = {};
  function buildFormatters() {
    fmt = {
      rtf: new Intl.RelativeTimeFormat(tr.code, { numeric: 'auto' }),
      time: new Intl.DateTimeFormat(tr.code, { hour: '2-digit', minute: '2-digit' }),
      dateTime: new Intl.DateTimeFormat(tr.code, { dateStyle: 'medium', timeStyle: 'short' }),
      day: new Intl.DateTimeFormat(tr.code, { weekday: 'long', day: 'numeric', month: 'long' }),
      dayWithYear: new Intl.DateTimeFormat(tr.code, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    };
  }

  // Static text in the page carries data-i18n* attributes.
  function translatePage() {
    document.documentElement.lang = tr.code;
    document.documentElement.dir = tr.dir;
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of document.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
    for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
    for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
    for (const el of document.querySelectorAll('[data-i18n-title]')) {
      el.title = t(el.dataset.i18nTitle);
      el.setAttribute('aria-label', el.title);
    }
  }

  buildFormatters();
  translatePage();

  // Outside Electron (design preview in a browser) a mock API stands in.
  if (!window.api) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '../../dev/mock-api.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  const api = window.api;
  const isMac = api.platform === 'darwin';

  const PAGE = 80;
  // Other devices; this device always uses the accent color.
  const DEVICE_COLORS = ['#0e9f6e', '#d97706', '#db2777', '#0891b2', '#65a30d'];

  const ICONS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    back: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    star: '<path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>',
    trash: '<path d="M4 7h16M9 7V4.5h6V7M18 7l-.8 12.5a1.5 1.5 0 0 1-1.5 1.5H8.3a1.5 1.5 0 0 1-1.5-1.5L6 7M10 11v6M14 11v6"/>',
    laptop: '<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19.5h20"/>',
    desktop: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8.5 20h7M12 16v4"/>',
    device: '<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M11 18h2"/>',
    clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4.5V3h6v1.5M9 11h6M9 15h4"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
  };

  const svg = (name) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  // A translated sentence with one element (a <code>, a <kbd>) placed inside it.
  function tWith(key, name, node, vars) {
    const MARK = '\u0001';
    const [before, after = ''] = t(key, { ...vars, [name]: MARK }).split(MARK);
    return [before, node, after];
  }

  const $ = (sel) => document.querySelector(sel);
  for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = svg(el.dataset.icon);

  const els = {
    status: $('#status'),
    search: $('#search'),
    filters: $('#filters'),
    banners: $('#banners'),
    list: $('#list'),
    count: $('#count'),
    hint: $('#shortcut-hint'),
    sheet: $('#settings'),
    toast: $('#toast'),
  };

  const S = {
    app: null,
    q: '',
    filter: 'all',
    items: [],
    total: 0,
    sel: -1,
    expanded: new Set(),
    loadingMore: false,
  };

  // ---------- formatting ----------

  const startOfDay = (ts) => {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };

  function dayLabel(ts) {
    const diff = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / 86400000);
    if (diff === 0) return t('today');
    if (diff === 1) return t('yesterday');
    const sameYear = new Date(ts).getFullYear() === new Date().getFullYear();
    return (sameYear ? fmt.day : fmt.dayWithYear).format(ts);
  }

  function timeLabel(ts) {
    const diff = Date.now() - ts;
    if (diff < 45e3) return fmt.rtf.format(0, 'second');
    if (diff < 3600e3) return fmt.rtf.format(-Math.max(1, Math.round(diff / 60e3)), 'minute');
    return fmt.time.format(ts);
  }

  function formatBytes(n) {
    if (!n) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  function formatShortcut(acc) {
    if (!acc) return '';
    const parts = acc.replace('CommandOrControl', isMac ? 'Command' : 'Ctrl').split('+');
    if (!isMac) return parts.join('+');
    const map = { Command: '⌘', Cmd: '⌘', Ctrl: '⌃', Control: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧' };
    return parts.map((p) => map[p] || p).join('');
  }

  function hashColor(id) {
    let n = 0;
    for (const ch of id) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
    return DEVICE_COLORS[n % DEVICE_COLORS.length];
  }

  const platformIcon = (platform) => (platform === 'darwin' ? 'laptop' : platform === 'win32' ? 'desktop' : 'device');

  function deviceInfo(origin) {
    const app = S.app;
    const d = (app && app.devices[origin]) || {};
    const self = app && origin === app.self.id;
    return {
      name: d.name || t('device'),
      icon: platformIcon(d.platform),
      color: self ? 'var(--accent)' : hashColor(origin),
      self,
    };
  }

  const looksLikeCode = (text) => /[{};<>]|=>|^\s{2,}\S/m.test(text) && /\n/.test(text);

  // ---------- toast ----------

  let toastTimer;
  function toast(text) {
    els.toast.textContent = text;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 1600);
  }

  // ---------- header, filters, banners ----------

  function renderStatus() {
    const app = S.app;
    const online = app.peers.filter((p) => p.online);
    let cls = 'searching';
    let label = t('statusSearching');
    if (app.settings.paused) {
      cls = 'paused';
      label = t('statusPaused');
    } else if (online.length === 1) {
      cls = 'online';
      label = t('statusConnectedTo', { name: online[0].name });
    } else if (online.length > 1) {
      cls = 'online';
      label = t('statusConnectedMany', { n: online.length });
    }
    els.status.className = `status ${cls}`;
    els.status.querySelector('.status-label').textContent = label;
  }

  function renderFilters() {
    const app = S.app;
    const chips = [
      { key: 'all', label: t('filterAll') },
      { key: 'pinned', label: t('filterStarred'), icon: 'star' },
      { key: 'text', label: t('filterText') },
      { key: 'image', label: t('filterImages') },
    ];
    const deviceIds = Object.keys(app.devices);
    if (deviceIds.length > 1) {
      deviceIds.sort((a, b) => (a === app.self.id ? -1 : b === app.self.id ? 1 : 0));
      for (const id of deviceIds) {
        const d = deviceInfo(id);
        chips.push({ key: `device:${id}`, label: d.name, color: d.color });
      }
    }
    if (!chips.some((c) => c.key === S.filter)) S.filter = 'all';
    els.filters.replaceChildren(
      ...chips.map((c) => {
        const btn = h(
          'button',
          { class: 'chip', type: 'button', 'aria-pressed': String(S.filter === c.key), onclick: () => setFilter(c.key) },
          c.icon ? h('span', { html: svg(c.icon) }) : null,
          c.color ? h('span', { class: 'swatch' }) : null,
          c.label
        );
        if (c.color) btn.style.setProperty('--c', c.color);
        return btn;
      })
    );
  }

  function banner(kind, title, body, actions) {
    return h(
      'div',
      { class: `banner${kind ? ` ${kind}` : ''}` },
      h('div', { class: 'body' }, h('b', {}, title), h('p', {}, body), actions && actions.length ? h('div', { class: 'actions' }, actions) : null)
    );
  }

  function renderBanners() {
    const app = S.app;
    const out = [];
    if (app.listenError) {
      out.push(banner('warn', t('bannerNetworkTitle'), t('bannerNetworkBody', { error: app.listenError })));
    }
    if (app.settings.paused) {
      out.push(
        banner('warn', t('bannerPausedTitle'), t('bannerPausedBody'), [
          h('button', { class: 'btn small', type: 'button', onclick: () => updateSetting({ paused: false }) }, t('resumeSync')),
        ])
      );
    }
    const online = app.peers.filter((p) => p.online);
    if (!online.length && app.foreign.length) {
      out.push(
        banner('', t('bannerForeignTitle', { name: app.foreign[0].name }), t('bannerForeignBody'), [
          h('button', { class: 'btn small primary', type: 'button', onclick: () => openSettings('#code-input') }, t('enterCode')),
        ])
      );
    } else if (!app.peers.length && !app.foreign.length) {
      out.push(
        banner('', t('bannerAloneTitle'), tWith('bannerAloneBody', 'code', h('code', { dir: 'ltr' }, app.settings.code)), [
          h('button', { class: 'btn small', type: 'button', onclick: () => copyCode() }, t('copyCode')),
          h('button', { class: 'btn small', type: 'button', onclick: () => openSettings() }, t('settings')),
        ])
      );
    }
    els.banners.replaceChildren(...out);
  }

  function renderFooter() {
    els.count.textContent = S.q || S.filter !== 'all' ? t('results', { n: S.total }) : t('items', { n: S.total });
    const acc = S.app.settings.shortcut;
    els.hint.replaceChildren(...(acc ? tWith('quickOpen', 'shortcut', h('kbd', { dir: 'ltr' }, formatShortcut(acc))) : []));
  }

  // ---------- list ----------

  // Every reload bumps this, so a slow, older response can't overwrite a newer one.
  let listVersion = 0;

  async function loadList(keep) {
    const version = ++listVersion;
    const limit = keep ? Math.max(PAGE, S.items.length) : PAGE;
    const res = await api.list({ q: S.q, filter: S.filter, offset: 0, limit });
    if (version !== listVersion) return;
    const selectedId = S.items[S.sel] && S.items[S.sel].id;
    S.items = res.items;
    S.total = res.total;
    if (keep && selectedId) S.sel = S.items.findIndex((i) => i.id === selectedId);
    else S.sel = S.items.length ? 0 : -1;
    if (!keep) els.list.scrollTop = 0;
    renderList();
    renderFooter();
  }

  async function loadMore() {
    if (S.loadingMore || S.items.length >= S.total) return;
    S.loadingMore = true;
    const version = listVersion;
    try {
      const res = await api.list({ q: S.q, filter: S.filter, offset: S.items.length, limit: PAGE });
      if (version !== listVersion) return;
      S.items = S.items.concat(res.items);
      S.total = res.total;
      renderList();
    } finally {
      S.loadingMore = false;
    }
  }

  function renderItem(it, index) {
    const d = deviceInfo(it.origin);
    const long = it.ctype === 'text' && (it.length > it.text.length || it.text.split('\n').length > 5 || it.text.length > 360);
    const expanded = S.expanded.has(it.id);
    const classes = ['item'];
    if (index === S.sel) classes.push('selected');
    if (it.pinned) classes.push('pinned');
    if (long) classes.push('long');
    if (expanded) classes.push('expanded');

    const device = h('span', { class: 'device', html: svg(d.icon) }, h('span', { dir: 'auto' }, d.self ? t('thisDevice', { name: d.name }) : d.name));
    device.style.setProperty('--c', d.color);

    const meta = h(
      'div',
      { class: 'meta' },
      device,
      h('span', { class: 'time', title: fmt.dateTime.format(it.ts) }, timeLabel(it.ts)),
      h('span', { class: 'pin-badge', html: svg('star'), title: t('starred') }),
      h(
        'span',
        { class: 'item-actions' },
        h('button', {
          class: 'icon-btn pin',
          type: 'button',
          title: it.pinned ? t('unstar') : t('star'),
          html: svg('star'),
          onclick: (e) => {
            e.stopPropagation();
            api.pin(it.id, !it.pinned);
          },
        }),
        h('button', {
          class: 'icon-btn del',
          type: 'button',
          title: t('deleteEverywhere'),
          html: svg('trash'),
          onclick: (e) => {
            e.stopPropagation();
            removeItem(it.id);
          },
        })
      )
    );

    let body;
    if (it.ctype === 'text') {
      body = [h('div', { class: `text${looksLikeCode(it.text) ? ' mono' : ''}`, dir: 'auto' }, it.text)];
      if (long) {
        const rest = it.length - it.text.length;
        const label = expanded ? t('showLess') : t('showAll');
        body.push(
          h(
            'button',
            {
              class: 'more',
              type: 'button',
              onclick: (e) => {
                e.stopPropagation();
                if (expanded) S.expanded.delete(it.id);
                else S.expanded.add(it.id);
                renderList();
              },
            },
            expanded && rest > 0 ? `${label} · ${t('moreChars', { n: rest })}` : label
          )
        );
      }
    } else {
      body = [
        h('img', { class: 'thumb', src: it.src, alt: t('copiedImage'), loading: 'lazy', draggable: 'false' }),
        h('div', { class: 'thumb-meta', dir: 'ltr' }, [`${it.w}×${it.h}`, formatBytes(it.bytes)].filter(Boolean).join(' · ')),
      ];
    }

    return h(
      'article',
      {
        class: classes.join(' '),
        'data-id': it.id,
        onclick: () => copyItem(index),
        onmouseenter: () => {
          if (S.sel !== index) select(index, false);
        },
      },
      meta,
      body
    );
  }

  function renderList() {
    const scroll = els.list.scrollTop;
    if (!S.items.length) {
      const searching = S.q || S.filter !== 'all';
      let body;
      if (!searching) body = t('emptyHistoryBody', { keys: isMac ? '⌘C' : 'Ctrl+C' });
      else body = S.q ? t('emptyNoMatch', { q: S.q }) : t('emptyNoFilter');
      els.list.replaceChildren(
        h(
          'div',
          { class: 'empty' },
          h('div', { class: 'art', html: svg(searching ? 'search' : 'clipboard') }),
          h('b', {}, searching ? t('emptyNoResults') : t('emptyHistory')),
          h('p', {}, body)
        )
      );
      return;
    }
    const nodes = [];
    let lastDay = null;
    S.items.forEach((it, i) => {
      const day = startOfDay(it.ts);
      if (day !== lastDay) {
        nodes.push(h('div', { class: 'day' }, dayLabel(it.ts)));
        lastDay = day;
      }
      nodes.push(renderItem(it, i));
    });
    const sentinel = h('div', { class: 'sentinel' });
    nodes.push(sentinel);
    els.list.replaceChildren(...nodes);
    els.list.scrollTop = scroll;
    sentinelObserver.disconnect();
    sentinelObserver.observe(sentinel);
  }

  const sentinelObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    },
    { root: els.list, rootMargin: '400px' }
  );

  function select(index, scroll = true) {
    if (index < 0 || index >= S.items.length) return;
    S.sel = index;
    for (const el of els.list.querySelectorAll('.item.selected')) el.classList.remove('selected');
    const el = els.list.querySelector(`.item[data-id="${S.items[index].id}"]`);
    if (el) {
      el.classList.add('selected');
      if (scroll) el.scrollIntoView({ block: 'nearest' });
    }
    if (index > S.items.length - 10) loadMore();
  }

  async function copyItem(index) {
    const it = S.items[index];
    if (!it) return;
    select(index, false);
    const el = els.list.querySelector(`.item[data-id="${it.id}"]`);
    const res = await api.copy(it.id);
    if (res && res.ok) {
      if (el) {
        el.classList.remove('flash');
        void el.offsetWidth;
        el.classList.add('flash');
      }
      toast(t('toastCopied'));
    } else {
      toast(t('toastCopyFailed'));
    }
  }

  function removeItem(id) {
    const index = S.items.findIndex((i) => i.id === id);
    api.remove(id);
    if (index >= 0) {
      S.items.splice(index, 1);
      S.total = Math.max(0, S.total - 1);
      S.sel = Math.min(S.sel, S.items.length - 1);
      renderList();
      renderFooter();
    }
    toast(t('toastDeleted'));
  }

  function setFilter(key) {
    S.filter = key;
    renderFilters();
    loadList(false);
  }

  // ---------- settings ----------

  function openSettings(focusSel) {
    els.sheet.hidden = false;
    renderSettings();
    const target = focusSel ? $(focusSel) : $('#close-settings');
    if (target) setTimeout(() => target.focus(), 50);
  }

  function closeSettings() {
    els.sheet.hidden = true;
    stopRecording();
    els.search.focus();
  }

  function showMsg(sel, text, kind) {
    const el = $(sel);
    el.textContent = text;
    el.className = `msg ${kind || ''}`;
    el.hidden = !text;
  }

  const languageSelect = $('#language');
  languageSelect.replaceChildren(...I18N.LANGUAGES.map((l) => h('option', { value: l.code, lang: l.code, dir: l.dir }, l.name)));
  languageSelect.addEventListener('change', () => updateSetting({ language: languageSelect.value }));

  function renderSettings() {
    const app = S.app;
    if (!app || els.sheet.hidden) return;
    languageSelect.value = tr.code;
    $('#code').textContent = app.settings.code;
    const name = $('#device-name');
    if (document.activeElement !== name) name.value = app.settings.deviceName;
    const sc = $('#shortcut');
    if (!sc.classList.contains('recording')) sc.value = formatShortcut(app.settings.shortcut);
    for (const input of document.querySelectorAll('[data-setting]')) input.checked = !!app.settings[input.dataset.setting];
    $('#login-hint').textContent = t(isMac ? 'loginHintMac' : 'loginHintWin');
    $('#login-approval').hidden = !(app.settings.openAtLogin && app.loginStatus === 'requires-approval');
    $('#my-addr').textContent = app.addresses.length ? app.addresses.join(' · ') : t('noNetwork');
    $('#stat-count').textContent = t('currently', { items: t('items', { n: app.total }) });
    $('#version').textContent = app.version;

    const peerItems = [];
    for (const p of [...app.peers].sort((a, b) => b.online - a.online)) {
      const detail = p.online
        ? p.lastSyncAt
          ? t('peerSynced', { address: p.address, time: timeLabel(p.lastSyncAt) })
          : p.address
        : t('peerLastSeen', { time: timeLabel(p.lastSeen) });
      peerItems.push(
        h(
          'li',
          { class: 'peer' },
          h('span', { class: 'icon', html: svg(platformIcon(p.platform)) }),
          h('span', { class: 'who' }, h('b', { dir: 'auto' }, p.name), h('small', {}, detail)),
          h('span', { class: `badge ${p.online ? 'ok' : ''}` }, p.online ? t('peerOnline') : t('peerOffline'))
        )
      );
    }
    for (const f of app.foreign) {
      peerItems.push(
        h(
          'li',
          { class: 'peer' },
          h('span', { class: 'icon', html: svg(platformIcon(f.platform)) }),
          h('span', { class: 'who' }, h('b', { dir: 'auto' }, f.name), h('small', {}, t('peerForeignDetail', { address: f.address }))),
          h('span', { class: 'badge warn' }, t('peerForeignBadge'))
        )
      );
    }
    if (!peerItems.length) peerItems.push(h('li', { class: 'peer-empty' }, t('peersEmpty')));
    $('#peer-list').replaceChildren(...peerItems);

    $('#manual-list').replaceChildren(
      ...app.settings.manualPeers.map((addr) =>
        h(
          'li',
          {},
          h('span', { dir: 'ltr' }, addr),
          h('button', { class: 'icon-btn', type: 'button', title: t('remove'), html: svg('x'), onclick: () => api.removePeer(addr) })
        )
      )
    );
  }

  async function updateSetting(patch) {
    const res = await api.setSettings(patch);
    if (res && !res.ok) toast(res.error || t('toastSaveFailed'));
    return res;
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(S.app.settings.code);
      toast(t('toastCodeCopied'));
    } catch {
      toast(t('toastCantCopy'));
    }
  }

  // Two-step confirm for destructive buttons, without a modal.
  function confirmButton(btn, labelKey, confirmKey, action) {
    let timer;
    const reset = () => {
      clearTimeout(timer);
      btn.classList.remove('confirm');
      btn.textContent = t(labelKey);
    };
    btn.addEventListener('click', () => {
      if (btn.classList.contains('confirm')) {
        reset();
        action();
        return;
      }
      btn.classList.add('confirm');
      btn.textContent = t(confirmKey);
      timer = setTimeout(reset, 4000);
    });
  }

  $('#open-settings').addEventListener('click', () => openSettings());
  els.status.addEventListener('click', () => openSettings());
  $('#close-settings').addEventListener('click', closeSettings);
  $('#copy-code').addEventListener('click', copyCode);

  $('#apply-code').addEventListener('click', async () => {
    const value = $('#code-input').value.trim();
    if (!value) return showMsg('#code-msg', t('codeMissing'), 'error');
    const res = await api.setSettings({ code: value });
    if (res && res.ok) {
      $('#code-input').value = '';
      showMsg('#code-msg', t('codeUpdated'), 'ok');
    } else {
      showMsg('#code-msg', (res && res.error) || t('codeInvalid'), 'error');
    }
  });
  $('#code-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#apply-code').click();
  });

  confirmButton($('#regen-code'), 'newCode', 'regenConfirm', async () => {
    await api.regenerateCode();
    showMsg('#code-msg', t('regenDone'), 'ok');
  });

  confirmButton($('#clear-history'), 'clearHistory', 'clearConfirm', async () => {
    await api.clear();
    toast(t('toastCleared'));
  });

  $('#open-folder').addEventListener('click', () => api.openDataDir());

  $('#device-name').addEventListener('change', (e) => updateSetting({ deviceName: e.target.value }));
  $('#device-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.target.blur();
  });

  for (const input of document.querySelectorAll('[data-setting]')) {
    input.addEventListener('change', () => updateSetting({ [input.dataset.setting]: input.checked }));
  }

  $('#add-peer').addEventListener('click', async () => {
    const value = $('#peer-input').value.trim();
    if (!value) return;
    showMsg('#peer-msg', t('checking'), '');
    const res = await api.addPeer(value);
    if (!res.ok) return showMsg('#peer-msg', res.error, 'error');
    $('#peer-input').value = '';
    if (res.self) showMsg('#peer-msg', t('peerSelf'), 'error');
    else if (!res.found) showMsg('#peer-msg', t('peerNotFound'), 'error');
    else if (!res.sameCode) showMsg('#peer-msg', t('peerOtherCode', { name: res.name }), 'error');
    else showMsg('#peer-msg', t('peerConnected', { name: res.name }), 'ok');
  });
  $('#peer-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#add-peer').click();
  });

  // Shortcut recorder. Uses physical key codes so it works in any keyboard layout.
  const shortcutInput = $('#shortcut');
  function stopRecording() {
    shortcutInput.classList.remove('recording');
    if (S.app) shortcutInput.value = formatShortcut(S.app.settings.shortcut);
  }
  shortcutInput.addEventListener('focus', () => {
    shortcutInput.classList.add('recording');
    shortcutInput.value = t('shortcutRecording');
    showMsg('#shortcut-msg', '', '');
  });
  shortcutInput.addEventListener('blur', stopRecording);
  shortcutInput.addEventListener('keydown', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') return shortcutInput.blur();
    const code = e.code;
    let key = null;
    if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
    else if (/^Digit\d$/.test(code)) key = code.slice(5);
    else if (/^F\d{1,2}$/.test(code)) key = code;
    else if (code === 'Space') key = 'Space';
    else if (code === 'Backquote') key = '`';
    if (!key) return;
    const mods = [];
    if (e.ctrlKey) mods.push(isMac ? 'Control' : 'Ctrl');
    if (e.metaKey) mods.push(isMac ? 'Command' : 'Super');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (!mods.length && !/^F\d/.test(key)) {
      return showMsg('#shortcut-msg', t('shortcutNeedsModifier', { keys: isMac ? '⌘ / ⌃ / ⌥ / ⇧' : 'Ctrl / Alt / Shift' }), 'error');
    }
    const accelerator = [...mods, key].join('+');
    const res = await api.setSettings({ shortcut: accelerator });
    if (res && res.ok) {
      showMsg('#shortcut-msg', t('saved'), 'ok');
      S.app.settings.shortcut = accelerator;
    } else {
      showMsg('#shortcut-msg', (res && res.error) || t('toastSaveFailed'), 'error');
    }
    shortcutInput.blur();
  });

  // ---------- keyboard & search ----------

  let searchTimer;
  els.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      S.q = els.search.value;
      S.expanded.clear();
      loadList(false);
    }, 120);
  });

  document.addEventListener('keydown', (e) => {
    if (!els.sheet.hidden) {
      if (e.key === 'Escape') closeSettings();
      return;
    }
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (mod && (e.code === 'KeyF' || e.code === 'KeyK')) {
      e.preventDefault();
      els.search.focus();
      els.search.select();
      return;
    }
    if (mod && e.code === 'Comma') {
      e.preventDefault();
      openSettings();
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        select(Math.min(S.items.length - 1, S.sel + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        select(Math.max(0, S.sel - 1));
        break;
      case 'Enter':
        if (e.target === els.search || e.target === document.body || e.target === els.list) {
          e.preventDefault();
          copyItem(S.sel);
        }
        break;
      case 'Delete':
        if (e.target !== els.search && S.items[S.sel]) removeItem(S.items[S.sel].id);
        break;
      case 'Escape':
        if (els.search.value) {
          els.search.value = '';
          els.search.dispatchEvent(new Event('input'));
        } else {
          api.hide();
        }
        break;
      default:
        // Start typing anywhere to search.
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && document.activeElement !== els.search) {
          els.search.focus();
        }
    }
  });

  // ---------- wiring ----------

  async function refreshState() {
    S.app = await api.getState();
    const languageChanged = S.app.settings.language !== tr.code;
    if (languageChanged) {
      tr = I18N.createTranslator(S.app.settings.language);
      buildFormatters();
      translatePage();
      showMsg('#code-msg', '', '');
      showMsg('#peer-msg', '', '');
      showMsg('#shortcut-msg', '', '');
    }
    renderStatus();
    renderFilters();
    renderBanners();
    renderFooter();
    renderSettings();
    if (languageChanged) renderList();
  }

  api.on('history:changed', () => {
    refreshState().catch((err) => console.error(err));
    loadList(true).catch((err) => console.error(err));
  });
  api.on('state:changed', () => refreshState().catch((err) => console.error(err)));
  api.on('ui:focus-search', () => {
    if (els.sheet.hidden) {
      els.search.focus();
      els.search.select();
    }
  });
  api.on('ui:open-settings', () => openSettings());

  // Keep relative times fresh.
  setInterval(() => {
    if (document.hidden) return;
    for (const el of els.list.querySelectorAll('.item')) {
      const it = S.items.find((i) => i.id === el.dataset.id);
      if (it) el.querySelector('.time').textContent = timeLabel(it.ts);
    }
  }, 30000);

  await refreshState();
  await loadList(false);
  els.search.focus();
})();
