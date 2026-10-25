'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { tr } = require('./i18n');

const HISTORY_DAYS = 180;
const MAX_VISITS = 100_000;
const WEBKIT_EPOCH_OFFSET = 11_644_473_600_000n;

function home(...parts) {
  return path.join(os.homedir(), ...parts);
}

function chromiumRoots() {
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || home('AppData', 'Local');
    const roaming = process.env.APPDATA || home('AppData', 'Roaming');
    return [
      ['chrome', 'Google Chrome', path.join(local, 'Google', 'Chrome', 'User Data')],
      ['edge', 'Microsoft Edge', path.join(local, 'Microsoft', 'Edge', 'User Data')],
      ['brave', 'Brave', path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data')],
      ['vivaldi', 'Vivaldi', path.join(local, 'Vivaldi', 'User Data')],
      ['opera', 'Opera', path.join(roaming, 'Opera Software', 'Opera Stable')],
      ['operagx', 'Opera GX', path.join(roaming, 'Opera Software', 'Opera GX Stable')],
      ['chromium', 'Chromium', path.join(local, 'Chromium', 'User Data')],
    ];
  }
  if (process.platform === 'darwin') {
    const support = home('Library', 'Application Support');
    return [
      ['chrome', 'Google Chrome', path.join(support, 'Google', 'Chrome')],
      ['edge', 'Microsoft Edge', path.join(support, 'Microsoft Edge')],
      ['brave', 'Brave', path.join(support, 'BraveSoftware', 'Brave-Browser')],
      ['vivaldi', 'Vivaldi', path.join(support, 'Vivaldi')],
      ['opera', 'Opera', path.join(support, 'com.operasoftware.Opera')],
      ['operagx', 'Opera GX', path.join(support, 'com.operasoftware.OperaGX')],
      ['chromium', 'Chromium', path.join(support, 'Chromium')],
    ];
  }
  return [
    ['chrome', 'Google Chrome', home('.config', 'google-chrome')],
    ['edge', 'Microsoft Edge', home('.config', 'microsoft-edge')],
    ['brave', 'Brave', home('.config', 'BraveSoftware', 'Brave-Browser')],
    ['vivaldi', 'Vivaldi', home('.config', 'vivaldi')],
    ['opera', 'Opera', home('.config', 'opera')],
    ['chromium', 'Chromium', home('.config', 'chromium')],
    ['chromium-snap', 'Chromium', home('snap', 'chromium', 'common', 'chromium')],
  ];
}

function firefoxRoots() {
  if (process.platform === 'win32') return [path.join(process.env.APPDATA || home('AppData', 'Roaming'), 'Mozilla', 'Firefox')];
  if (process.platform === 'darwin') return [home('Library', 'Application Support', 'Firefox')];
  return [home('.mozilla', 'firefox'), home('snap', 'firefox', 'common', '.mozilla', 'firefox'), home('.var', 'app', 'org.mozilla.firefox', '.mozilla', 'firefox')];
}

