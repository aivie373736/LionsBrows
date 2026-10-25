'use strict';

const api = window.lions;

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}

function onAccent(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150 ? '#15141a' : '#ffffff';
}

function applyAccent(hex) {
  document.documentElement.style.setProperty('--accent-base', hex);
  document.documentElement.style.setProperty('--on-accent-base', onAccent(hex));
}

function applyTheme({ dark, isPrivate }) {
  document.documentElement.classList.toggle('dark', Boolean(dark));
  document.documentElement.classList.toggle('private', Boolean(isPrivate));
}

async function initPage() {
  const s = await api.call('getSettings');
  applyTheme(s);
  if (!s.isPrivate) applyAccent(s.accent);
  api.on(async (name) => {
    if (name !== 'settings-changed' && name !== 'theme-changed') return;
    const next = await api.call('getSettings');
    applyTheme(next);
    if (!next.isPrivate) applyAccent(next.accent);
  });
}

function hostOf(url) {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function faviconEl(url) {
  const box = el('span', { class: 'fav' });
  if (url) {
    const img = el('img', { src: url, alt: '', referrerpolicy: 'no-referrer' });
    img.onerror = () => (box.innerHTML = icon('globe', 16));
    box.append(img);
  } else {
    box.innerHTML = icon('globe', 16);
  }
  return box;
}

function toast(message) {
  document.querySelector('.toast')?.remove();
  const t = el('div', { class: 'toast', role: 'status' }, message);
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Today';
  if (same(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

function timeLabel(ts) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function formatBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

const LIBRARY = [
  ['history', 'History', 'history'],
  ['bookmarks', 'Bookmarks', 'bookmark'],
  ['downloads', 'Downloads', 'download'],
];

function libraryShell(active, placeholder) {
  const nav = document.getElementById('nav');
  nav.append(el('div', { class: 'brand' }, el('img', { src: 'lions://assets/logo.svg', alt: '' }), 'Library'));
  for (const [id, title, iconName] of LIBRARY) {
    const a = el('a', { href: `lions://${id}/`, class: id === active ? 'active' : null, html: icon(iconName, 20) });
    a.append(el('span', {}, title));
    nav.append(a);
  }
  nav.append(el('div', { class: 'nav-sep' }));
  const settings = el('a', { href: 'lions://settings/', html: icon('settings', 20) });
  settings.append(el('span', {}, 'Settings'));
  nav.append(settings);

  const [, title, iconName] = LIBRARY.find(([id]) => id === active);
  const heading = document.getElementById('page-title');
  heading.innerHTML = icon(iconName, 26);
  heading.append(title);
  document.getElementById('search-icon').innerHTML = icon('search', 20);
  const search = document.getElementById('page-search');
  search.placeholder = placeholder;
  return search;
}

function libraryPanel(title, ...children) {
  return el('div', { class: 'panel' }, title ? el('h3', { class: 'panel-title' }, title) : null, ...children);
}

function emptyPanel(iconName, text) {
  return libraryPanel(null, el('div', { class: 'empty-state' }, el('div', { class: 'empty-icon', html: icon(iconName, 40) }), el('div', {}, text)));
}
