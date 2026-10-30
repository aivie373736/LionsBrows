'use strict';

const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);
const isMac = window.lions.platform === 'darwin';
const cmd = (name, ...args) => window.lions.cmd(name, ...args);
const LOGO = '../shared/logo.svg';

let state = null;

document.body.classList.toggle('mac', isMac);
if (params.get('private') === '1') {
  document.documentElement.classList.add('private');
  document.body.classList.add('private');
}

$('#btn-sidebar').innerHTML = icon('panel-left');
$('#btn-back').innerHTML = icon('arrow-left');
$('#btn-forward').innerHTML = icon('arrow-right');
$('#btn-reload').innerHTML = icon('rotate-cw');
$('#btn-split').innerHTML = icon('columns-2');
$('#btn-notes').innerHTML = icon('notebook-pen');
$('#btn-downloads').innerHTML =
  icon('download') +
  '<svg class="ring" viewBox="0 0 26 26" style="display:none"><circle class="track" cx="13" cy="13" r="11"/><circle class="bar" cx="13" cy="13" r="11" stroke-dasharray="69.12" stroke-dashoffset="69.12"/></svg>';
$('#btn-menu').innerHTML = icon('ellipsis');
$('#btn-extensions').innerHTML = icon('puzzle');
$('#hnew').innerHTML = icon('plus');
$('#btn-alltabs').innerHTML = icon('chevron-down', 16);
$('#btn-settings').innerHTML = icon('settings');
$('#addr-star').innerHTML = icon('star', 16);
$('#addr-reader').innerHTML = icon('book-open', 16);
$('#addr-key').innerHTML = icon('key-round', 16);
$('#addr-translate').innerHTML = icon('languages', 16);
$('#find-prev').innerHTML = icon('chevron-down', 16, 'flip');
$('#find-prev').firstChild.style.transform = 'rotate(180deg)';
$('#find-next').innerHTML = icon('chevron-down', 16);
$('#find-close').innerHTML = icon('x', 16);
$('#panel-close').innerHTML = icon('x', 16);
$('#new-tab').innerHTML = `${icon('plus')}<span>${tr('New tab')}</span><kbd>${isMac ? '⌘T' : 'Ctrl+T'}</kbd>`;
$('#private-chip').innerHTML = `${icon('eye-off', 14)}${tr('Private')}`;

function updateWindowControls() {
  if (isMac) return;
  const wco = navigator.windowControlsOverlay;
  let width = 140;
  if (wco && wco.visible) {
    const r = wco.getTitlebarAreaRect();
    if (r.width > 0) width = Math.max(0, window.innerWidth - (r.x + r.width));
  }
  document.documentElement.style.setProperty('--wco-w', `${width}px`);
}
navigator.windowControlsOverlay?.addEventListener('geometrychange', updateWindowControls);
window.addEventListener('resize', updateWindowControls);
updateWindowControls();

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function avatar(ws, size = 22) {
  const a = el('span', 'avatar', (ws.name || '?').trim().charAt(0).toUpperCase());
  a.style.background = ws.color;
  a.style.width = a.style.height = `${size}px`;
  return a;
}

function onAccent(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150 ? '#15141a' : '#ffffff';
}

function formatBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toLocaleString(LOCALE, { maximumFractionDigits: i ? 1 : 0 })} ${units[i]}`;
}

function anchor(button, alignRight = false) {
  const r = button.getBoundingClientRect();
  return [alignRight ? r.right - 240 : r.left, r.bottom + 4];
}

function rectOf(element) {
  const r = element.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

$('#btn-sidebar').onclick = () => cmd('toggleSidebar');
$('#btn-back').onclick = () => cmd('back');
$('#btn-forward').onclick = () => cmd('forward');
$('#btn-reload').onclick = (e) => (state?.nav?.loading ? cmd('stop') : cmd('reload', e.shiftKey));
$('#btn-split').onclick = () => cmd('toggleSplit');
$('#btn-notes').onclick = () => cmd('togglePanel', 'notes');
$('#btn-downloads').onclick = () => cmd('togglePanel', 'downloads');
$('#btn-menu').onclick = (e) => cmd('mainMenu', ...anchor(e.currentTarget, true));
$('#btn-settings').onclick = () => cmd('settings');
$('#btn-extensions').onclick = (e) => cmd('extensionsMenu', rectOf(e.currentTarget));
$('#new-tab').onclick = () => cmd('newTab');
$('#hnew').onclick = () => cmd('newTab');
$('#btn-alltabs').onclick = (e) => cmd('allTabsMenu', ...anchor(e.currentTarget, true));
$('#ws-button').onclick = (e) => cmd('workspaceSwitcher', ...anchor(e.currentTarget));
function updateTabOverflow() {
  const strip = $('#htabs');
  $('#btn-alltabs').hidden = strip.scrollWidth <= strip.clientWidth + 1;
}
new ResizeObserver(updateTabOverflow).observe($('#htabs'));
new ResizeObserver(updateTabOverflow).observe($('#hlist'));

for (const bar of ['#toolbar', '#tabstrip']) {
  $(bar).addEventListener('contextmenu', (e) => {
    if (e.target.closest('#address, .tab, .pin, #ws-button')) return;
    e.preventDefault();
    cmd('toolbarMenu', e.clientX, e.clientY);
  });
}

$('#htabs').addEventListener(
  'wheel',
  (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.currentTarget.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  },
  { passive: false },
);
$('#panel-close').onclick = () => state?.panel && cmd('togglePanel', state.panel);

const address = $('#address');

let anchorKey = '';
function reportAddressAnchor() {
  const r = address.getBoundingClientRect();
  const key = `${Math.round(r.right)}|${Math.round(r.bottom)}`;
  if (key === anchorKey || !r.width) return;
  anchorKey = key;
  cmd('addressAnchor', r.right, r.bottom);
}
new ResizeObserver(reportAddressAnchor).observe(address);
window.addEventListener('resize', reportAddressAnchor);
address.onclick = () => cmd('openPalette', 'address');
address.onkeydown = (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    cmd('openPalette', 'address');
  }
};
$('#addr-shield').onclick = (e) => {
  e.stopPropagation();
  cmd('shieldMenu', ...anchor(e.currentTarget));
};
$('#addr-star').onclick = (e) => {
  e.stopPropagation();
  cmd('toggleBookmark');
};
$('#addr-key').onclick = (e) => {
  e.stopPropagation();
  const r = e.currentTarget.getBoundingClientRect();
  cmd('passwordKey', r.left, r.bottom + 4);
};
$('#addr-translate').onclick = (e) => {
  e.stopPropagation();
  cmd('translatePage');
};
$('#addr-reader').onclick = (e) => {
  e.stopPropagation();
  cmd('toggleReader');
};
$('#addr-icon').onclick = (e) => {
  if (!state?.nav?.isWeb) return;
  e.stopPropagation();
  cmd('siteInfo', rectOf(e.currentTarget));
};
$('#addr-addext').onclick = (e) => {
  e.stopPropagation();
  cmd('extensionInstall');
};
$('#addr-zoom').onclick = (e) => {
  e.stopPropagation();
  cmd('zoomReset');
};

function renderAddress(nav) {
  const ico = $('#addr-icon');
  const text = $('#addr-text');
  text.textContent = '';
  ico.className = '';
  ico.title = '';
  if (!nav || !nav.display) {
    ico.innerHTML = icon('search', 15);
    text.append(el('span', 'placeholder', tr('Search or enter address')));
  } else if (nav.internal) {
    ico.innerHTML = `<img src="${LOGO}" width="16" height="16" alt="">`;
    text.append(el('span', 'host', nav.display.replace(/\/$/, '')));
  } else {
    ico.className = nav.secure ? 'secure' : 'warn';
    ico.innerHTML = nav.secure ? icon('lock', 14) : icon('triangle-alert', 14);
    ico.title = nav.isWeb ? tr('View site information') : '';
    const slash = nav.display.indexOf('/');
    const host = slash === -1 ? nav.display : nav.display.slice(0, slash);
    const rest = slash === -1 ? '' : nav.display.slice(slash);
    if (!nav.secure && nav.isWeb) text.append(el('span', 'rest', `${tr('Not secure')}  ·  `));
    text.append(el('span', 'host', host), el('span', 'rest', rest));
  }

  const shield = $('#addr-shield');
  shield.hidden = !nav || !nav.isWeb || nav.reader;
  if (nav && nav.isWeb) {
    shield.classList.toggle('active', nav.adblockOn);
    shield.innerHTML = icon(nav.adblockOn ? 'shield-check' : 'shield-off', 15) + (nav.adblockOn && nav.blocked ? `<span class="count">${nav.blocked}</span>` : '');
    shield.title = nav.adblockOn ? tr('{n} ads & trackers blocked', { n: nav.blocked }) : tr('Ad blocker is off for this site');
  }
  const star = $('#addr-star');
  star.hidden = !nav || !nav.isWeb;
  star.classList.toggle('on', Boolean(nav && nav.bookmarked));
  star.title = nav && nav.bookmarked ? tr('Remove bookmark') : tr('Bookmark this page');
  const keyBtn = $('#addr-key');
  keyBtn.hidden = !nav || !nav.key;
  keyBtn.classList.toggle('on', Boolean(nav && nav.key === 'pending'));
  keyBtn.title = nav && nav.key === 'pending' ? tr('Save password') : tr('Passwords');
  const translateBtn = $('#addr-translate');
  translateBtn.hidden = !nav || !nav.translate;
  translateBtn.classList.toggle('on', Boolean(nav && nav.translate === 'original'));
  translateBtn.title = nav && nav.translate === 'original' ? tr('Show original') : tr('Translate this page');
  const readerBtn = $('#addr-reader');
  readerBtn.hidden = !nav || !(nav.reader || (nav.isWeb && nav.readerable));
  readerBtn.classList.toggle('on', Boolean(nav && nav.reader));
  readerBtn.title = nav && nav.reader ? tr('Close reader view') : tr('Reader view');
  const offer = nav && nav.storeOffer;
  const addExt = $('#addr-addext');
  addExt.hidden = !offer;
  addExt.disabled = Boolean(offer && offer.busy);
  const offerKey = offer ? String(offer.busy) : '';
  if (addExt.dataset.key !== offerKey) {
    addExt.dataset.key = offerKey;
    addExt.innerHTML = offer ? `${icon('puzzle', 14)}<span>${offer.busy ? tr('Adding…') : tr('Add to LionsBrows')}</span>` : '';
  }
  const zoom = $('#addr-zoom');
  zoom.hidden = !nav || nav.zoom === 100;
  if (nav) zoom.textContent = `${nav.zoom}%`;
}

let extensionsKey = '';
function renderExtensions(list) {
  const pinned = list.filter((x) => x.pinned);
  const key = JSON.stringify(pinned);
  $('#btn-extensions').hidden = !list.length;
  if (key === extensionsKey) return;
  extensionsKey = key;
  $('#ext-pinned').replaceChildren(
    ...pinned.map((x) => {
      const b = el('button', 'btn ext');
      b.title = x.title;
      b.dataset.id = x.id;
      if (x.icon) {
        const img = el('img');
        img.src = x.icon;
        img.alt = '';
        b.append(img);
      } else {
        b.innerHTML = icon('puzzle', 16);
      }
      if (x.badge) {
        const badge = el('span', 'ext-badge', x.badge);
        if (x.badgeColor) badge.style.background = x.badgeColor;
        b.append(badge);
      }
      b.onclick = () => cmd('extensionClick', x.id, rectOf(b));
      b.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        cmd('extensionMenu', x.id, e.clientX, e.clientY);
      };
      return b;
    }),
  );
}

function renderToolbar() {
  const s = state;
  const nav = s.nav;
  $('#btn-back').disabled = !nav || !nav.canGoBack;
  $('#btn-forward').disabled = !nav || !nav.canGoForward;
  const reload = $('#btn-reload');
  const loading = Boolean(nav && nav.loading);
  if (reload.dataset.loading !== String(loading)) {
    reload.dataset.loading = String(loading);
    reload.innerHTML = loading ? icon('x') : icon('rotate-cw');
    reload.title = loading ? tr('Stop') : tr('Reload');
  }
  $('#btn-split').hidden = !s.toolbar.split;
  $('#btn-notes').hidden = !s.toolbar.notes;
  $('#btn-downloads').hidden = !s.toolbar.downloads;
  $('#btn-split').classList.toggle('on', Boolean(s.split));
  $('#btn-notes').classList.toggle('on', s.panel === 'notes');
  $('#btn-downloads').classList.toggle('on', s.panel === 'downloads');
  $('#private-chip').hidden = !s.isPrivate;
  renderExtensions(s.extensions || []);
  $('#btn-menu').classList.toggle('badge', Boolean(s.update));
  $('#btn-menu').title = s.update ? (s.update.status === 'ready' ? tr('Restart to update to {version}', s.update) : tr('LionsBrows {version} is available', s.update)) : tr('Open menu');

  const dl = s.downloads;
  const btn = $('#btn-downloads');
  const ring = btn.querySelector('.ring');
  btn.classList.toggle('busy', dl.active > 0);
  ring.style.display = dl.active ? '' : 'none';
  const bar = ring.querySelector('.bar');
  bar.classList.toggle('indeterminate', dl.progress < 0);
  bar.setAttribute('stroke-dashoffset', String(69.12 * (1 - (dl.progress < 0 ? 0.25 : dl.progress))));
  btn.title = dl.active ? (dl.active === 1 ? tr('Downloading 1 file') : tr('Downloading {n} files', { n: dl.active })) : tr('Downloads');

  renderAddress(nav);
}

const findInput = $('#find-input');
let findTimer = null;
findInput.addEventListener('input', () => {
  clearTimeout(findTimer);
  findTimer = setTimeout(() => cmd('find', findInput.value), 60);
});
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    cmd('find', findInput.value, { next: true, forward: !e.shiftKey });
  } else if (e.key === 'Escape') {
    e.preventDefault();
    cmd('closeFind');
  }
});
$('#find-next').onclick = () => cmd('find', findInput.value, { next: true });
$('#find-prev').onclick = () => cmd('find', findInput.value, { next: true, forward: false });
$('#find-close').onclick = () => cmd('closeFind');
window.lions.on('ui:focus-find', () => {
  findInput.focus();
  findInput.select();
  if (findInput.value) cmd('find', findInput.value);
});

function renderFind() {
  const f = state.find;
  const bar = $('#findbar');
  bar.hidden = !f.open;
  $('#find-count').textContent = f.query ? `${f.active}/${f.matches}` : '';
  bar.classList.toggle('nomatch', Boolean(f.query) && f.matches === 0);
}

const tabEls = new Map();
let dragId = null;

function clearDropMarks() {
  document.querySelectorAll('.drop-before, .drop-after, .drop-target, .drop').forEach((e) => e.classList.remove('drop-before', 'drop-after', 'drop-target', 'drop'));
}

function sectionTabs(pinned) {
  return state.tabs.filter((t) => t.pinned === pinned && t.id !== dragId);
}

function createTabEl(id, kind) {
  const e = el('div', kind);
  e.dataset.id = id;
  e.dataset.kind = kind;
  e.draggable = true;
  e.tabIndex = 0;
  e.setAttribute('role', 'tab');
  if (kind === 'tab') {
    e.innerHTML = `<span class="fav"></span><span class="title"></span><button class="audio" hidden></button><button class="close" title="${tr('Close tab')}">${icon('x', 14)}</button>`;
  } else {
    e.innerHTML = '<span class="fav"></span>';
  }

  e.addEventListener('click', (ev) => {
    if (ev.target.closest('.close')) return cmd('close', id);
    if (ev.target.closest('.audio')) return cmd('toggleMute', id);
    cmd('activate', id);
  });
  e.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') cmd('activate', id);
    if (ev.key === 'Delete') cmd('close', id);
  });
  e.addEventListener('mousedown', (ev) => ev.button === 1 && ev.preventDefault());
  e.addEventListener('auxclick', (ev) => ev.button === 1 && cmd('close', id));
  e.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    cmd('tabMenu', id);
  });

  e.addEventListener('dragstart', (ev) => {
    dragId = id;
    ev.dataTransfer.setData('text/x-lions-tab', String(id));
    ev.dataTransfer.effectAllowed = 'move';
    requestAnimationFrame(() => document.body.classList.add('dragging'));
  });
  e.addEventListener('dragend', () => {
    dragId = null;
    document.body.classList.remove('dragging');
    clearDropMarks();
  });
  e.addEventListener('dragover', (ev) => {
    if (dragId === null || dragId === id) return;
    ev.preventDefault();
    ev.stopPropagation();
    const r = e.getBoundingClientRect();
    const sideways = kind === 'pin' || document.body.classList.contains('h');
    const after = sideways ? ev.clientX > r.left + r.width / 2 : ev.clientY > r.top + r.height / 2;
    clearDropMarks();
    e.classList.add(after ? 'drop-after' : 'drop-before');
  });
  e.addEventListener('drop', (ev) => {
    if (dragId === null || dragId === id) return;
    ev.preventDefault();
    ev.stopPropagation();
    const after = e.classList.contains('drop-after');
    clearDropMarks();
    const pinned = kind === 'pin';
    const list = sectionTabs(pinned);
    const i = list.findIndex((t) => t.id === id);
    const beforeId = after ? (list[i + 1] ? list[i + 1].id : null) : id;
    cmd('moveTab', dragId, beforeId, pinned);
  });
  return e;
}

function favicon(t) {
  if (t.loading && !t.sleeping) return '<span class="spinner"></span>';
  if (t.internal) return `<img src="${LOGO}" alt="">`;
  if (t.favicon) return `<img src="${t.favicon.replace(/"/g, '&quot;')}" alt="" referrerpolicy="no-referrer">`;
  return icon('globe', 16);
}

