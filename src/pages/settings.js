'use strict';

const SECTIONS = [
  ['general', 'General', 'house'],
  ['appearance', 'Appearance', 'palette'],
  ['newtab', 'New tab page', 'image'],
  ['search', 'Search', 'search'],
  ['performance', 'Performance', 'zap'],
  ['privacy', 'Privacy and security', 'lock'],
  ['passwords', 'Passwords', 'key-round'],
  ['downloads', 'Downloads', 'download'],
  ['extensions', 'Extensions', 'puzzle'],
  ['shortcuts', 'Keyboard shortcuts', 'keyboard'],
  ['about', 'About LionsBrows', 'info'],
];
const SECONDARY_FROM = 'extensions';
const PERMISSION_LABELS = { 'media:video': 'Camera', 'media:audio': 'Microphone', 'media:audio+video': 'Camera and microphone', geolocation: 'Location', notifications: 'Notifications' };

let S = null;

function errorText(err) {
  return String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

async function set(key, value) {
  S.settings = await api.call('setSetting', key, value);
}

function row(label, sub, control) {
  const text = (v) => (typeof v === 'string' ? tr(v) : v);
  return el('div', { class: 'row' }, el('div', { class: 'label' }, el('div', {}, text(label)), sub ? el('div', { class: 'sub' }, text(sub)) : null), control);
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
  const s = el('select', {}, ...options.map(([value, label]) => el('option', { value: String(value) }, tr(label))));
  s.value = String(S.settings[key]);
  s.addEventListener('change', () => set(key, transform(s.value)));
  return s;
}

function segmented(key, options, onChange) {
  const box = el('div', { class: 'seg' });
  for (const [value, label] of options) {
    const b = el('button', { class: S.settings[key] === value ? 'on' : '' }, tr(label));
    b.onclick = async () => {
      await set(key, value);
      box.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      onChange?.(value);
    };
    box.append(b);
  }
  return box;
}

function card(...rows) {
  return el('div', { class: 'card' }, ...rows);
}

function titleWithIcon(tag, className, text, iconName, size) {
  const h = el(tag, { class: className, html: iconName ? icon(iconName, size) : '' });
  h.append(text);
  return h;
}

function panel(title, iconName, ...items) {
  return el('div', { class: 'panel' }, title ? titleWithIcon('h3', 'panel-title', tr(title), iconName, 22) : null, ...items);
}

function section(id, sub, ...items) {
  const [, title, iconName] = SECTIONS.find(([key]) => key === id);
  const box = el('section', { class: 'settings-section', id }, titleWithIcon('h2', 'section-title', tr(title), iconName, 26), sub ? el('p', { class: 'section-sub' }, tr(sub)) : null);
  let loose = null;
  for (const item of items.filter(Boolean)) {
    if (item.classList.contains('panel')) {
      loose = null;
      box.append(item);
    } else {
      if (!loose) {
        loose = panel(null, null);
        box.append(loose);
      }
      loose.append(item);
    }
  }
  return box;
}

function languagePanel() {
  const choice = el('select', {}, el('option', { value: 'auto' }, tr('System default')), el('option', { value: 'en' }, 'English'), el('option', { value: 'de' }, 'Deutsch'));
  choice.value = S.settings.language;
  const restart = el('button', { class: 'button primary' }, tr('Restart now'));
  restart.onclick = () => api.call('relaunch');
  const note = el('div', { class: 'row restart-row' }, el('div', { class: 'label' }, el('div', {}, tr('Restart to apply')), el('div', { class: 'sub' }, tr('The new language is used after LionsBrows restarts.'))), restart);
  note.hidden = true;
  const initial = S.settings.language;
  choice.addEventListener('change', async () => {
    await set('language', choice.value);
    note.hidden = choice.value === initial;
  });
  return panel('Language', 'languages', card(row('Language', 'Used for menus, settings and built-in pages.', choice), note));
}

async function importPanel() {
  const found = await api.call('importSources');
  if (!found.length) {
    return panel('Import browser data', 'import', card(row('No other browsers found', 'Bookmarks can also be imported from an HTML file on the Bookmarks page.', el('a', { class: 'button', href: 'lions://bookmarks/' }, tr('Bookmarks')))));
  }
  const source = el('select', {}, ...found.map((s) => el('option', { value: s.id }, s.label)));
  const marks = el('input', { type: 'checkbox', checked: true });
  const history = el('input', { type: 'checkbox', checked: true });
  const go = el('button', { class: 'button primary' }, tr('Import'));
  const sync = () => (go.disabled = !marks.checked && !history.checked);
  marks.onchange = history.onchange = sync;
  go.onclick = async () => {
    go.disabled = true;
    go.textContent = tr('Importing…');
    try {
      const r = await api.call('importRun', source.value, { bookmarks: marks.checked, history: history.checked });
      const b = r.bookmarks.toLocaleString(LOCALE);
      const h = r.history.toLocaleString(LOCALE);
      if (marks.checked && history.checked) toast(tr('Imported {b} bookmarks and {h} history entries from {browser}', { b, h, browser: r.browser }));
      else if (marks.checked) toast(tr('Imported {b} bookmarks from {browser}', { b, browser: r.browser }));
      else toast(tr('Imported {h} history entries from {browser}', { h, browser: r.browser }));
    } catch (err) {
      toast(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
    go.textContent = tr('Import');
    sync();
  };
  return panel(
    'Import browser data',
    'import',
    card(
      row('Import from', 'Bring over bookmarks and the last six months of history.', source),
      row('What to import', null, el('div', { class: 'inline' }, el('label', { class: 'check' }, marks, tr('Bookmarks')), el('label', { class: 'check' }, history, tr('History')), go)),
    ),
  );
}

async function general() {
  const about = await api.call('about');
  const defaultBtn = el('button', { class: 'button' }, about.isDefault ? tr('LionsBrows is your default browser') : tr('Make default'));
  defaultBtn.disabled = about.isDefault;
  defaultBtn.onclick = async () => {
    const result = await api.call('makeDefaultBrowser');
    if (result === 'settings') toast(tr('Choose LionsBrows under “Web browser” in Windows Settings'));
    else if (result === 'ok') {
      defaultBtn.textContent = tr('LionsBrows is your default browser');
      defaultBtn.disabled = true;
    } else toast(tr('Your system did not allow the change'));
  };
  return section(
    'general',
    null,
    panel(
      'Startup',
      'rotate-cw',
      card(row('When LionsBrows starts', null, select('startup', [['restore', 'Continue where you left off'], ['newtab', 'Open a new tab']]))),
    ),
    panel('Default browser', 'globe', card(row('Open links from other apps in LionsBrows', null, defaultBtn))),
    panel('Media', 'volume-x', card(row('Block sound from playing automatically', 'Videos start with sound only after you click on the page. Applies to new tabs.', toggle('blockAutoplay')))),
    languagePanel(),
    panel('Setup assistant', 'sparkles', card(row('Run the first-start setup again', 'Permissions, privacy, import and look in a few steps.', el('a', { class: 'button', href: 'lions://welcome/' }, tr('Start setup'))))),
    await importPanel(),
  );
}

function colorPicker(value, onPick) {
  const input = el('input', { type: 'color', value, class: 'color-input' });
  input.addEventListener('change', () => onPick(input.value));
  return input;
}

function swatchRow(current, onPick) {
  const box = el('div', { class: 'swatches' });
  const mark = (target) => box.querySelectorAll('.swatch').forEach((x) => x.classList.toggle('on', x === target));
  for (const [name, color] of Object.entries(S.accents)) {
    const b = el('button', { class: `swatch${current.toLowerCase() === color ? ' on' : ''}`, title: tr(name[0].toUpperCase() + name.slice(1)), 'aria-label': tr(name[0].toUpperCase() + name.slice(1)), style: `background:${color}` });
    b.onclick = async () => {
      await onPick(color);
      mark(b);
    };
    box.append(b);
  }
  const custom = el('label', { class: `swatch custom${Object.values(S.accents).includes(current.toLowerCase()) ? '' : ' on'}`, title: tr('Custom color'), html: icon('plus', 14) });
  const input = el('input', { type: 'color', value: current });
  input.addEventListener('input', () => applyAccent(input.value));
  input.addEventListener('change', async () => {
    await onPick(input.value);
    mark(custom);
  });
  custom.append(input);
  box.append(custom);
  return box;
}

function appearance() {
  const frameAuto = el('input', { type: 'checkbox' });
  frameAuto.checked = !S.settings.frameColor;
  const framePicker = colorPicker(S.settings.frameColor || '#efeef3', (c) => set('frameColor', c).then(() => (frameAuto.checked = false)));
  framePicker.disabled = frameAuto.checked;
  frameAuto.addEventListener('change', async () => {
    framePicker.disabled = frameAuto.checked;
    await set('frameColor', frameAuto.checked ? '' : framePicker.value);
  });
  const frameControl = el('div', { class: 'inline' }, el('label', { class: 'check' }, frameAuto, tr('Automatic')), framePicker);

  return section(
    'appearance',
    null,
    panel(
      'Theme',
      'sun',
      card(
        row('Mode', 'Websites that support dark mode follow this setting.', segmented('theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']])),
        row(
          'Accent color',
          'Used for buttons, selections and focus rings.',
          swatchRow(S.settings.accent, async (c) => {
            await set('accent', c);
            applyAccent(c);
          }),
        ),
        row('Toolbar color', 'Text and icons adjust automatically.', frameControl),
      ),
    ),
    panel(
      'Layout',
      'columns-2',
      card(
        row('Tabs', null, segmented('layout', [['horizontal', 'On top'], ['vertical', 'On the side']])),
        row('Bookmarks toolbar', 'Show bookmarks below the address bar.', toggle('showBookmarksBar')),
        row('Compact sidebar', 'Only show icons when tabs are on the side.', toggle('sidebarCollapsed')),
      ),
    ),
    panel(
      'Toolbar',
      'sliders-horizontal',
      card(
        row('Split view button', 'Split view is always available from the menu and with a keyboard shortcut.', toggle('showSplitButton')),
        row('Notes button', 'Notes are always available from the menu.', toggle('showNotesButton')),
        row('Downloads button', null, segmented('downloadsButton', [['auto', 'When downloading'], ['always', 'Always']])),
      ),
    ),
  );
}

function newtabSection() {
  const bg = S.background;
  const preview = el('div', { class: 'bg-preview' });
  const paintPreview = (info) => {
    preview.textContent = '';
    preview.style.background = info.type === 'color' ? info.color : '';
    if (info.type === 'image') preview.style.background = `center / cover url("${info.url}")`;
    if (info.type === 'video') preview.append(el('video', { src: info.url, muted: true, autoplay: true, loop: true, playsinline: true }));
    if (info.type === 'default') preview.append(el('span', {}, tr('None')));
  };
  paintPreview(bg);

  const typeSeg = el('div', { class: 'seg' });
  const sliders = el('div');
  const reload = async () => {
    S = await api.call('getSettings');
    paintPreview(S.background);
    typeSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.value === S.background.type));
    sliders.hidden = !(S.background.type === 'image' || S.background.type === 'video');
  };
  const pick = (kind) => async () => {
    try {
      await api.call('chooseBackground', kind);
    } catch (err) {
      toast(errorText(err));
    }
    reload();
  };

  for (const [value, label] of [['default', 'None'], ['color', 'Color'], ['image', 'Image…'], ['video', 'Video…']]) {
    const b = el('button', { class: bg.type === value ? 'on' : '', 'data-value': value }, tr(label));
    b.onclick = async () => {
      if (value === 'image' || value === 'video') return pick(value)();
      await api.call('setSettings', { ntBackground: value });
      reload();
    };
    typeSeg.append(b);
  }
  const color = colorPicker(S.settings.ntBackgroundColor, async (c) => {
    await api.call('setSettings', { ntBackground: 'color', ntBackgroundColor: c });
    reload();
  });

  const rangeRow = (label, key, min, max, step, fmt) => {
    const input = el('input', { type: 'range', min, max, step, value: S.settings[key] });
    const out = el('output', {}, fmt(S.settings[key]));
    input.addEventListener('input', () => (out.textContent = fmt(Number(input.value))));
    input.addEventListener('change', () => set(key, Number(input.value)));
    return row(label, null, el('div', { class: 'inline' }, input, out));
  };
  sliders.append(
    rangeRow('Dim', 'ntBackgroundDim', 0, 0.9, 0.05, (v) => `${Math.round(v * 100)}%`),
    rangeRow('Blur', 'ntBackgroundBlur', 0, 40, 1, (v) => `${v}px`),
  );
  sliders.hidden = !(bg.type === 'image' || bg.type === 'video');

  const name = el('input', { type: 'text', placeholder: tr('Your name'), maxlength: '40' });
  name.value = S.settings.greetingName;
  name.addEventListener('input', debounce(() => set('greetingName', name.value.trim()), 400));

  return section(
    'newtab',
    null,
    panel(
      'Background',
      'image',
      card(
        row('Current background', 'Use a video, an image or a solid color. Videos play muted and loop.', preview),
        row('Type', null, typeSeg),
        row('Color', null, color),
        sliders,
      ),
    ),
    panel(
      'Content',
      'list',
      card(
        row('Shortcuts', 'Your most visited sites.', toggle('showTopSites')),
        row('Greeting', null, toggle('showGreeting')),
        row('Name', 'Shown in the greeting.', name),
        row('Blocked trackers count', null, toggle('showBlockedStats')),
      ),
    ),
  );
}

