'use strict';

const LETTER_ENGINES = { bing: ['b', '#0c8484'], yahoo: ['Y!', '#6001d2'] };

const $ = (id) => document.getElementById(id);
let data = null;
let mediaKey = '';

function errorText(err) {
  return String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

function engineLogo(id, name) {
  const box = el('span', { class: 'engine-logo' });
  const brand = window.ENGINE_ICONS[id];
  if (brand) {
    box.innerHTML = `<svg viewBox="0 0 24 24" fill="${brand.color}" aria-hidden="true"><path d="${brand.path}"/></svg>`;
  } else {
    const [letter, color] = LETTER_ENGINES[id] || [(name || '?').charAt(0).toUpperCase(), 'var(--text-3)'];
    box.textContent = letter;
    box.style.background = color;
  }
  return box;
}

function currentEngine() {
  return data.engines.find((e) => e.id === data.settings.searchEngine) || data.engines[0];
}

function renderEngineButton() {
  const engine = currentEngine();
  const btn = $('engine-btn');
  btn.replaceChildren(engineLogo(engine.id, engine.name), el('span', { html: icon('chevron-down', 14) }));
  btn.title = tr('Search engine: {name}', { name: engine.name });
  $('search').placeholder = tr('Search {name} or type a URL', { name: engine.name });
}

function closeEngineMenu() {
  $('engine-menu').hidden = true;
  $('engine-btn').setAttribute('aria-expanded', 'false');
}

function openEngineMenu() {
  const menu = $('engine-menu');
  menu.textContent = '';
  for (const engine of data.engines) {
    const selected = engine.id === data.settings.searchEngine;
    const item = el(
      'button',
      { type: 'button', class: 'engine-item', role: 'option', 'aria-selected': String(selected) },
      engineLogo(engine.id, engine.name),
      el('span', { class: 'name' }, engine.name),
      selected ? el('span', { class: 'check', html: icon('check', 16) }) : null,
    );
    item.onclick = async () => {
      data.settings = await api.call('setSetting', 'searchEngine', engine.id);
      closeEngineMenu();
      renderEngineButton();
      $('search').focus();
    };
    menu.append(item);
  }
  menu.append(el('div', { class: 'engine-sep' }));
  const manage = el('button', { type: 'button', class: 'engine-item engine-manage' }, el('span', { class: 'name' }, tr('Manage search engines')));
  manage.onclick = () => (location.href = 'lions://settings/#search');
  menu.append(manage);
  menu.hidden = false;
  $('engine-btn').setAttribute('aria-expanded', 'true');
  menu.querySelector('[aria-selected="true"]')?.focus();
}

$('engine-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  if ($('engine-menu').hidden) openEngineMenu();
  else closeEngineMenu();
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#engine-menu')) closeEngineMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  closeEngineMenu();
  $('customize').hidden = true;
});

function greeting(name) {
  const h = new Date().getHours();
  const part = h < 12 ? tr('Good morning') : h < 18 ? tr('Good afternoon') : tr('Good evening');
  return name ? `${part}, ${name}` : part;
}

function siteName(site) {
  const host = hostOf(site.url);
  const label = host.split('.').slice(-2, -1)[0] || host;
  const parts = (site.title || '').split(/\s[·|–—-]\s/).map((x) => x.trim()).filter(Boolean);
  const match = parts.find((x) => x.toLowerCase().replace(/[^a-z0-9]/g, '') === label.toLowerCase());
  return match || parts[0] || label.charAt(0).toUpperCase() + label.slice(1);
}

function siteTile(site) {
  const host = hostOf(site.url);
  const name = siteName(site);
  const tile = el('span', { class: 'tile' }, name.charAt(0).toUpperCase());
  if (site.favicon) {
    const img = el('img', { src: site.favicon, alt: '', referrerpolicy: 'no-referrer' });
    img.onload = () => tile.replaceChildren(img);
  }
  const remove = el('button', {
    class: 'remove',
    title: tr('Remove'),
    'aria-label': tr('Remove'),
    html: icon('x', 14),
    onclick: async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await api.call('removeTopSite', site.url);
      render();
    },
  });
  return el('a', { class: 'site', href: site.url, title: `${site.title || host}\n${site.url}` }, tile, el('span', { class: 'name' }, name), remove);
}

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
}

