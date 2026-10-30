'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, net } = require('electron');
const { ctx } = require('./context');
const { keyOf, hash, matches } = require('./blocklist');

const SOURCES = {
  phishing: ['https://malware-filter.gitlab.io/malware-filter/phishing-filter.txt'],
  malware: ['https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-online.txt', 'https://ublockorigin.github.io/uAssets/filters/badware.txt'],
};
const MIRRORS = [['https://malware-filter.gitlab.io/malware-filter/', 'https://curbengh.github.io/malware-filter/']];
const REFRESH_AFTER = 12 * 60 * 60 * 1000;
const CHECK_EVERY = 60 * 60 * 1000;

const lists = {};
const updated = {};
const bypass = new Set();
let refreshing = null;
let timer = null;

function file(kind) {
  return path.join(app.getPath('userData'), `safety-${kind}.bin`);
}

async function download(url) {
  const urls = [url, ...MIRRORS.filter(([from]) => url.startsWith(from)).map(([from, to]) => url.replace(from, to))];
  let last;
  for (const candidate of urls) {
    try {
      const res = await net.fetch(candidate, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

async function build(texts) {
  const hashes = new Set();
  for (const text of texts) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const key = keyOf(lines[i]);
      if (key) hashes.add(hash(key));
      if (i % 4000 === 3999) await new Promise((resolve) => setImmediate(resolve));
    }
  }
  return Float64Array.from(hashes).sort();
}

function refresh() {
  refreshing ||= (async () => {
    for (const [kind, urls] of Object.entries(SOURCES)) {
      try {
        const list = await build(await Promise.all(urls.map(download)));
        if (list.length < 100) throw new Error('the list looks incomplete');
        lists[kind] = list;
        updated[kind] = Date.now();
        await fs.promises.writeFile(file(kind), Buffer.from(list.buffer));
      } catch (err) {
        console.warn('[safety] could not update', kind, err.message);
      }
    }
  })().finally(() => (refreshing = null));
  return refreshing;
}

async function load() {
  for (const kind of Object.keys(SOURCES)) {
    try {
      const [buf, stat] = await Promise.all([fs.promises.readFile(file(kind)), fs.promises.stat(file(kind))]);
      lists[kind] = new Float64Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      updated[kind] = stat.mtimeMs;
    } catch {
      updated[kind] = 0;
    }
  }
}

function stale() {
  return Object.keys(SOURCES).some((kind) => Date.now() - (updated[kind] || 0) > REFRESH_AFTER);
}

async function init() {
  await load();
  if (process.env.LIONSBROWS_TEST === '1') return;
  const tick = () => ctx.settings().safeBrowsing && stale() && refresh();
  tick();
  timer = setInterval(tick, CHECK_EVERY);
  timer.unref?.();
  ctx.events.on('settings-changed', (key) => key === 'safeBrowsing' && tick());
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function check(url) {
  if (!ctx.settings().safeBrowsing || bypass.has(hostOf(url))) return null;
  for (const kind of Object.keys(SOURCES)) if (matches(lists[kind], url)) return kind;
  return null;
}

function flag(webContentsId, url, kind) {
  for (const w of ctx.windows) {
    for (const t of w.allTabs()) {
      if (t.wc && t.wc.id === webContentsId) {
        t.danger = { url, kind };
        return;
      }
    }
  }
}

function proceed(url) {
  const host = hostOf(url);
  if (host) bypass.add(host);
}

function setList(kind, list) {
  lists[kind] = list;
}

module.exports = { init, refresh, check, flag, proceed, setList };