function exists(file) {
  try {
    fs.accessSync(file);
    return true;
  } catch {
    return false;
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function chromiumProfiles(root) {
  const local = readJson(path.join(root, 'Local State'));
  const cache = local?.profile?.info_cache || {};
  const dirs = Object.keys(cache);
  if (!dirs.length) {
    if (exists(path.join(root, 'Default'))) dirs.push('Default');
    else if (exists(path.join(root, 'Bookmarks')) || exists(path.join(root, 'History'))) dirs.push('');
  }
  return dirs
    .map((dir) => ({ dir: path.join(root, dir), name: cache[dir]?.name || cache[dir]?.gaia_name || (dir || 'Default') }))
    .filter((p) => exists(path.join(p.dir, 'Bookmarks')) || exists(path.join(p.dir, 'History')));
}

function parseIni(text) {
  const sections = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const head = /^\[(.+)\]$/.exec(line);
    if (head) {
      current = { name: head[1], values: {} };
      sections.push(current);
    } else if (current) {
      const i = line.indexOf('=');
      if (i > 0) current.values[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return sections;
}

function firefoxProfiles(root) {
  let sections;
  try {
    sections = parseIni(fs.readFileSync(path.join(root, 'profiles.ini'), 'utf8'));
  } catch {
    return [];
  }
  const installDefaults = new Set(sections.filter((s) => s.name.startsWith('Install')).map((s) => s.values.Default).filter(Boolean));
  return sections
    .filter((s) => s.name.startsWith('Profile') && s.values.Path)
    .map((s) => {
      const rel = s.values.IsRelative !== '0';
      const dir = rel ? path.join(root, ...s.values.Path.split('/')) : s.values.Path;
      return { dir, name: s.values.Name || s.values.Path, preferred: installDefaults.has(s.values.Path) || s.values.Default === '1' };
    })
    .filter((p) => exists(path.join(p.dir, 'places.sqlite')))
    .sort((a, b) => Number(b.preferred) - Number(a.preferred));
}

function sources() {
  const out = [];
  const seen = new Set();
  for (const [key, browser, root] of chromiumRoots()) {
    for (const p of chromiumProfiles(root)) {
      if (seen.has(p.dir)) continue;
      seen.add(p.dir);
      out.push({ id: `${key}|${p.dir}`, kind: 'chromium', browser, profile: p.name, dir: p.dir });
    }
  }
  for (const root of firefoxRoots()) {
    for (const p of firefoxProfiles(root)) {
      if (seen.has(p.dir)) continue;
      seen.add(p.dir);
      out.push({ id: `firefox|${p.dir}`, kind: 'firefox', browser: 'Firefox', profile: p.name, dir: p.dir });
    }
  }
  const counts = {};
  for (const s of out) counts[s.browser] = (counts[s.browser] || 0) + 1;
  return out.map((s) => ({ ...s, label: counts[s.browser] > 1 ? `${s.browser} (${s.profile})` : s.browser }));
}

async function withCopy(files, fn) {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lionsbrows-import-'));
  try {
    const copied = [];
    for (const [i, file] of files.entries()) {
      if (!exists(file)) {
        if (i === 0) return null;
        continue;
      }
      const target = path.join(tmp, path.basename(file));
      await fs.promises.copyFile(file, target);
      copied.push(target);
    }
    const db = new DatabaseSync(copied[0]);
    try {
      return fn(db);
    } finally {
      db.close();
    }
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
}

function webkitToMs(value) {
  try {
    const n = BigInt(value || 0);
    return n > 0n ? Number(n / 1000n - WEBKIT_EPOCH_OFFSET) : Date.now();
  } catch {
    return Date.now();
  }
}

function msToWebkit(ms) {
  return (BigInt(Math.floor(ms)) + WEBKIT_EPOCH_OFFSET) * 1000n;
}

const CHROMIUM_ROOTS = { bookmark_bar: '', other: tr('Other bookmarks'), synced: tr('Mobile bookmarks') };

function chromiumBookmarks(dir) {
  const data = readJson(path.join(dir, 'Bookmarks'));
  if (!data?.roots) return [];
  const out = [];
  const walk = (node, folder) => {
    if (node.type === 'url') {
      if (/^https?:/i.test(node.url || '')) out.push({ url: node.url, title: node.name || '', folder, created: webkitToMs(node.date_added) });
      return;
    }
    for (const child of node.children || []) walk(child, child.type === 'folder' ? [folder, child.name].filter(Boolean).join(' / ') : folder);
  };
  for (const [key, folder] of Object.entries(CHROMIUM_ROOTS)) if (data.roots[key]) walk(data.roots[key], folder);
  return out;
}

async function chromiumHistory(dir) {
  const since = msToWebkit(Date.now() - HISTORY_DAYS * 86_400_000);
  const rows = await withCopy([path.join(dir, 'History'), path.join(dir, 'History-journal')], (db) =>
    db
      .prepare(
        `SELECT u.url AS url, u.title AS title, u.typed_count AS typed, CAST(v.visit_time AS TEXT) AS time
         FROM visits v JOIN urls u ON u.id = v.url
         WHERE v.visit_time > ? AND u.hidden = 0 AND (v.transition & 255) NOT IN (3, 4) AND u.url LIKE 'http%'
         ORDER BY v.visit_time DESC LIMIT ?`,
      )
      .all(since, MAX_VISITS),
  );
  return (rows || []).map((r) => ({ url: r.url, title: r.title || '', typed: r.typed || 0, time: webkitToMs(r.time) }));
}

const FIREFOX_ROOTS = { toolbar_____: '', menu________: tr('Bookmarks menu'), unfiled_____: tr('Other bookmarks'), mobile______: tr('Mobile bookmarks') };

async function firefoxData(dir, { bookmarks, history }) {
  const files = ['places.sqlite', 'places.sqlite-wal'].map((f) => path.join(dir, f));
  return withCopy(files, (db) => {
    const result = { bookmarks: [], history: [] };
    if (bookmarks) {
      const rows = db
        .prepare('SELECT b.id AS id, b.parent AS parent, b.type AS type, b.title AS title, b.guid AS guid, b.dateAdded AS added, p.url AS url FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id = b.fk ORDER BY b.parent, b.position')
        .all();
      const byId = new Map(rows.map((r) => [r.id, r]));
      const folderOf = (row) => {
        const names = [];
        let cur = byId.get(row.parent);
        while (cur) {
          if (cur.guid in FIREFOX_ROOTS) {
            if (FIREFOX_ROOTS[cur.guid]) names.unshift(FIREFOX_ROOTS[cur.guid]);
            return names.join(' / ');
          }
          if (cur.title) names.unshift(cur.title);
          cur = byId.get(cur.parent);
        }
        return null;
      };
      for (const r of rows) {
        if (r.type !== 1 || !/^https?:/i.test(r.url || '')) continue;
        const folder = folderOf(r);
        if (folder === null) continue;
        result.bookmarks.push({ url: r.url, title: r.title || '', folder, created: Math.floor(Number(r.added || 0) / 1000) || Date.now() });
      }
    }
    if (history) {
      const since = (Date.now() - HISTORY_DAYS * 86_400_000) * 1000;
      result.history = db
        .prepare(
          `SELECT p.url AS url, p.title AS title, p.typed AS typed, v.visit_date AS time
           FROM moz_historyvisits v JOIN moz_places p ON p.id = v.place_id
           WHERE v.visit_date > ? AND p.hidden = 0 AND v.visit_type NOT IN (4, 5, 6, 7, 8, 9) AND p.url LIKE 'http%'
           ORDER BY v.visit_date DESC LIMIT ?`,
        )
        .all(since, MAX_VISITS)
        .map((r) => ({ url: r.url, title: r.title || '', typed: r.typed || 0, time: Math.floor(Number(r.time) / 1000) }));
    }
    return result;
  });
}

async function read(source, opts) {
  if (source.kind === 'firefox') return (await firefoxData(source.dir, opts)) || { bookmarks: [], history: [] };
  return {
    bookmarks: opts.bookmarks ? chromiumBookmarks(source.dir) : [],
    history: opts.history ? await chromiumHistory(source.dir) : [],
  };
}

async function run(id, { bookmarks = true, history = true } = {}, { addBookmarks, addHistory }) {
  const source = sources().find((s) => s.id === id);
  if (!source) throw new Error(tr('Browser not found'));
  let data;
  try {
    data = await read(source, { bookmarks, history });
  } catch (err) {
    if (/EBUSY|EPERM|locked|SQLITE_BUSY/i.test(String(err && (err.code || err.message)))) throw new Error(tr('Close {browser} and try again.', { browser: source.browser }));
    throw err;
  }
  return {
    browser: source.browser,
    bookmarks: bookmarks ? addBookmarks(data.bookmarks) : 0,
    history: history ? addHistory(data.history) : 0,
  };
}

module.exports = { sources, run, parseIni, chromiumBookmarks, webkitToMs, msToWebkit };
