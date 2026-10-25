'use strict';

const SECTIONS = [
  ['general', 'General', 'house'],
  ['appearance', 'Appearance', 'palette'],
  ['search', 'Search', 'search'],
  ['tabs', 'Tabs & memory', 'layers'],
  ['privacy', 'Privacy & security', 'shield'],
  ['downloads', 'Downloads', 'download'],
  ['extensions', 'Extensions', 'puzzle'],
  ['shortcuts', 'Keyboard shortcuts', 'keyboard'],
  ['about', 'About LionsBrows', 'info'],
];

let S = null; // settings + metadata from the main process

async function set(key, value) {
  S.settings = await api.call('setSetting', key, value);
}

// ------------------------------------------------------------------ controls

function row(label, sub, control) {
  return el('div', { class: 'row' }, el('div', { class: 'label' }, el('div', {}, label), sub ? el('div', { class: 'sub' }, sub) : null), control);
}

function toggle(key, onChange) {
  const input = el('input', { type: 'checkbox' });
  input.checked = Boolean(S.settings[key]);
  input.addEventListener('change', async () => {
    await set(key, input.checked);
    onChange?.(input.checked);
  });
  return el('label', { class: 'switch' }, input, el('span'));
}

function select(key, options, transform = (v) => v) {
  const s = el('select', {}, ...options.map(([value, label]) => el('option', { value: String(value) }, label)));
  s.value = String(S.settings[key]);
  s.addEventListener('change', () => set(key, transform(s.value)));
  return s;
}

function segmented(key, options) {
  const box = el('div', { class: 'seg' });
  for (const [value, label] of options) {
    const b = el('button', { class: S.settings[key] === value ? 'on' : '' }, label);
    b.onclick = async () => {
      await set(key, value);
      box.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    };
    box.append(b);
  }
  return box;
}

function section(id, title, sub, ...cards) {
  return [el('h2', { class: 'section-title', id }, title), sub ? el('p', { class: 'section-sub' }, sub) : null, ...cards];
}

function card(...rows) {
  return el('div', { class: 'card' }, ...rows);
}

// ------------------------------------------------------------------ sections

async function general() {
  const about = await api.call('about');
  const defaultBtn = el('button', { class: 'button' }, about.isDefault ? 'LionsBrows is your default ✓' : 'Make default');
  defaultBtn.disabled = about.isDefault;
  defaultBtn.onclick = async () => {
    const result = await api.call('makeDefaultBrowser');
    if (result === 'settings') toast('Choose LionsBrows under “Web browser” in Windows Settings');
    else if (result === 'ok') {
      defaultBtn.textContent = 'LionsBrows is your default ✓';
      defaultBtn.disabled = true;
    } else toast('Your system did not allow the change');
  };
  const name = el('input', { type: 'text', placeholder: 'Your name', maxlength: '40' });
  name.value = S.settings.greetingName;
  name.addEventListener('input', debounce(() => set('greetingName', name.value.trim()), 400));
  return section(
    'general',
    'General',
    null,
    card(
      row('On startup', null, select('startup', [['restore', 'Continue where you left off'], ['newtab', 'Open a new tab (keep pinned tabs)']])),
      row('Default browser', 'Open links from other apps in LionsBrows.', defaultBtn),
      row('Your name', 'Used for the greeting on the new tab page.', name),
    ),
  );
}

function appearance() {
  const swatches = el('div', { class: 'swatches' });
  for (const [id, color] of Object.entries(S.accents)) {
    const b = el('button', { class: `swatch${S.settings.accent === id ? ' on' : ''}`, title: id[0].toUpperCase() + id.slice(1), style: `background:${color}` });
    b.onclick = async () => {
      await set('accent', id);
      applyAccent(color);
      swatches.querySelectorAll('.swatch').forEach((x) => x.classList.toggle('on', x === b));
    };
    swatches.append(b);
  }
  return section(
    'appearance',
    'Appearance',
    null,
    card(
      row('Theme', 'Websites that support dark mode follow this too.', segmented('theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']])),
      row('Accent color', null, swatches),
      row('Compact sidebar', 'Show only icons in the sidebar (Ctrl+B).', toggle('sidebarCollapsed')),
    ),
  );
}

async function search() {
  const bangs = await api.call('bangs');
  return section(
    'search',
    'Search',
    null,
    card(
      row('Search engine', 'Used in the command bar and on the new tab page.', select('searchEngine', S.engines.map((e) => [e.id, e.name]))),
      row('Search suggestions', 'Ask your search engine for suggestions while you type (never in private windows).', toggle('searchSuggestions')),
    ),
    card(
      row('Bangs', 'Start or end a search with a bang to search a site directly, like “!yt lofi” or “weather !g”.', null),
      el('div', { class: 'bangs' }, ...bangs.map((b) => el('div', {}, el('code', {}, `!${b.key}`), b.name))),
    ),
    card(
      row('Show most visited sites', 'On the new tab page.', toggle('showTopSites')),
      row('Show blocked ads counter', 'On the new tab page.', toggle('showBlockedStats')),
    ),
  );
}

