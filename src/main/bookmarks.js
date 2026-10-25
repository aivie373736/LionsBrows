'use strict';

const crypto = require('node:crypto');
const { ctx } = require('./context');

function all() {
  return ctx.bookmarks.get('items');
}

function has(url) {
  return Boolean(url) && all().some((b) => b.url === url);
}

function changed() {
  ctx.events.emit('bookmarks-changed');
}

function add({ url, title = '', favicon = '', folder = '' }) {
  if (!url || has(url)) return null;
  const item = { id: crypto.randomUUID(), url, title: title || url, favicon, folder, created: Date.now() };
  ctx.bookmarks.update((d) => d.items.unshift(item));
  changed();
  return item;
}

function remove(idOrUrl) {
  ctx.bookmarks.update((d) => (d.items = d.items.filter((b) => b.id !== idOrUrl && b.url !== idOrUrl)));
  changed();
}

function update(id, patch) {
  const allowed = ['title', 'url', 'folder'];
  ctx.bookmarks.update((d) => {
    const b = d.items.find((x) => x.id === id);
    if (b) for (const k of allowed) if (typeof patch[k] === 'string') b[k] = patch[k];
  });
  changed();
}

function toggle(page) {
  if (has(page.url)) {
    remove(page.url);
    return false;
  }
  add(page);
  return true;
}

function search(text, limit = 5) {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return all()
    .filter((b) => words.every((w) => b.title.toLowerCase().includes(w) || b.url.toLowerCase().includes(w)))
    .slice(0, limit);
}

/** Import bookmarks from a Netscape bookmark HTML file (exported by Chrome, Firefox, Edge...). */
function importHtml(html) {
  const re = /<A\s+[^>]*HREF="([^"]+)"[^>]*>([^<]*)<\/A>/gi;
  let folder = '';
  let added = 0;
  const lines = html.split(/\n/);
  for (const line of lines) {
    const h3 = line.match(/<H3[^>]*>([^<]*)<\/H3>/i);
    if (h3) folder = decode(h3[1]);
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(line))) {
      if (!/^https?:/i.test(m[1])) continue;
      if (add({ url: decode(m[1]), title: decode(m[2]), folder })) added++;
    }
  }
  return added;
}

function decode(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

module.exports = { all, has, add, remove, update, toggle, search, importHtml };