async function search() {
  const bangs = await api.call('bangs');
  const engineSelect = select('searchEngine', S.engines.map((e) => [e.id, e.name]));
  const customName = el('input', { type: 'text', placeholder: tr('Name'), maxlength: '40' });
  const customUrl = el('input', { type: 'text', placeholder: 'https://example.com/search?q=%s', class: 'wide' });
  customName.value = S.settings.customSearchName;
  customUrl.value = S.settings.customSearchUrl;
  const save = el('button', { class: 'button primary' }, tr('Save'));
  save.onclick = async () => {
    try {
      S.settings = await api.call('setSettings', { customSearchName: customName.value.trim(), customSearchUrl: customUrl.value.trim() });
      S = await api.call('getSettings');
      engineSelect.replaceChildren(...S.engines.map((e) => el('option', { value: e.id }, e.name)));
      engineSelect.value = S.settings.searchEngine;
      if (S.engines.some((e) => e.id === 'custom')) {
        S.settings = await api.call('setSetting', 'searchEngine', 'custom');
        engineSelect.value = 'custom';
        toast(tr('{name} is now your search engine', { name: customName.value.trim() || tr('Custom search') }));
      } else toast(tr('Custom search engine removed'));
    } catch (err) {
      toast(errorText(err));
    }
  };
  return section(
    'search',
    null,
    panel(
      'Search engine',
      'search',
      card(
        row('Default search engine', 'Used in the address bar and on the new tab page.', engineSelect),
        row('Search suggestions', 'Not used in private windows.', toggle('searchSuggestions')),
      ),
    ),
    panel(
      'Custom search engine',
      'plus',
      card(row('Add a search engine', 'Use %s where the search terms go. Leave the address empty to remove it.', null), el('div', { class: 'row form-row' }, customName, customUrl, save)),
    ),
    panel(
      'Bangs',
      'zap',
      card(
        row('Search a site directly', 'Start or end a search with a shortcut, for example “!yt music” or “weather !g”.', null),
        el('div', { class: 'bangs' }, ...bangs.map((b) => el('div', {}, el('code', {}, `!${b.key}`), b.name))),
      ),
    ),
  );
}

