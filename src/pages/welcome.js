'use strict';

const PRESETS = {
  standard: { blockThirdPartyCookies: false, defaultLocation: 'ask', defaultNotifications: 'ask', searchSuggestions: true, adblock: true, blockCookieBanners: true, httpsUpgrade: true, gpc: true },
  strict: { blockThirdPartyCookies: true, defaultLocation: 'block', defaultNotifications: 'block', searchSuggestions: false, adblock: true, blockCookieBanners: true, httpsUpgrade: true, gpc: true },
};

let S = null;
let steps = [];
let current = 0;
const refreshers = [];

async function set(patch) {
  S.settings = await api.call('setSettings', patch);
  for (const fn of refreshers) fn();
}

function row(label, sub, control) {
  return el('div', { class: 'row' }, el('div', { class: 'label' }, el('div', {}, tr(label)), sub ? el('div', { class: 'sub' }, tr(sub)) : null), control);
}

function toggle(key) {
  const input = el('input', { type: 'checkbox' });
  refreshers.push(() => (input.checked = Boolean(S.settings[key])));
  input.checked = Boolean(S.settings[key]);
  input.addEventListener('change', () => set({ [key]: input.checked }));
  return el('label', { class: 'switch' }, input, el('span'));
}

function segmented(key, options) {
  const box = el('div', { class: 'seg' });
  const paint = () => box.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.value === String(S.settings[key])));
  for (const [value, label] of options) {
    const b = el('button', { type: 'button', 'data-value': value }, tr(label));
    b.onclick = () => set({ [key]: value });
    box.append(b);
  }
  refreshers.push(paint);
  paint();
  return box;
}

function welcomeStep() {
  const choice = el('select', {}, el('option', { value: 'auto' }, tr('System default')), el('option', { value: 'en' }, 'English'), el('option', { value: 'de' }, 'Deutsch'));
  choice.value = S.settings.language;
  choice.addEventListener('change', async () => {
    await set({ language: choice.value });
    api.call('relaunch');
  });
  document.getElementById('welcome-rows').append(row('Language', 'LionsBrows restarts to switch the language.', choice));
}

function permissionsStep() {
  const options = [
    ['ask', 'Ask every time'],
    ['block', 'Block'],
  ];
  document
    .getElementById('permission-rows')
    .append(
      row('Camera', 'For video calls and photos.', segmented('defaultCamera', options)),
      row('Microphone', 'For calls and voice input.', segmented('defaultMicrophone', options)),
      row('Location', 'For maps and local results.', segmented('defaultLocation', options)),
      row('Notifications', 'Messages from websites while you browse.', segmented('defaultNotifications', options)),
    );
}

function presetOf(settings) {
  return Object.entries(PRESETS).find(([, values]) => Object.entries(values).every(([k, v]) => settings[k] === v))?.[0] || null;
}

function privacyStep() {
  const box = document.getElementById('presets');
  const cards = Object.keys(PRESETS).map((id) => {
    const card = el(
      'button',
      { type: 'button', class: 'preset', 'data-preset': id },
      el('b', { html: icon(id === 'strict' ? 'shield-check' : 'shield', 18) }, tr(id === 'strict' ? 'Strict' : 'Standard')),
      el('span', {}, tr(id === 'strict' ? 'Also blocks third-party cookies, location requests and notifications. Some sites may not work.' : 'Blocks ads and trackers. Websites work as expected.')),
    );
    card.onclick = () => set(PRESETS[id]);
    return card;
  });
  box.append(...cards);
  refreshers.push(() => {
    const active = presetOf(S.settings);
    for (const c of cards) c.classList.toggle('on', c.dataset.preset === active);
  });

  document.getElementById('privacy-rows').append(
    row(
      'Cookies and site data',
      'Deleting them when LionsBrows closes signs you out of websites.',
      segmented('cookies', [
        ['keep', 'Keep'],
        ['session', 'Delete on close'],
      ]),
    ),
    row('Block third-party cookies', 'Stops other sites from following you through embedded content.', toggle('blockThirdPartyCookies')),
    row('Block ads and trackers', null, toggle('adblock')),
    row('Hide cookie banners', 'Rejects or hides cookie pop-ups where possible.', toggle('blockCookieBanners')),
    row('Always use secure connections', 'Upgrade sites to HTTPS when possible.', toggle('httpsUpgrade')),
    row('Global Privacy Control', 'Tell websites not to sell or share your data.', toggle('gpc')),
    row('Search suggestions', 'Sends what you type in the address bar to your search engine.', toggle('searchSuggestions')),
    row('Offer to save passwords', null, toggle('offerToSavePasswords')),
    row('Block sound from playing automatically', null, toggle('blockAutoplay')),
  );
}