function updateTabEl(e, t, inSplit) {
  e.classList.toggle('active', t.id === state.activeTabId);
  e.classList.toggle('sleeping', t.sleeping);
  e.classList.toggle('audible', t.audible && !t.muted);
  e.classList.toggle('in-split', inSplit);
  e.title = t.url && !t.url.startsWith('lions://newtab') ? `${t.title}\n${t.url}` : t.title;
  e.setAttribute('aria-selected', String(t.id === state.activeTabId));

  const fav = e.querySelector('.fav');
  const favKey = `${t.loading && !t.sleeping}|${t.internal}|${t.favicon}`;
  if (fav.dataset.key !== favKey) {
    fav.dataset.key = favKey;
    fav.innerHTML = favicon(t);
    const img = fav.querySelector('img');
    if (img) img.onerror = () => (fav.innerHTML = icon('globe', 16));
  }
  const title = e.querySelector('.title');
  if (title && title.textContent !== t.title) title.textContent = t.title;
  const audio = e.querySelector('.audio');
  if (audio) {
    const show = t.audible || t.muted;
    audio.hidden = !show;
    const key = t.muted ? 'muted' : 'on';
    if (show && audio.dataset.key !== key) {
      audio.dataset.key = key;
      audio.innerHTML = icon(t.muted ? 'volume-x' : 'volume-2', 14);
      audio.title = t.muted ? tr('Unmute tab') : tr('Mute tab');
    }
  }
}