function tabs() {
  return section(
    'tabs',
    'Tabs & memory',
    null,
    card(
      row(
        'Put background tabs to sleep',
        'Sleeping tabs free their memory and wake up instantly when you click them. Tabs playing audio never sleep.',
        select(
          'tabSleepMinutes',
          [
            [0, 'Never'],
            [5, 'After 5 minutes'],
            [15, 'After 15 minutes'],
            [30, 'After 30 minutes'],
            [60, 'After 1 hour'],
            [180, 'After 3 hours'],
          ],
          Number,
        ),
      ),
    ),
  );
}

async function privacy() {
  const info = await api.call('adblockInfo');
  const since = new Date(info.since).toLocaleDateString();

  const refresh = el('button', { class: 'button' }, 'Update filter lists');
  refresh.onclick = async () => {
    refresh.disabled = true;
    refresh.textContent = 'Updating…';
    await api.call('adblockRefresh');
    refresh.textContent = 'Up to date ✓';
  };

  const allowList = el('div', { class: 'mini-list' });
  const renderAllow = (list) => {
    allowList.textContent = '';
    if (!list.length) allowList.append(el('div', { class: 'row' }, el('div', { class: 'label sub' }, 'No exceptions. Ads are blocked everywhere.')));
    for (const host of list) {
      allowList.append(
        el(
          'div',
          { class: 'list-item' },
          el('span', { class: 'host' }, host),
          el('button', {
            class: 'icon-btn',
            title: 'Block ads here again',
            html: icon('x', 15),
            onclick: async () => {
              await api.call('adblockAllowRemove', host);
              renderAllow((await api.call('adblockInfo')).allowlist);
            },
          }),
        ),
      );
    }
  };
  renderAllow(info.allowlist);

  const perms = el('div', { class: 'mini-list' });
  const renderPerms = async () => {
    const all = await api.call('permissionsList');
    perms.textContent = '';
    const origins = Object.keys(all);
    if (!origins.length) perms.append(el('div', { class: 'row' }, el('div', { class: 'label sub' }, 'Sites will ask before using your camera, microphone, location or notifications.')));
    for (const origin of origins) {
      const tags = Object.entries(all[origin]).map(([perm, v]) => el('span', { class: `pill-tag ${v}` }, `${perm.replace('media:', '').replace('+', ' & ')}: ${v}`));
      perms.append(
        el(
          'div',
          { class: 'list-item' },
          el('span', { class: 'host' }, origin.replace(/^https?:\/\//, '')),
          ...tags,
          el('button', {
            class: 'icon-btn',
            title: 'Reset',
            html: icon('x', 15),
            onclick: async () => {
              await api.call('permissionsReset', origin);
              renderPerms();
            },
          }),
        ),
      );
    }
  };
  renderPerms();

  const checks = {
    history: el('input', { type: 'checkbox', checked: true }),
    cookies: el('input', { type: 'checkbox' }),
    cache: el('input', { type: 'checkbox', checked: true }),
    downloads: el('input', { type: 'checkbox' }),
  };
  const range = el('select', {}, el('option', { value: 'hour' }, 'Last hour'), el('option', { value: 'day' }, 'Last 24 hours'), el('option', { value: 'week' }, 'Last 7 days'), el('option', { value: 'month' }, 'Last 4 weeks'), el('option', { value: 'all' }, 'All time'));
  range.value = 'day';
  const clearBtn = el('button', { class: 'button danger', html: `${icon('trash-2', 15)}Clear data` });
  clearBtn.onclick = async () => {
    const opts = Object.fromEntries(Object.entries(checks).map(([k, c]) => [k, c.checked]));
    if (!Object.values(opts).some(Boolean)) return toast('Pick something to clear first');
    clearBtn.disabled = true;
    await api.call('clearData', { ...opts, range: range.value });
    clearBtn.disabled = false;
    toast('Done. Your browsing data is cleared.');
  };

  return section(
    'privacy',
    'Privacy & security',
    null,
    card(
      row('Block ads & trackers', `${info.blocked.toLocaleString()} blocked since ${since}. Uses EasyList, EasyPrivacy and more.`, toggle('adblock')),
      row('Filter lists', 'Lists update automatically every few days.', refresh),
    ),
    el('p', { class: 'section-sub', style: 'margin-top:16px' }, 'Sites where ads are allowed (turn it off per site with the shield in the address bar):'),
    card(allowList),
    card(
      row('Always use secure connections', 'Upgrade websites to HTTPS automatically, falling back to HTTP only if a site doesn’t support it.', toggle('httpsUpgrade')),
      row('Global Privacy Control', 'Tell websites not to sell or share your personal data.', toggle('gpc')),
    ),
    el('p', { class: 'section-sub', style: 'margin-top:16px' }, 'Site permissions:'),
    card(perms),
    el('h3', { class: 'section-title', style: 'font-size:14px;margin-top:22px' }, 'Clear browsing data'),
    card(
      el(
        'div',
        { class: 'checks' },
        el('label', {}, checks.history, 'Browsing history'),
        el('label', {}, checks.cookies, 'Cookies and site data (signs you out)'),
        el('label', {}, checks.cache, 'Cached images and files'),
        el('label', {}, checks.downloads, 'Download list'),
      ),
      el('div', { class: 'row' }, el('div', { class: 'label' }, 'Time range'), range, clearBtn),
    ),
  );
}

function downloads() {
  const path = el('div', { class: 'path' }, S.downloadsDir);
  const change = el('button', { class: 'button' }, 'Change…');
  change.onclick = async () => (path.textContent = await api.call('chooseDownloadsFolder'));
  return section(
    'downloads',
    'Downloads',
    null,
    card(row('Location', path, change), row('Ask where to save each file', null, toggle('askWhereToSave'))),
  );
}

async function extensions() {
  const list = el('div', { class: 'mini-list' });
  const render = (items) => {
    list.textContent = '';
    if (!items.length) list.append(el('div', { class: 'row' }, el('div', { class: 'label sub' }, 'No extensions loaded.')));
    for (const x of items) {
      list.append(
        el(
          'div',
          { class: 'list-item' },
          el('span', { class: 'fav', html: icon('puzzle', 16) }),
          el('span', { class: 'host' }, `${x.name} ${x.version}${x.missing ? ' (folder missing)' : ''}`),
          el('button', { class: 'icon-btn', title: 'Remove', html: icon('x', 15), onclick: async () => render(await api.call('extensionsRemove', x.dir)) }),
        ),
      );
    }
  };
  render(await api.call('extensionsList'));
  const add = el('button', { class: 'button' }, 'Load unpacked…');
  add.onclick = async () => {
    try {
      render(await api.call('extensionsAdd'));
    } catch (err) {
      toast(`Couldn’t load that folder: ${String(err.message || err).replace(/^Error invoking remote method '[^']+': /, '')}`);
    }
  };
  return section(
    'extensions',
    'Extensions',
    'Experimental. LionsBrows can load unpacked Chrome extensions (a folder with a manifest.json). Simple extensions work best; many Chrome APIs are not available.',
    card(row('Unpacked extensions', 'Applies to normal windows after a restart.', add), list),
  );
}

async function shortcuts() {
  const keys = await api.call('shortcuts');
  const table = el('div', { class: 'keys-table' });
  for (const k of keys) table.append(el('div', {}, k.title), el('div', { class: 'k' }, k.keys));
  return section('shortcuts', 'Keyboard shortcuts', 'Press Ctrl+K (⌘K on Mac) and type “>” to search every command.', card(table));
}

async function about() {
  const a = await api.call('about');
  const folder = el('button', { class: 'button' }, 'Open profile folder');
  folder.onclick = () => api.call('openDataFolder');
  return section(
    'about',
    'About LionsBrows',
    null,
    card(
      el(
        'div',
        { class: 'about' },
        el('img', { src: 'lions://assets/logo.svg', alt: '' }),
        el(
          'div',
          {},
          el('h3', {}, `LionsBrows ${a.version}`),
          el('div', { class: 'versions' }, `Chromium ${a.chrome}`, el('br'), `Electron ${a.electron} · Node ${a.node}`, el('br'), a.platform),
        ),
      ),
      row('Source code', 'Open source under the MIT license.', el('a', { href: 'https://github.com/aivie373736/LionsBrows', class: 'button' }, 'GitHub')),
      row('Your data', 'History, bookmarks and settings are stored only on this computer.', folder),
    ),
  );
}

// ------------------------------------------------------------------ page

async function build() {
  S = await api.call('getSettings');
  applyAccent(S.accent);
  const nav = document.getElementById('nav');
  nav.append(el('div', { class: 'brand' }, el('img', { src: 'lions://assets/logo.svg', alt: '' }), 'Settings'));
  for (const [id, title, ic] of SECTIONS) nav.append(el('a', { href: `#${id}`, 'data-id': id, html: `${icon(ic, 16)}<span></span>` }));
  nav.querySelectorAll('a').forEach((a, i) => (a.querySelector('span').textContent = SECTIONS[i][1]));

  const main = document.getElementById('main');
  const parts = await Promise.all([general(), appearance(), search(), tabs(), privacy(), downloads(), extensions(), shortcuts(), about()]);
  for (const p of parts) main.append(...p.filter(Boolean));

  // Highlight the section in view.
  const links = new Map([...nav.querySelectorAll('a')].map((a) => [a.dataset.id, a]));
  const observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          links.forEach((a) => a.classList.remove('active'));
          links.get(e.target.id)?.classList.add('active');
        }
      }
    },
    { rootMargin: '0px 0px -70% 0px' },
  );
  main.querySelectorAll('.section-title[id]').forEach((h) => observer.observe(h));
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}

build();
initPage(); // keeps theme and accent in sync while the page is open
