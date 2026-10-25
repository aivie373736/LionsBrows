'use strict';

const api = window.lions;
const params = new URLSearchParams(location.search);
const target = params.get('url') || '';
const root = document.documentElement;

const ALLOWED = new Set([
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'img', 'figure', 'figcaption', 'picture', 'ul', 'ol', 'li',
  'blockquote', 'pre', 'code', 'em', 'strong', 'b', 'i', 'u', 's', 'sub', 'sup', 'small', 'mark', 'table', 'thead',
  'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'dl', 'dt', 'dd', 'span', 'div', 'section', 'article', 'header',
  'footer', 'time', 'abbr', 'cite', 'q', 'del', 'ins', 'kbd', 'var', 'samp', 'details', 'summary',
]);
const DROP = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'form', 'input', 'button', 'select',
  'textarea', 'option', 'svg', 'math', 'noscript', 'template', 'link', 'meta', 'base', 'audio', 'video', 'source', 'canvas',
]);
const ATTRS = {
  a: ['href', 'title'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan', 'scope'],
  time: ['datetime'],
  abbr: ['title'],
  ol: ['start', 'reversed'],
  li: ['value'],
};
const GLOBAL_ATTRS = ['lang', 'dir'];

function safeUrl(value, image) {
  try {
    const u = new URL(value, target);
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.href;
    if (!image && u.protocol === 'mailto:') return u.href;
    if (image && /^data:image\/(png|jpe?g|gif|webp|avif);/i.test(value)) return value;
  } catch {
  }
  return null;
}

function firstSrcset(value) {
  const first = (value || '').split(',')[0]?.trim().split(/\s+/)[0];
  return first || null;
}

function clean(from, into) {
  for (const child of [...from.childNodes]) {
    if (child.nodeType === Node.TEXT_NODE) {
      into.append(child.textContent);
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const tag = child.localName;
    if (DROP.has(tag)) continue;
    if (!ALLOWED.has(tag)) {
      clean(child, into);
      continue;
    }
    const node = document.createElement(tag);
    for (const name of [...(ATTRS[tag] || []), ...GLOBAL_ATTRS]) {
      let value = child.getAttribute(name);
      if (name === 'src' && !value) value = firstSrcset(child.getAttribute('srcset'));
      if (value === null || value === undefined) continue;
      if (name === 'href' || name === 'src') {
        const url = safeUrl(value, name === 'src');
        if (url) node.setAttribute(name, url);
      } else {
        node.setAttribute(name, value);
      }
    }
    if (tag === 'img') {
      if (!node.hasAttribute('src')) continue;
      node.loading = 'lazy';
      node.decoding = 'async';
      node.referrerPolicy = 'no-referrer';
    }
    if (tag === 'a') node.rel = 'noreferrer';
    clean(child, node);
    into.append(node);
  }
}

function hostOf(url) {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

let settings = null;

function applySettings(s) {
  settings = s.settings;
  if (!s.isPrivate) root.style.setProperty('--accent-base', s.accent);
  const theme = settings.readerTheme === 'auto' ? (s.dark ? 'dark' : 'light') : settings.readerTheme;
  root.dataset.theme = theme;
  root.classList.toggle('dark', theme === 'dark');
  root.dataset.font = settings.readerFont;
  root.style.setProperty('--reader-size', `${settings.readerSize}px`);
  document.querySelectorAll('[data-font]').forEach((b) => b.classList.toggle('on', b.dataset.font === settings.readerFont));
  document.querySelectorAll('[data-theme]').forEach((b) => b.classList.toggle('on', b.dataset.theme === settings.readerTheme));
}

async function change(patch) {
  await api.call('setSettings', patch);
  applySettings(await api.call('getSettings'));
}

document.getElementById('smaller').innerHTML = icon('minus', 16);
document.getElementById('bigger').innerHTML = icon('plus', 16);
document.getElementById('smaller').onclick = () => change({ readerSize: Math.max(14, settings.readerSize - 2) });
document.getElementById('bigger').onclick = () => change({ readerSize: Math.min(32, settings.readerSize + 2) });
document.querySelectorAll('[data-font]').forEach((b) => (b.onclick = () => change({ readerFont: b.dataset.font })));
document.querySelectorAll('[data-theme]').forEach((b) => (b.onclick = () => change({ readerTheme: b.dataset.theme })));

api.on(async (name) => {
  if (name === 'settings-changed' || name === 'theme-changed') applySettings(await api.call('getSettings'));
});

async function load() {
  applySettings(await api.call('getSettings'));
  const article = await api.call('readerArticle', params.get('id'));
  if (!article) {
    if (safeUrl(target, false)?.startsWith('http')) location.replace(target);
    else document.getElementById('missing').hidden = false;
    return;
  }
  document.title = article.title || hostOf(article.url);
  if (article.lang) root.lang = article.lang;
  if (article.dir) root.dir = article.dir;
  if (/^https?:/i.test(article.favicon || '')) {
    const link = document.createElement('link');
    link.rel = 'icon';
    link.href = article.favicon;
    document.head.append(link);
  }
  const site = document.getElementById('site');
  site.textContent = article.siteName || hostOf(article.url);
  site.href = safeUrl(article.url, false) || '#';
  document.getElementById('title').textContent = article.title || '';
  const minutes = Math.max(1, Math.round((article.length || 0) / 1200));
  document.getElementById('meta').textContent = [article.byline, tr('{n} min read', { n: minutes })].filter(Boolean).join(' · ');
  const parsed = new DOMParser().parseFromString(article.content, 'text/html');
  const content = document.getElementById('content');
  clean(parsed.body, content);
  const firstHeading = content.querySelector('h1');
  if (firstHeading && firstHeading.textContent.trim() === (article.title || '').trim()) firstHeading.remove();
  document.getElementById('article').hidden = false;
}

load();