function placeAt(container, e, index) {
  if (container.children[index] !== e) container.insertBefore(e, container.children[index] || null);
}

function renderTabs() {
  const horizontal = state.layout === 'horizontal';
  const pinnedBox = horizontal ? $('#hpinned') : $('#pinned');
  const list = horizontal ? $('#hlist') : $('#tabs');
  const split = state.split ? [state.split.a, state.split.b] : [];
  const seen = new Set();
  let pi = 0;
  let ti = 0;
  for (const t of state.tabs) {
    seen.add(t.id);
    const kind = t.pinned ? 'pin' : 'tab';
    let e = tabEls.get(t.id);
    if (!e || e.dataset.kind !== kind) {
      e?.remove();
      e = createTabEl(t.id, kind);
      tabEls.set(t.id, e);
    }
    updateTabEl(e, t, split.includes(t.id));
    if (t.pinned) placeAt(pinnedBox, e, pi++);
    else placeAt(list, e, ti++);
  }
  for (const [id, e] of tabEls) {
    if (!seen.has(id)) {
      e.remove();
      tabEls.delete(id);
    }
  }
  const active = tabEls.get(state.activeTabId);
  if (active && active.dataset.scrolledFor !== String(state.activeTabId)) {
    active.dataset.scrolledFor = String(state.activeTabId);
    active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

for (const [selector, pinned] of [
  ['#pinned', true],
  ['#tabs', false],
  ['#hpinned', true],
  ['#hlist', false],
]) {
  const box = $(selector);
  box.addEventListener('dragover', (ev) => {
    if (dragId === null) return;
    ev.preventDefault();
    if (pinned) {
      clearDropMarks();
      box.classList.add('drop-target');
    }
  });
  box.addEventListener('dragleave', () => box.classList.remove('drop-target'));
  box.addEventListener('drop', (ev) => {
    if (dragId === null) return;
    ev.preventDefault();
    clearDropMarks();
    cmd('moveTab', dragId, null, pinned);
  });
}
$('#tabs').addEventListener('dblclick', (ev) => {
  if (ev.target.id === 'tabs') cmd('newTab');
});

let wsKey = '';

function renderWorkspaces() {
  const s = state;
  const key = JSON.stringify([s.workspaces, s.activeWorkspaceId, s.isPrivate, s.sidebarCollapsed]);
  if (key === wsKey) return;
  wsKey = key;
  const box = $('#workspaces');
  box.textContent = '';
  if (s.isPrivate) {
    if (!s.sidebarCollapsed) box.append(el('span', null, tr('Private window')));
    box.firstChild && (box.firstChild.id = 'ws-label');
    return;
  }
  for (const w of s.workspaces) {
    const b = el('button', `ws${w.id === s.activeWorkspaceId ? ' active' : ''}${w.isolated ? ' isolated' : ''}`);
    b.append(avatar(w));
    b.title = `${w.name} · ${w.count === 1 ? tr('1 tab') : tr('{n} tabs', { n: w.count })}${w.isolated ? ` · ${tr('separate logins')}` : ''}\n${tr('Right-click for options')}`;
    b.onclick = () => cmd('switchWorkspace', w.id);
    b.oncontextmenu = (ev) => {
      ev.preventDefault();
      const r = b.getBoundingClientRect();
      cmd('workspaceMenu', w.id, r.left, r.top - 8);
    };
    b.addEventListener('dragover', (ev) => {
      if (dragId === null || w.id === s.activeWorkspaceId) return;
      ev.preventDefault();
      clearDropMarks();
      b.classList.add('drop');
    });
    b.addEventListener('dragleave', () => b.classList.remove('drop'));
    b.addEventListener('drop', (ev) => {
      ev.preventDefault();
      clearDropMarks();
      if (dragId !== null) cmd('moveToWorkspace', dragId, w.id);
    });
    box.append(b);
  }
  const add = el('button', 'ws ws-add');
  add.innerHTML = icon('plus', 16);
  add.title = tr('New workspace');
  add.onclick = () => cmd('newWorkspace');
  box.append(add);
  if (s.workspaces.length === 1 && !s.sidebarCollapsed) {
    const label = el('span', null, s.workspaces[0].name);
    label.id = 'ws-label';
    box.insertBefore(label, add);
  }
}

function renderWorkspaceButton() {
  const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
  const btn = $('#ws-button');
  btn.hidden = state.isPrivate || state.workspaces.length < 2;
  if (!ws) return;
  btn.replaceChildren(avatar(ws, 20));
  btn.title = tr('Workspace: {name}', { name: ws.name });
}

let bookmarksKey = '';

function renderBookmarksBar() {
  const bar = $('#bookmarks-bar');
  const items = state.bookmarks;
  bar.hidden = !items;
  document.body.classList.toggle('bm', Boolean(items));
  if (!items) return;
  const key = JSON.stringify(items);
  if (key === bookmarksKey) return;
  bookmarksKey = key;
  bar.textContent = '';
  if (!items.length) {
    bar.append(el('span', 'bm-empty', tr('Bookmark pages with the star in the address bar and they show up here.')));
    return;
  }
  for (const b of items) {
    const item = el('button', 'bm');
    item.title = `${b.title}\n${b.url}`;
    const fav = el('span', 'fav');
    fav.innerHTML = b.favicon ? `<img src="${b.favicon.replace(/"/g, '&quot;')}" alt="" referrerpolicy="no-referrer">` : icon('globe', 16);
    const img = fav.querySelector('img');
    if (img) img.onerror = () => (fav.innerHTML = icon('globe', 16));
    item.append(fav, el('span', null, b.title || b.url));
    item.addEventListener('click', (ev) => cmd('openBookmark', b.url, ev.ctrlKey || ev.metaKey || ev.shiftKey));
    item.addEventListener('mousedown', (ev) => ev.button === 1 && ev.preventDefault());
    item.addEventListener('auxclick', (ev) => ev.button === 1 && cmd('openBookmark', b.url, true));
    item.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      cmd('bookmarkMenu', b.id);
    });
    bar.append(item);
  }
}