async function importStep() {
  const found = await api.call('importSources');
  if (!found.length) return false;
  const source = el('select', {}, ...found.map((s) => el('option', { value: s.id }, s.label)));
  const go = el('button', { class: 'button primary', type: 'button' }, tr('Import'));
  const status = el('div', { class: 'sub' }, tr('Bookmarks and history'));
  go.onclick = async () => {
    go.disabled = true;
    go.textContent = tr('Importing…');
    try {
      const r = await api.call('importRun', source.value, { bookmarks: true, history: true });
      status.textContent = tr('Imported {b} bookmarks and {h} history entries from {browser}', { b: r.bookmarks.toLocaleString(LOCALE), h: r.history.toLocaleString(LOCALE), browser: r.browser });
      go.textContent = tr('Done');
    } catch (err) {
      status.textContent = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      go.textContent = tr('Import');
      go.disabled = false;
    }
  };
  document.getElementById('import-rows').append(row('Import from', null, source), el('div', { class: 'row' }, el('div', { class: 'label' }, el('div', {}, tr('What to import')), status), go));
  return true;
}

function lookStep() {
  const engine = el('select', {}, ...S.engines.map((e) => el('option', { value: e.id }, e.name)));
  engine.value = S.settings.searchEngine;
  engine.addEventListener('change', () => set({ searchEngine: engine.value }));
  document.getElementById('look-rows').append(
    row(
      'Theme',
      null,
      segmented('theme', [
        ['system', 'System'],
        ['light', 'Light'],
        ['dark', 'Dark'],
      ]),
    ),
    row(
      'Tabs',
      null,
      segmented('layout', [
        ['horizontal', 'On top'],
        ['vertical', 'On the side'],
      ]),
    ),
    row('Search engine', null, engine),
  );
}

async function doneStep() {
  const about = await api.call('about');
  const button = el('button', { class: 'button', type: 'button' }, about.isDefault ? tr('LionsBrows is your default browser') : tr('Make default'));
  button.disabled = about.isDefault;
  button.onclick = async () => {
    const result = await api.call('makeDefaultBrowser');
    if (result === 'settings') toast(tr('Choose LionsBrows under “Web browser” in Windows Settings'));
    else if (result === 'ok') {
      button.textContent = tr('LionsBrows is your default browser');
      button.disabled = true;
    }
  };
  document.getElementById('done-rows').append(row('Default browser', 'Open links from other apps in LionsBrows.', button));
}

async function finish() {
  await api.call('setSettings', { welcomeDone: true });
  location.href = 'lions://newtab/';
}

function show(index) {
  current = Math.max(0, Math.min(steps.length - 1, index));
  for (const section of document.querySelectorAll('.step')) section.hidden = section.dataset.step !== steps[current];
  document.querySelectorAll('#dots li').forEach((dot, i) => {
    dot.classList.toggle('on', i === current);
    dot.classList.toggle('done', i < current);
  });
  const last = current === steps.length - 1;
  document.getElementById('back').hidden = current === 0;
  document.getElementById('skip').hidden = last;
  document.getElementById('next').textContent = last ? tr('Start browsing') : current === 0 ? tr('Get started') : tr('Next');
  window.scrollTo(0, 0);
}

async function build() {
  S = await api.call('getSettings');
  applyTheme(S);
  if (!S.isPrivate) applyAccent(S.accent);
  welcomeStep();
  permissionsStep();
  privacyStep();
  const hasImport = await importStep();
  lookStep();
  await doneStep();
  steps = ['welcome', 'permissions', 'privacy', ...(hasImport ? ['import'] : []), 'look', 'done'];
  document.getElementById('dots').replaceChildren(...steps.map(() => el('li')));
  for (const fn of refreshers) fn();
  document.getElementById('back').onclick = () => show(current - 1);
  document.getElementById('next').onclick = () => (current === steps.length - 1 ? finish() : show(current + 1));
  document.getElementById('skip').onclick = finish;
  show(0);
}

api.on(async (name) => {
  if (name !== 'settings-changed' && name !== 'theme-changed') return;
  S = await api.call('getSettings');
  applyTheme(S);
  if (!S.isPrivate) applyAccent(S.accent);
  for (const fn of refreshers) fn();
});

build();
