'use strict';

// The API available to LionsBrows' own lions:// pages (new tab, settings,
// history, bookmarks, downloads). Websites never get it: the preload only
// exposes it on lions:// pages, and every call is checked again here.

const fs = require('node:fs');
const { app, dialog, shell, session, webContents, nativeTheme } = require('electron');
const { ctx, DEFAULT_SETTINGS, ACCENTS } = require('./context');
const { ENGINES, BANGS } = require('./search-engines');
const bookmarks = require('./bookmarks');
const downloads = require('./downloads');
const permissions = require('./permissions');
const extensions = require('./extensions');
const adblock = require('./adblock');

const ENUMS = {
  searchEngine: Object.keys(ENGINES),
  startup: ['restore', 'newtab'],
  theme: ['system', 'light', 'dark'],
  accent: Object.keys(ACCENTS),
};

function findTab(wc) {
  for (const w of ctx.windows) for (const t of w.allTabs()) if (t.wc === wc) return { w, t };
  return {};
}

function persistentSessions() {
  const parts = new Set(['persist:main', ...ctx.workspaces().filter((w) => w.isolated).map((w) => `persist:ws-${w.id}`)]);
  return [...parts].map((p) => session.fromPartition(p));
}

function exportBookmarksHtml() {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const groups = new Map();
  for (const b of bookmarks.all()) {
    if (!groups.has(b.folder)) groups.set(b.folder, []);
    groups.get(b.folder).push(b);
  }
  const item = (b) => `    <DT><A HREF="${esc(b.url)}" ADD_DATE="${Math.floor(b.created / 1000)}">${esc(b.title)}</A>`;
  const body = [...groups]
    .map(([folder, items]) => (folder ? `  <DT><H3>${esc(folder)}</H3>\n  <DL><p>\n${items.map(item).join('\n')}\n  </DL><p>` : items.map(item).join('\n')))
    .join('\n');
  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n${body}\n</DL><p>\n`;
}

const RANGES = { hour: 3_600_000, day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000 };

const API = {
  getSettings(sender) {
    return {
      dark: nativeTheme.shouldUseDarkColors,
      isPrivate: Boolean(findTab(sender).w?.isPrivate),
      settings: ctx.settings(),
      engines: Object.entries(ENGINES).map(([id, e]) => ({ id, name: e.name })),
      accents: ACCENTS,
      accent: ctx.accentColor(),
      downloadsDir: downloads.downloadsDir(),
    };
  },

  setSetting(_s, key, value) {
    if (!(key in DEFAULT_SETTINGS)) throw new Error('Unknown setting');
    if (typeof value !== typeof DEFAULT_SETTINGS[key]) throw new Error('Wrong type');
    if (ENUMS[key] && !ENUMS[key].includes(value)) throw new Error('Invalid value');
    if (key === 'tabSleepMinutes' && !(value >= 0 && value <= 1440)) throw new Error('Out of range');
    if (key === 'greetingName') value = value.slice(0, 40);
    ctx.setSetting(key, value);
    return ctx.settings();
  },

  async chooseDownloadsFolder(sender) {
    const { w } = findTab(sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(w?.win, { properties: ['openDirectory', 'createDirectory'] });
    if (!canceled && filePaths[0]) ctx.setSetting('downloadsPath', filePaths[0]);
    return downloads.downloadsDir();
  },

  navigate(sender, text) {
    const { w, t } = findTab(sender);
    if (!w || !t) return;
    const { classify } = require('./omnibox');
    const result = classify(String(text), ctx.settings().searchEngine);
    if (result) t.navigate(result.url, { typed: true });
  },

  getNewTabData(sender) {
    const isPrivate = Boolean(findTab(sender).w?.isPrivate);
    return {
      isPrivate,
      dark: nativeTheme.shouldUseDarkColors,
      topSites: ctx.settings().showTopSites && !isPrivate ? ctx.history.topSites(8) : [],
      blocked: ctx.config.get('stats').blocked,
      settings: ctx.settings(),
      accent: ctx.accentColor(),
    };
  },

  removeTopSite(_s, url) {
    ctx.history.deleteUrl(url);
  },

  historyList(_s, opts = {}) {
    return ctx.history.visits({ query: String(opts.query || ''), limit: Math.min(500, opts.limit || 100), offset: opts.offset || 0 });
  },
  historyDelete(_s, url) {
    ctx.history.deleteUrl(String(url));
  },
  historyClear(_s, range) {
    ctx.history.clear(RANGES[range] ? Date.now() - RANGES[range] : 0);
  },

  bookmarksList() {
    return bookmarks.all();
  },
  bookmarksRemove(_s, id) {
    bookmarks.remove(id);
  },
  bookmarksUpdate(_s, id, patch) {
    bookmarks.update(id, patch || {});
  },
  async bookmarksImport(sender) {
    const { w } = findTab(sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(w?.win, { filters: [{ name: 'Bookmarks (HTML)', extensions: ['html', 'htm'] }], properties: ['openFile'] });
    if (canceled || !filePaths[0]) return 0;
    return bookmarks.importHtml(fs.readFileSync(filePaths[0], 'utf8'));
  },
  async bookmarksExport(sender) {
    const { w } = findTab(sender);
    const { canceled, filePath } = await dialog.showSaveDialog(w?.win, { defaultPath: 'lionsbrows-bookmarks.html', filters: [{ name: 'HTML', extensions: ['html'] }] });
    if (canceled || !filePath) return false;
    fs.writeFileSync(filePath, exportBookmarksHtml());
    return true;
  },

  downloadsList() {
    return downloads.list();
  },
  downloadAction(_s, id, action) {
    downloads.action(id, action);
  },

  async clearData(_s, opts = {}) {
    const since = RANGES[opts.range] ? Date.now() - RANGES[opts.range] : 0;
    if (opts.history) ctx.history.clear(since);
    if (opts.downloads) downloads.action(null, 'clear');
    for (const ses of persistentSessions()) {
      if (opts.cookies) await ses.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage', 'filesystem', 'shadercache'] });
      if (opts.cache) await ses.clearCache();
    }
    return true;
  },

  permissionsList() {
    return permissions.list();
  },
  permissionsReset(_s, origin) {
    permissions.reset(origin || null);
  },

  adblockInfo() {
    return { allowlist: ctx.config.get('adblockAllowlist'), blocked: ctx.config.get('stats').blocked, since: ctx.config.get('stats').since };
  },
  adblockAllowRemove(_s, host) {
    ctx.config.update((d) => (d.adblockAllowlist = d.adblockAllowlist.filter((h) => h !== host)));
  },
  async adblockRefresh() {
    await adblock.refresh();
    return true;
  },

  extensionsList() {
    return extensions.list();
  },
  async extensionsAdd(sender) {
    const { w } = findTab(sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(w?.win, { title: 'Choose an unpacked extension folder', properties: ['openDirectory'] });
    if (canceled || !filePaths[0]) return extensions.list();
    await extensions.add(filePaths[0], persistentSessions());
    return extensions.list();
  },
  extensionsRemove(_s, dir) {
    extensions.remove(dir, persistentSessions());
    return extensions.list();
  },

  about() {
    return {
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      v8: process.versions.v8,
      platform: `${process.platform} ${process.arch}`,
      isDefault: app.isDefaultProtocolClient('https'),
    };
  },

  makeDefaultBrowser() {
    if (process.platform === 'win32') {
      // Windows 10/11 only lets the user pick the default browser in Settings.
      shell.openExternal('ms-settings:defaultapps');
      return 'settings';
    }
    app.setAsDefaultProtocolClient('http');
    app.setAsDefaultProtocolClient('https');
    return app.isDefaultProtocolClient('https') ? 'ok' : 'failed';
  },

  openDataFolder() {
    shell.openPath(app.getPath('userData'));
  },

  shortcuts() {
    const { ACTIONS, shortcutLabel } = require('./actions');
    return Object.entries(ACTIONS)
      .filter(([, a]) => a.keys && a.keys.length)
      .map(([id, a]) => ({ title: a.title, keys: shortcutLabel(id) }));
  },

  bangs() {
    return Object.entries(BANGS).map(([key, b]) => ({ key, name: b.name }));
  },
};

async function call(event, method, ...args) {
  const url = event.senderFrame?.url || '';
  if (!url.startsWith('lions://')) throw new Error('Not allowed');
  const fn = API[method];
  if (typeof fn !== 'function') throw new Error(`Unknown method ${method}`);
  return fn(event.sender, ...args);
}

/** Push an event to every open lions:// page. */
function broadcast(name, data) {
  for (const wc of webContents.getAllWebContents()) {
    if (!wc.isDestroyed() && wc.getURL().startsWith('lions://')) wc.send('lions:event', name, data);
  }
}

module.exports = { call, broadcast };