const FRAME_VARS = ['--bg', '--toolbar', '--surface', '--surface-2'];

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
}

function applyColors(s) {
  const root = document.documentElement;
  if (s.frameColor) {
    const darkFrame = luminance(s.frameColor) <= 150;
    root.classList.toggle('dark', darkFrame);
    root.style.setProperty('--bg', s.frameColor);
    root.style.setProperty('--toolbar', s.frameColor);
    root.style.setProperty('--surface', `color-mix(in srgb, ${s.frameColor} ${darkFrame ? 84 : 30}%, white)`);
    root.style.setProperty('--surface-2', `color-mix(in srgb, ${s.frameColor} ${darkFrame ? 70 : 92}%, black)`);
  } else {
    root.classList.toggle('dark', s.dark);
    for (const v of FRAME_VARS) root.style.removeProperty(v);
  }
  if (!s.isPrivate) {
    root.style.setProperty('--accent-base', s.accent);
    root.style.setProperty('--on-accent-base', onAccent(s.accent));
  }
}

const notes = $('#notes');
let notesFor = null;
let notesTimer = null;

function flushNotes() {
  if (notesTimer) {
    clearTimeout(notesTimer);
    notesTimer = null;
    cmd('setNotes', notesFor, notes.value);
  }
}
notes.addEventListener('input', () => {
  clearTimeout(notesTimer);
  notesTimer = setTimeout(() => {
    notesTimer = null;
    cmd('setNotes', notesFor, notes.value);
  }, 400);
});