function applyBackground(bg, isPrivate) {
  const box = $('bg');
  const type = isPrivate ? 'default' : bg.type;
  const key = `${type}|${bg.url}|${bg.color}`;
  if (key !== mediaKey) {
    mediaKey = key;
    box.textContent = '';
    box.style.background = type === 'color' ? bg.color : '';
    if (type === 'image') {
      box.append(el('div', { class: 'media', style: `background-image:url("${bg.url}")` }));
    } else if (type === 'video') {
      const video = el('video', { class: 'media', src: bg.url, autoplay: true, loop: true, playsinline: true });
      video.muted = true;
      video.play().catch(() => {});
      box.append(video);
    }
    if (type === 'image' || type === 'video') box.append(el('div', { class: 'dim' }));
  }
  const media = box.querySelector('.media');
  if (media) {
    media.style.filter = bg.blur ? `blur(${bg.blur}px)` : '';
    media.style.transform = bg.blur ? 'scale(1.06)' : '';
  }
  const dim = box.querySelector('.dim');
  if (dim) dim.style.background = `rgba(0, 0, 0, ${bg.dim})`;
  const darkColor = type === 'color' && luminance(bg.color) < 150;
  document.body.classList.toggle('on-media', type === 'image' || type === 'video' || darkColor);
  document.body.classList.toggle('on-light', type === 'color' && !darkColor);
}

async function render() {
  data = await api.call('getNewTabData');
  const s = data.settings;
  applyTheme(data);
  if (!data.isPrivate) applyAccent(data.accent);
  applyBackground(data.background, data.isPrivate);
  $('customize-btn').hidden = data.isPrivate;

  const greet = $('greeting');
  greet.hidden = !data.isPrivate && !s.showGreeting;
  greet.textContent = data.isPrivate ? tr('Private browsing') : greeting(s.greetingName);
  $('private-note').hidden = !data.isPrivate;
  $('private-note').textContent = tr('LionsBrows won’t keep your history, cookies or site data from this window after you close it. Downloads and bookmarks are kept.');
  renderEngineButton();

  $('sites').replaceChildren(...data.topSites.map(siteTile));

  const stats = $('stats');
  stats.textContent = '';
  if (s.showBlockedStats && s.adblock && !data.isPrivate && data.blocked > 0) {
    stats.innerHTML = `${icon('shield-check', 14)}<span>${tr('{n} trackers and ads blocked', { n: data.blocked.toLocaleString(LOCALE) })}</span>`;
  }
  if (!$('customize').hidden) renderCustomize();
}

async function update(patch) {
  data.settings = await api.call('setSettings', patch);
  await render();
}

function toggleRow(label, key) {
  const input = el('input', { type: 'checkbox' });
  input.checked = Boolean(data.settings[key]);
  input.addEventListener('change', () => update({ [key]: input.checked }));
  return el('div', { class: 'cz-toggle' }, el('span', {}, tr(label)), el('label', { class: 'switch' }, input, el('span')));
}

function slider(label, key, min, max, step, format) {
  const input = el('input', { type: 'range', min, max, step, value: data.settings[key] });
  const out = el('output', {}, format(data.settings[key]));
  input.addEventListener('input', () => {
    out.textContent = format(Number(input.value));
    applyBackground({ ...data.background, [key === 'ntBackgroundDim' ? 'dim' : 'blur']: Number(input.value) }, false);
  });
  input.addEventListener('change', () => update({ [key]: Number(input.value) }));
  return el('div', { class: 'slider-row' }, el('label', {}, label), input, out);
}