async function performance() {
  let report = await api.call('memoryReport');
  const saverSummary = el('div', { class: 'sub' }, report.summary);
  const restartNote = el('div', { class: 'row restart-row' }, el('div', { class: 'label' }, el('div', {}, tr('Restart to apply')), el('div', { class: 'sub' }, tr('Low-memory mode changes take effect after a restart.'))));
  const restartBtn = el('button', { class: 'button primary' }, tr('Restart now'));
  restartBtn.onclick = () => api.call('relaunch');
  restartNote.append(restartBtn);
  const updateRestart = () => {
    const mode = S.settings.lowEndMode;
    const wanted = mode === 'on' || (mode === 'auto' && report.lowEndDevice);
    restartNote.hidden = wanted === report.lowEndModeActive;
  };

  const usedValue = el('div', { class: 'mem-value' });
  const systemText = el('div', { class: 'sub' });
  const bar = el('div', { class: 'mem-bar' }, el('span'));
  const tabList = el('div', { class: 'mini-list' });
  const sleepAll = el('button', { class: 'button' }, tr('Sleep background tabs'));
  sleepAll.onclick = async () => {
    const n = await api.call('memorySleepAll');
    toast(n ? (n === 1 ? tr('1 tab put to sleep') : tr('{n} tabs put to sleep', { n })) : tr('No background tabs to put to sleep'));
    refresh();
  };

  const paint = () => {
    usedValue.textContent = formatBytes(report.total);
    const used = report.system.total - report.system.free;
    systemText.textContent = `${tr('{free} free of {total} system memory', { free: formatBytes(report.system.free), total: formatBytes(report.system.total) })}${report.lowEndModeActive ? ` · ${tr('Low-memory mode on')}` : ''}`;
    bar.firstChild.style.width = `${Math.min(100, Math.round((used / report.system.total) * 100))}%`;
    tabList.replaceChildren(
      ...report.tabs.slice(0, 30).map((t) => {
        const state = t.sleeping
          ? el('span', { class: 'pill-tag' }, tr('Sleeping'))
          : t.visible
            ? el('span', { class: 'pill-tag' }, tr('Active'))
            : el('button', { class: 'button small', onclick: async () => (await api.call('memorySleepTab', t.id), refresh()) }, tr('Sleep'));
        return el(
          'div',
          { class: 'list-item' },
          faviconEl(t.favicon),
          el('span', { class: 'host' }, t.isPrivate ? `${t.title} (${tr('private')})` : t.title),
          el('span', { class: 'mem-size' }, t.sleeping ? '—' : `${formatBytes(t.memory)}${t.shared ? '*' : ''}`),
          state,
        );
      }),
    );
  };
  const refresh = async () => {
    report = await api.call('memoryReport');
    saverSummary.textContent = report.summary;
    paint();
  };
  paint();
  updateRestart();
  setInterval(() => document.visibilityState === 'visible' && refresh(), 4000);

  return section(
    'performance',
    null,
    panel(
      'Memory saver',
      'zap',
      card(
        el(
          'div',
          { class: 'row' },
          el('div', { class: 'label' }, el('div', {}, tr('Put inactive tabs to sleep')), saverSummary),
          segmented('memorySaver', [['auto', 'Auto'], ['balanced', 'Balanced'], ['maximum', 'Maximum'], ['off', 'Off']], refresh),
        ),
        row(
          'Low-memory mode',
          'Uses Chromium’s low-end device mode and fewer processes. Auto turns it on for devices with 4 GB of RAM or less.',
          segmented('lowEndMode', [['auto', 'Auto'], ['on', 'On'], ['off', 'Off']], updateRestart),
        ),
        restartNote,
      ),
    ),
    panel(
      'Memory usage',
      'monitor',
      card(el('div', { class: 'row mem-row' }, el('div', { class: 'label' }, usedValue, el('div', { class: 'sub' }, tr('used by LionsBrows')), bar, systemText), sleepAll)),
      el('p', { class: 'group-label' }, tr('Tabs (* shares a process with other tabs from the same site)')),
      card(tabList),
    ),
  );
}