async function loadNotes() {
  flushNotes();
  notesFor = state.activeWorkspaceId;
  notes.value = await cmd('getNotes');
}

const dlEls = new Map();

function renderDownloads(items) {
  const list = $('#dl-list');
  if (!items.length) {
    list.innerHTML = `<div class="empty">${tr('Files you download will show up here.')}</div>`;
    dlEls.clear();
    return;
  }
  list.querySelector('.empty')?.remove();
  const seen = new Set();
  items.forEach((d, i) => {
    seen.add(d.id);
    let e = dlEls.get(d.id);
    if (!e) {
      e = el('div', 'dl');
      e.innerHTML = `<span class="file-ico">${icon('file', 20)}</span><div class="meta"><div class="name"></div><div class="sub"></div><div class="bar"><span></span></div></div><div class="actions"></div>`;
      e.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-act]');
        cmd('download', d.id, b ? b.dataset.act : 'open');
      });
      dlEls.set(d.id, e);
    }
    const key = JSON.stringify([d.state, d.paused, d.received, d.total, d.filename]);
    if (e.dataset.key !== key) {
      e.dataset.key = key;
      e.className = `dl ${d.state}`;
      e.querySelector('.name').textContent = d.filename;
      e.title = d.path || d.url;
      let sub;
      if (d.state === 'progressing') sub = `${d.total ? tr('{done} of {total}', { done: formatBytes(d.received), total: formatBytes(d.total) }) : formatBytes(d.received)}${d.paused ? ` · ${tr('Paused')}` : ''}`;
      else if (d.state === 'completed') sub = `${formatBytes(d.total || d.received)} · ${tr('Done')}`;
      else if (d.state === 'cancelled') sub = tr('Cancelled');
      else if (d.state === 'blocked') sub = tr('Blocked: this file is known to be dangerous');
      else sub = tr('Failed');
      e.querySelector('.sub').textContent = sub;
      const bar = e.querySelector('.bar');
      bar.hidden = d.state !== 'progressing';
      bar.firstChild.style.width = d.total ? `${Math.round((d.received / d.total) * 100)}%` : '30%';
      const acts = [];
      if (d.state === 'progressing') {
        acts.push(d.paused ? ['resume', 'play', tr('Resume')] : ['pause', 'pause', tr('Pause')], ['cancel', 'x', tr('Cancel')]);
      } else if (d.state === 'completed') {
        acts.push(['show', 'folder-open', tr('Show in folder')]);
      } else {
        acts.push(['remove', 'x', tr('Remove from list')]);
      }
      e.querySelector('.actions').innerHTML = acts.map(([a, ic, title]) => `<button class="btn" data-act="${a}" title="${title}">${icon(ic, 15)}</button>`).join('');
    }
    placeAt(list, e, i);
  });
  for (const [id, e] of dlEls) {
    if (!seen.has(id)) {
      e.remove();
      dlEls.delete(id);
    }
  }
}
$('#dl-clear').onclick = () => cmd('download', null, 'clear');
$('#dl-all').onclick = () => cmd('openDownloadsPage');