function renderCustomize() {
  const s = data.settings;
  const bg = data.background;
  const body = $('customize-body');
  body.textContent = '';

  const option = (type, label, iconName, onClick, extra) => {
    const b = el('button', { type: 'button', class: `bg-option${bg.type === type ? ' on' : ''}`, html: icon(iconName, 18) }, label, extra || null);
    if (onClick) b.addEventListener('click', onClick);
    return b;
  };
  const colorInput = el('input', { type: 'color', value: s.ntBackgroundColor, title: tr('Choose a color') });
  colorInput.addEventListener('input', () => applyBackground({ ...bg, type: 'color', color: colorInput.value }, false));
  colorInput.addEventListener('change', () => update({ ntBackground: 'color', ntBackgroundColor: colorInput.value }));
  const choose = (kind) => async () => {
    try {
      await api.call('chooseBackground', kind);
      await render();
    } catch (err) {
      toast(errorText(err));
    }
  };

  body.append(
    el('div', { class: 'cz-title' }, tr('Background')),
    el(
      'div',
      { class: 'bg-options' },
      option('default', tr('None'), 'circle-x', () => update({ ntBackground: 'default' })),
      option('color', tr('Color'), 'palette', null, colorInput),
      option('image', tr('Image'), 'image', choose('image')),
      option('video', tr('Video'), 'film', choose('video')),
    ),
  );
  if (bg.type === 'image' || bg.type === 'video') {
    body.append(
      el('div', { class: 'bg-file' }, bg.type === 'video' ? tr('A copy of your video is stored in your LionsBrows profile.') : tr('A copy of your image is stored in your LionsBrows profile.')),
      slider(tr('Dim'), 'ntBackgroundDim', 0, 0.9, 0.05, (v) => `${Math.round(v * 100)}%`),
      slider(tr('Blur'), 'ntBackgroundBlur', 0, 40, 1, (v) => `${v}px`),
    );
  }

  const swatches = el('div', { class: 'cz-swatches' });
  for (const [name, color] of Object.entries(data.accents)) {
    const on = s.accent.toLowerCase() === color;
    const b = el('button', { type: 'button', class: `cz-swatch${on ? ' on' : ''}`, title: tr(name[0].toUpperCase() + name.slice(1)), 'aria-label': tr(name[0].toUpperCase() + name.slice(1)), style: `background:${color}` });
    b.addEventListener('click', () => update({ accent: color }));
    swatches.append(b);
  }
  const customAccent = el('input', { type: 'color', value: s.accent, title: tr('Custom color') });
  customAccent.addEventListener('input', () => applyAccent(customAccent.value));
  customAccent.addEventListener('change', () => update({ accent: customAccent.value }));
  const isCustom = !Object.values(data.accents).includes(s.accent.toLowerCase());
  const custom = el('label', { class: `cz-swatch custom${isCustom ? ' on' : ''}`, title: tr('Custom color'), html: icon('plus', 14) });
  custom.append(customAccent);
  swatches.append(custom);

  body.append(
    el('div', { class: 'cz-title' }, tr('Accent color')),
    swatches,
    el('div', { class: 'cz-title' }, tr('Show')),
    toggleRow('Shortcuts', 'showTopSites'),
    toggleRow('Greeting', 'showGreeting'),
    toggleRow('Blocked trackers count', 'showBlockedStats'),
    el('a', { class: 'cz-link', href: 'lions://settings/#appearance' }, tr('All appearance settings')),
  );
}

$('customize-btn').innerHTML = icon('sliders-horizontal', 18);
$('customize-btn').onclick = () => {
  $('customize').hidden = false;
  renderCustomize();
};
$('customize-close').innerHTML = icon('x', 18);
$('customize-close').onclick = () => ($('customize').hidden = true);
$('go').innerHTML = icon('search', 18);

document.addEventListener('visibilitychange', () => {
  const video = document.querySelector('#bg video');
  if (!video) return;
  if (document.hidden) video.pause();
  else video.play().catch(() => {});
});

$('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('search').value.trim();
  if (q) api.call('navigate', q);
});

api.on((name) => {
  if (name === 'settings-changed' || name === 'theme-changed') render();
});
render().then(() => $('search').focus());