function listRow(label, buttonTitle, onRemove, ...extra) {
  return el('div', { class: 'list-item' }, el('span', { class: 'host' }, label), ...extra, el('button', { class: 'icon-btn', title: buttonTitle, 'aria-label': buttonTitle, html: icon('x', 16), onclick: onRemove }));
}

async function privacy() {
  const info = await api.call('adblockInfo');
  const since = new Date(info.since).toLocaleDateString(LOCALE);

  const refresh = el('button', { class: 'button' }, tr('Update lists'));
  refresh.onclick = async () => {
    refresh.disabled = true;
    refresh.textContent = tr('Updating…');
    await api.call('adblockRefresh');
    refresh.textContent = tr('Up to date');
  };

  const allowList = el('div', { class: 'mini-list' });
  const renderAllow = (list) => {
    allowList.textContent = '';
    if (!list.length) allowList.append(row('No exceptions', 'Turn blocking off for a site with the shield icon in the address bar.', null));
    for (const host of list) {
      allowList.append(
        listRow(host, tr('Remove exception'), async () => {
          await api.call('adblockAllowRemove', host);
          renderAllow((await api.call('adblockInfo')).allowlist);
        }),
      );
    }
  };
  renderAllow(info.allowlist);

  const perms = el('div', { class: 'mini-list' });
  const renderPerms = async () => {
    const all = await api.call('permissionsList');
    perms.textContent = '';
    const origins = Object.keys(all);
    if (!origins.length) perms.append(row('No saved permissions', 'Sites ask before using your camera, microphone, location or notifications.', null));
    for (const origin of origins) {
      const tags = Object.entries(all[origin]).map(([perm, v]) => el('span', { class: `pill-tag ${v}` }, `${tr(PERMISSION_LABELS[perm] || perm)}: ${v === 'allow' ? tr('allowed') : tr('blocked')}`));
      perms.append(
        listRow(
          origin.replace(/^https?:\/\//, ''),
          tr('Reset permissions'),
          async () => {
            await api.call('permissionsReset', origin);
            renderPerms();
          },
          ...tags,
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
  const range = el('select', {}, el('option', { value: 'hour' }, tr('Last hour')), el('option', { value: 'day' }, tr('Last 24 hours')), el('option', { value: 'week' }, tr('Last 7 days')), el('option', { value: 'month' }, tr('Last 4 weeks')), el('option', { value: 'all' }, tr('All time')));
  range.value = 'day';
  const clearBtn = el('button', { class: 'button danger' }, tr('Clear data'));
  clearBtn.onclick = async () => {
    const opts = Object.fromEntries(Object.entries(checks).map(([k, c]) => [k, c.checked]));
    if (!Object.values(opts).some(Boolean)) return toast(tr('Select at least one item'));
    clearBtn.disabled = true;
    await api.call('clearData', { ...opts, range: range.value });
    clearBtn.disabled = false;
    toast(tr('Browsing data cleared'));
  };

  return section(
    'privacy',
    null,
    panel(
      'Tracking protection',
      'shield',
      card(
        row('Block ads and trackers', tr('{n} blocked since {date}.', { n: info.blocked.toLocaleString(LOCALE), date: since }), toggle('adblock')),
        row('Hide cookie banners', 'Rejects or hides cookie pop-ups where possible.', toggle('blockCookieBanners')),
        row('Filter lists', 'EasyList, EasyPrivacy and others. Updated automatically.', refresh),
      ),
      el('p', { class: 'group-label' }, tr('Exceptions')),
      card(allowList),
    ),
    panel(
      'Security',
      'lock',
      card(
        row('Always use secure connections', 'Upgrade sites to HTTPS and fall back to HTTP only when a site does not support it.', toggle('httpsUpgrade')),
        row('Global Privacy Control', 'Tell websites not to sell or share your data.', toggle('gpc')),
      ),
    ),
    panel(
      'Cookies and site data',
      'layers',
      card(
        row('When LionsBrows closes', 'Deleting cookies and site data signs you out of websites.', segmented('cookies', [['keep', 'Keep cookies'], ['session', 'Delete cookies and site data']])),
        row('Block third-party cookies', 'Stops other sites from following you through embedded content. Some sign-ins and embedded videos may stop working.', toggle('blockThirdPartyCookies')),
      ),
    ),
    panel(
      'Site permissions',
      'globe',
      card(
        row('Camera', null, segmented('defaultCamera', [['ask', 'Ask every time'], ['block', 'Block']])),
        row('Microphone', null, segmented('defaultMicrophone', [['ask', 'Ask every time'], ['block', 'Block']])),
        row('Location', null, segmented('defaultLocation', [['ask', 'Ask every time'], ['block', 'Block']])),
        row('Notifications', null, segmented('defaultNotifications', [['ask', 'Ask every time'], ['block', 'Block']])),
      ),
      el('p', { class: 'group-label' }, tr('Saved decisions for single sites')),
      card(perms),
    ),
    panel(
      'Clear browsing data',
      'trash-2',
      card(
        el(
          'div',
          { class: 'checks' },
          el('label', {}, checks.history, tr('Browsing history')),
          el('label', {}, checks.cookies, tr('Cookies and site data')),
          el('label', {}, checks.cache, tr('Cached images and files')),
          el('label', {}, checks.downloads, tr('Download history')),
        ),
        el('div', { class: 'row' }, el('div', { class: 'label' }, tr('Time range')), range, clearBtn),
      ),
    ),
  );
}

async function passwords() {
  const list = el('div', { class: 'mini-list' });
  const neverList = el('div', { class: 'mini-list' });
  const neverPanel = panel('Never saved', 'circle-x', card(neverList));
  const note = el('div', { class: 'row' });

  const loginRow = (l) => {
    const secret = el('span', { class: 'secret' }, '••••••••');
    let shown = false;
    const reveal = el('button', { class: 'icon-btn', title: tr('Show password'), 'aria-label': tr('Show password'), html: icon('eye', 16) });
    reveal.onclick = async () => {
      shown = !shown;
      secret.textContent = shown ? await api.call('passwordReveal', l.id) : '••••••••';
      reveal.innerHTML = icon(shown ? 'eye-off' : 'eye', 16);
      reveal.title = shown ? tr('Hide password') : tr('Show password');
    };
    const copy = el('button', { class: 'icon-btn', title: tr('Copy password'), 'aria-label': tr('Copy password'), html: icon('copy', 16) });
    copy.onclick = async () => {
      await navigator.clipboard.writeText(await api.call('passwordReveal', l.id));
      toast(tr('Password copied'));
    };
    const remove = el('button', { class: 'icon-btn', title: tr('Delete'), 'aria-label': tr('Delete'), html: icon('trash-2', 16) });
    remove.onclick = async () => {
      await api.call('passwordRemove', l.id);
      render();
    };
    return el(
      'div',
      { class: 'list-item login' },
      faviconEl(`${l.origin}/favicon.ico`),
      el('span', { class: 'host' }, new URL(l.origin).host),
      el('span', { class: 'user' }, l.username || tr('(no username)')),
      secret,
      reveal,
      copy,
      remove,
    );
  };

  const render = async () => {
    const info = await api.call('passwordsInfo');
    list.replaceChildren(...(info.logins.length ? info.logins.map(loginRow) : [row('No saved passwords', 'When you sign in to a site, LionsBrows offers to save the password.', null)]));
    neverList.replaceChildren(
      ...info.never.map((origin) =>
        listRow(new URL(origin).host, tr('Remove'), async () => {
          await api.call('passwordNeverRemove', origin);
          render();
        }),
      ),
    );
    neverPanel.hidden = !info.never.length;
    note.hidden = info.available && !info.weak;
    note.replaceChildren(
      el('div', { class: 'label' }, el('div', {}, info.available ? tr('Basic protection') : tr('Passwords can’t be saved')), el('div', { class: 'sub' }, info.available ? tr('No system keyring was found, so passwords are only lightly protected on this device.') : tr('Your system doesn’t provide secure storage.'))),
    );
  };

  const importBtn = el('button', { class: 'button' }, tr('Import'));
  importBtn.title = tr('CSV export from Chrome, Edge, Firefox, Brave or Bitwarden');
  importBtn.onclick = async () => {
    try {
      const n = await api.call('passwordsImport');
      if (n !== null) toast(n === 1 ? tr('Imported 1 password') : tr('Imported {n} passwords', { n }));
      render();
    } catch (err) {
      toast(errorText(err));
    }
  };
  const exportBtn = el('button', { class: 'button' }, tr('Export'));
  exportBtn.onclick = async () => {
    if (await api.call('passwordsExport')) toast(tr('Passwords exported'));
  };

  await render();
  api.on((name) => name === 'passwords-changed' && render());

  return section(
    'passwords',
    null,
    panel(
      'Passwords',
      'key-round',
      card(
        row('Offer to save passwords', 'Not used in private windows.', toggle('offerToSavePasswords')),
        row('Fill in passwords automatically', 'When one password is saved for a site.', toggle('autofillPasswords')),
        row('Import and export', 'Import a CSV file exported from Chrome, Edge, Firefox, Brave or Bitwarden.', el('div', { class: 'inline' }, importBtn, exportBtn)),
        note,
      ),
    ),
    panel('Saved passwords', 'list', card(list)),
    neverPanel,
  );
}

function downloads() {
  const path = el('div', { class: 'path' }, S.downloadsDir);
  const change = el('button', { class: 'button' }, tr('Change'));
  change.onclick = async () => (path.textContent = await api.call('chooseDownloadsFolder'));
  return section('downloads', null, panel('Files', 'folder-open', card(row('Download folder', path, change), row('Ask where to save each file', null, toggle('askWhereToSave')))));
}

async function extensions() {
  const list = el('div', { class: 'mini-list ext-list' });
  const extRow = (x) => {
    const pic = el('span', { class: 'ext-icon' });
    if (x.icon) pic.append(el('img', { src: x.icon, alt: '' }));
    else pic.innerHTML = icon('puzzle', 18);
    const detail = x.missing ? tr('Folder missing') : x.description || (x.source === 'store' ? tr('From the Chrome Web Store') : tr('Unpacked extension'));
    const text = el('div', { class: 'ext-text' }, el('div', { class: 'ext-name' }, x.name, el('span', { class: 'ext-version' }, x.version)), el('div', { class: 'ext-sub' }, detail));
    const pinTitle = x.pinned ? tr('Unpin from toolbar') : tr('Pin to toolbar');
    const pin = x.id ? el('button', { class: `icon-btn${x.pinned ? ' on' : ''}`, title: pinTitle, 'aria-label': pinTitle, 'aria-pressed': String(x.pinned), html: icon(x.pinned ? 'pin' : 'pin-off', 16), onclick: () => api.call('extensionsPin', x.id, !x.pinned) }) : null;
    const options = x.options ? el('button', { class: 'icon-btn', title: tr('Options'), 'aria-label': tr('Options'), html: icon('settings', 16), onclick: () => api.call('extensionsOptions', x.id) }) : null;
    const remove = el('button', { class: 'icon-btn', title: tr('Remove'), 'aria-label': tr('Remove'), html: icon('trash-2', 16), onclick: () => api.call('extensionsRemove', x.key) });
    return el('div', { class: 'list-item ext' }, pic, text, options, pin, remove);
  };
  const render = async () => {
    const items = await api.call('extensionsList');
    list.replaceChildren(...(items.length ? items.map(extRow) : [row('No extensions yet', 'Find one in the Chrome Web Store and click “Add to LionsBrows”.', null)]));
  };
  await render();
  api.on((name) => name === 'extensions-changed' && render());

  const store = el('button', { class: 'button primary' }, tr('Open Chrome Web Store'));
  store.onclick = () => api.call('extensionsStore');
  const add = el('button', { class: 'button' }, tr('Load unpacked'));
  add.onclick = async () => {
    try {
      await api.call('extensionsAdd');
    } catch (err) {
      toast(tr('Couldn’t load extension: {error}', { error: errorText(err) }));
    }
  };
  return section(
    'extensions',
    'Add extensions from the Chrome Web Store. Most extensions work, but a few Chrome features are not available yet.',
    panel('Chrome Web Store', 'store', card(row('Get extensions', 'Open an extension in the store and click “Add to LionsBrows”. Extensions update automatically.', store))),
    panel('Installed', 'puzzle', card(list)),
    panel('Developers', 'code', card(row('Load unpacked', 'Load an extension folder from your computer.', add))),
  );
}

async function shortcuts() {
  const keys = await api.call('shortcuts');
  const table = el('div', { class: 'keys-table' });
  for (const k of keys) table.append(el('div', {}, k.title), el('div', { class: 'k' }, k.keys));
  return section('shortcuts', 'Press Ctrl+K (⌘K on Mac) and type “>” to find any command.', card(table));
}

const UPDATE_TEXT = {
  idle: 'Updates are checked automatically.',
  checking: 'Checking for updates…',
  current: 'LionsBrows is up to date.',
  error: 'Couldn’t check for updates. Try again later.',
  unsupported: 'Updates are only available in installed versions.',
};

function updateRow() {
  const sub = el('div', { class: 'sub' });
  const action = el('button', { class: 'button' });
  const paint = (u) => {
    if (u.status === 'downloading') sub.textContent = tr('Downloading LionsBrows {version}… {progress}%', u);
    else if (u.status === 'ready') sub.textContent = tr('LionsBrows {version} is ready to install.', u);
    else if (u.status === 'available') sub.textContent = tr('LionsBrows {version} is available.', u);
    else sub.textContent = tr(UPDATE_TEXT[u.status] || UPDATE_TEXT.idle);
    action.textContent = u.status === 'ready' ? tr('Restart to update') : u.status === 'available' ? tr('Download') : tr('Check for updates');
    action.classList.toggle('primary', u.status === 'ready' || u.status === 'available');
    action.disabled = u.status === 'checking' || u.status === 'downloading' || u.status === 'unsupported';
    action.onclick = () => (u.status === 'ready' || u.status === 'available' ? api.call('updateInstall') : api.call('updateCheck'));
  };
  api.call('updateState').then(paint);
  api.on(async (name) => name === 'update-changed' && paint(await api.call('updateState')));
  return el('div', { class: 'row' }, el('div', { class: 'label' }, el('div', {}, tr('Updates')), sub), action);
}

async function about() {
  const a = await api.call('about');
  const folder = el('button', { class: 'button' }, tr('Open profile folder'));
  folder.onclick = () => api.call('openDataFolder');
  return section(
    'about',
    null,
    card(
      el(
        'div',
        { class: 'about' },
        el('img', { src: 'lions://assets/logo.svg', alt: '' }),
        el('div', {}, el('h3', {}, `LionsBrows ${a.version}`), el('div', { class: 'versions' }, `Chromium ${a.chrome}`, el('br'), `Electron ${a.electron} · Node ${a.node}`, el('br'), a.platform)),
      ),
      updateRow(),
      row('Install updates automatically', 'Updates download in the background and install when you restart.', toggle('autoUpdate')),
      row('Source code', 'MIT license', el('a', { href: 'https://github.com/aivie373736/LionsBrows', class: 'button' }, tr('View on GitHub'))),
      row('Profile data', 'History, bookmarks and settings are stored on this device only.', folder),
    ),
  );
}

function setupSearch() {
  const input = document.getElementById('settings-search');
  const empty = document.getElementById('no-results');
  document.getElementById('search-icon').innerHTML = icon('search', 20);
  const isHidden = (node) => node.classList.contains('search-hidden');
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    const matches = (node) => !q || node.textContent.toLowerCase().includes(q);
    let any = false;
    for (const sec of document.querySelectorAll('.settings-section')) {
      const sectionHit = matches(sec.querySelector('.section-title'));
      let sectionVisible = false;
      for (const p of sec.querySelectorAll('.panel')) {
        const title = p.querySelector('.panel-title');
        const panelHit = sectionHit || Boolean(title && matches(title));
        const rows = [...p.querySelectorAll('.row, .list-item')];
        for (const r of rows) r.classList.toggle('search-hidden', !(panelHit || matches(r)));
        for (const c of p.querySelectorAll('.card')) {
          const cardRows = [...c.querySelectorAll('.row, .list-item')];
          c.classList.toggle('search-hidden', cardRows.length > 0 && cardRows.every(isHidden));
        }
        const visible = panelHit || rows.some((r) => !isHidden(r)) || (!rows.length && matches(p));
        p.classList.toggle('search-hidden', !visible);
        sectionVisible ||= visible;
      }
      sec.classList.toggle('search-hidden', !sectionVisible);
      any ||= sectionVisible;
    }
    empty.hidden = any;
    empty.textContent = tr('No settings match “{query}”.', { query: input.value.trim() });
  });
}

async function build() {
  S = await api.call('getSettings');
  applyTheme(S);
  applyAccent(S.accent);
  const nav = document.getElementById('nav');
  nav.append(el('div', { class: 'brand' }, el('img', { src: 'lions://assets/logo.svg', alt: '' }), tr('Settings')));
  for (const [id, title, ic] of SECTIONS) {
    if (id === SECONDARY_FROM) nav.append(el('div', { class: 'nav-sep' }));
    const a = el('a', { href: `#${id}`, 'data-id': id, html: icon(ic, 20) });
    a.append(el('span', {}, tr(title)));
    nav.append(a);
  }

  const parts = await Promise.all([general(), appearance(), newtabSection(), search(), performance(), privacy(), passwords(), downloads(), extensions(), shortcuts(), about()]);
  document.getElementById('sections').append(...parts);
  setupSearch();

  const links = new Map([...nav.querySelectorAll('a')].map((a) => [a.dataset.id, a]));
  const setActive = (id) => links.forEach((a, key) => a.classList.toggle('active', key === id));
  setActive(location.hash.slice(1) || SECTIONS[0][0]);
  const observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
    },
    { rootMargin: '-80px 0px -70% 0px' },
  );
  document.querySelectorAll('.settings-section').forEach((s) => observer.observe(s));
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}

build();
initPage();