function renderPanel() {
  const p = state.panel;
  $('#panel').hidden = !p;
  document.body.classList.toggle('panel-open', Boolean(p));
  $('#panel-notes').hidden = p !== 'notes';
  $('#panel-downloads').hidden = p !== 'downloads';
  if (p === 'notes') {
    const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
    $('#panel-title').textContent = ws ? `${tr('Notes')} · ${ws.name}` : tr('Notes');
    if (notesFor !== state.activeWorkspaceId) loadNotes();
  } else {
    flushNotes();
    notesFor = null;
  }
  if (p === 'downloads') {
    $('#panel-title').textContent = tr('Downloads');
    renderDownloads(state.downloadList);
  }
}

let dragRatio = null;

function renderPanes() {
  const box = $('#panes');
  const s = state;
  if (dragRatio) return;
  box.textContent = '';
  if (!s.split || s.htmlFullscreen || s.panes.length !== 2) return;
  const [a, b] = s.panes;
  for (const p of s.panes) {
    if (!p.focused) continue;
    const ring = el('div', 'pane-ring');
    Object.assign(ring.style, { left: `${p.x}px`, top: `${p.y}px`, width: `${p.width}px`, height: `${p.height}px` });
    box.append(ring);
  }
  const handle = el('div', 'pane-handle');
  const gap = b.x - (a.x + a.width);
  Object.assign(handle.style, { left: `${a.x + a.width}px`, top: `${a.y}px`, width: `${gap}px`, height: `${a.height}px` });
  handle.title = tr('Drag to resize · double-click to reset');
  handle.addEventListener('pointerdown', (ev) => {
    handle.setPointerCapture(ev.pointerId);
    handle.classList.add('dragging');
    dragRatio = { pending: null, frame: 0 };
  });
  handle.addEventListener('pointermove', (ev) => {
    if (!dragRatio) return;
    const total = a.width + b.width;
    dragRatio.pending = (ev.clientX - a.x - gap / 2) / total;
    if (!dragRatio.frame) {
      dragRatio.frame = requestAnimationFrame(() => {
        if (!dragRatio) return;
        dragRatio.frame = 0;
        cmd('setSplitRatio', dragRatio.pending);
      });
    }
  });
  const end = () => {
    if (!dragRatio) return;
    dragRatio = null;
    handle.classList.remove('dragging');
    renderPanes();
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  handle.addEventListener('dblclick', () => cmd('setSplitRatio', 0.5));
  box.append(handle);
}

function render() {
  const s = state;
  applyColors(s);
  document.body.classList.toggle('h', s.layout === 'horizontal');
  document.body.classList.toggle('v', s.layout !== 'horizontal');
  document.body.classList.toggle('collapsed', s.sidebarCollapsed);
  document.body.classList.toggle('html-fullscreen', s.htmlFullscreen);
  document.body.classList.toggle('fullscreen', s.windowFullscreen);
  renderToolbar();
  renderFind();
  renderTabs();
  updateTabOverflow();
  renderWorkspaces();
  renderWorkspaceButton();
  renderBookmarksBar();
  renderPanel();
  renderPanes();
}

window.lions.on('ui:state', (s) => {
  state = s;
  render();
});
window.addEventListener('beforeunload', flushNotes);
cmd('ready');
