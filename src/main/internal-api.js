'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, dialog, shell, session, webContents, nativeTheme } = require('electron');
const { ctx, DEFAULT_SETTINGS, ACCENTS, HEX } = require('./context');
const searchEngines = require('./search-engines');
const { backgroundsDir } = require('./protocol');
const bookmarks = require('./bookmarks');
const downloads = require('./downloads');
const permissions = require('./permissions');
const extensions = require('./extensions');
const adblock = require('./adblock');
const { tr } = require('./i18n');

const ENUMS = {
  startup: ['restore', 'newtab'],
  theme: ['system', 'light', 'dark'],
  layout: ['horizontal', 'vertical'],
  memorySaver: ['auto', 'balanced', 'maximum', 'off'],
  lowEndMode: ['auto', 'on', 'off'],
  ntBackground: ['default', 'color', 'image', 'video'],
  downloadsButton: ['auto', 'always'],
  language: ['auto', 'en', 'de'],
  cookies: ['keep', 'session'],
  defaultCamera: ['ask', 'block'],
  defaultMicrophone: ['ask', 'block'],
  defaultLocation: ['ask', 'block'],
  defaultNotifications: ['ask', 'block'],
  readerFont: ['serif', 'sans'],
  readerTheme: ['auto', 'light', 'sepia', 'dark'],
};

const RANGES_NUM = {
  ntBackgroundDim: [0, 0.9],
  ntBackgroundBlur: [0, 40],
  readerSize: [14, 32],
};

const BACKGROUND_TYPES = {
  image: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'],
  video: ['mp4', 'webm', 'mov', 'm4v', 'ogv'],
};

function validate(key, value) {
  if (!(key in DEFAULT_SETTINGS)) throw new Error('Unknown setting');
  if (typeof value !== typeof DEFAULT_SETTINGS[key]) throw new Error('Wrong type');
  if (ENUMS[key] && !ENUMS[key].includes(value)) throw new Error('Invalid value');
  if (key === 'searchEngine' && !searchEngines.list().some((e) => e.id === value)) throw new Error('Unknown search engine');
  if (RANGES_NUM[key] && !(value >= RANGES_NUM[key][0] && value <= RANGES_NUM[key][1])) throw new Error('Out of range');
  if ((key === 'accent' || key === 'ntBackgroundColor') && !HEX.test(value)) throw new Error('Invalid color');
  if (key === 'frameColor' && value !== '' && !HEX.test(value)) throw new Error('Invalid color');
  if (key === 'ntBackgroundFile' && value !== '') throw new Error('Use chooseBackground');
  if (key === 'customSearchUrl' && value !== '' && !searchEngines.isValidTemplate(value)) throw new Error(tr('The address must start with http and contain %s'));
  if (key === 'greetingName' || key === 'customSearchName') return value.slice(0, 40);
  return value;
}

function backgroundInfo() {
  const s = ctx.settings();
  const file = s.ntBackgroundFile;
  const hasFile = file && fs.existsSync(path.join(backgroundsDir(), file));
  const type = (s.ntBackground === 'image' || s.ntBackground === 'video') && !hasFile ? 'default' : s.ntBackground;
  return {
    type,
    url: hasFile ? `lions://background/${encodeURIComponent(file)}` : '',
    color: s.ntBackgroundColor,
    dim: s.ntBackgroundDim,
    blur: s.ntBackgroundBlur,
  };
}

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
      engines: searchEngines.list(),
      accents: ACCENTS,
      accent: ctx.accentColor(),
      background: backgroundInfo(),
      downloadsDir: downloads.downloadsDir(),
    };
  },

  setSetting(_s, key, value) {
    ctx.setSetting(key, validate(key, value));
    return ctx.settings();
  },

  setSettings(_s, patch) {
    const clean = {};
    for (const [key, value] of Object.entries(patch || {})) clean[key] = validate(key, value);
    ctx.setSettings(clean);
    return ctx.settings();
  },

  async chooseBackground(sender, kind) {
    if (!BACKGROUND_TYPES[kind]) throw new Error('Unknown background type');
    const { w } = findTab(sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(w?.win, {
      title: kind === 'video' ? tr('Choose a video for the new tab page') : tr('Choose an image for the new tab page'),
      filters: [{ name: kind === 'video' ? tr('Videos') : tr('Images'), extensions: BACKGROUND_TYPES[kind] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths[0]) return backgroundInfo();
    return API.useBackgroundFile(sender, filePaths[0], kind);
  },

  async useBackgroundFile(_s, source, kind) {
    const ext = path.extname(source).slice(1).toLowerCase();
    if (!BACKGROUND_TYPES[kind] || !BACKGROUND_TYPES[kind].includes(ext)) throw new Error('Unsupported file type');
    const dir = backgroundsDir();
    await fs.promises.mkdir(dir, { recursive: true });
    const name = `background-${Date.now()}.${ext}`;
    await fs.promises.copyFile(source, path.join(dir, name));
    for (const old of await fs.promises.readdir(dir)) if (old !== name) await fs.promises.rm(path.join(dir, old), { force: true });
    ctx.setSettings({ ntBackground: kind, ntBackgroundFile: name });
    return backgroundInfo();
  },

  async clearBackground() {
    await fs.promises.rm(backgroundsDir(), { recursive: true, force: true });
    ctx.setSettings({ ntBackground: 'default', ntBackgroundFile: '' });
    return backgroundInfo();
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
      engines: searchEngines.list(),
      accents: ACCENTS,
      accent: ctx.accentColor(),
      background: backgroundInfo(),
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
    const { canceled, filePaths } = await dialog.showOpenDialog(w?.win, { filters: [{ name: tr('Bookmarks (HTML)'), extensions: ['html', 'htm'] }], properties: ['openFile'] });
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

  importSources() {
    return require('./importer')
      .sources()
      .map((s) => ({ id: s.id, label: s.label, browser: s.browser }));
  },
  async importRun(_s, id, opts = {}) {
    return require('./importer').run(String(id), { bookmarks: opts.bookmarks !== false, history: opts.history !== false }, {
      addBookmarks: (list) => bookmarks.addMany(list),
      addHistory: (rows) => ctx.history.importVisits(rows),
    });
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
    const { canceled, filePaths } = await dialog.showOpenDialog(w?.win, { title: tr('Choose an unpacked extension folder'), properties: ['openDirectory'] });
    if (!canceled && filePaths[0]) await extensions.addUnpacked(filePaths[0]);
    return extensions.list();
  },
  extensionsRemove(_s, key) {
    extensions.remove(String(key));
    return extensions.list();
  },
  extensionsPin(_s, id, pinned) {
    extensions.setPinned(String(id), Boolean(pinned));
    return extensions.list();
  },
  extensionsOptions(sender, id) {
    extensions.openOptions(findTab(sender).w, String(id));
  },
  extensionsStore(sender) {
    findTab(sender).w?.newTab({ url: `${extensions.STORE_ORIGIN}/category/extensions` });
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

  updateState() {
    return require('./updater').state();
  },
  updateCheck() {
    return require('./updater').check();
  },
  updateInstall() {
    require('./updater').install();
  },

  makeDefaultBrowser() {
    if (process.platform === 'win32') {
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

  memoryReport() {
    return require('./memory').report();
  },
  memorySleepTab(_s, id) {
    return require('./memory').sleepTab(Number(id));
  },
  memorySleepAll() {
    return require('./memory').sleepAllBackground();
  },
  relaunch() {
    app.relaunch();
    app.quit();
  },

  shortcuts() {
    const { ACTIONS, shortcutLabel } = require('./actions');
    return Object.entries(ACTIONS)
      .filter(([, a]) => a.keys && a.keys.length)
      .map(([id, a]) => ({ title: tr(a.title, a.vars), keys: shortcutLabel(id) }));
  },

  passwordsInfo() {
    const logins = require('./logins');
    return { available: logins.available(), weak: logins.weakStorage(), logins: ctx.passwords.list(), never: ctx.passwords.never() };
  },
  passwordReveal(_s, id) {
    return ctx.passwords.password(String(id));
  },
  passwordRemove(_s, id) {
    ctx.passwords.remove(String(id));
  },
  passwordNeverRemove(_s, origin) {
    ctx.passwords.removeNever(String(origin));
  },
  async passwordsImport(sender) {
    const { w } = findTab(sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(w?.win, { title: tr('Import passwords'), filters: [{ name: tr('Passwords (CSV)'), extensions: ['csv'] }], properties: ['openFile'] });
    if (canceled || !filePaths[0]) return null;
    try {
      return ctx.passwords.importCsv(fs.readFileSync(filePaths[0], 'utf8'));
    } catch {
      throw new Error(tr('This file doesn’t look like a password export.'));
    }
  },
  async passwordsExport(sender) {
    const { w } = findTab(sender);
    const { response } = await dialog.showMessageBox(w?.win, {
      type: 'warning',
      buttons: [tr('Export'), tr('Cancel')],
      defaultId: 1,
      cancelId: 1,
      message: tr('Export your passwords?'),
      detail: tr('The file is not encrypted. Anyone who can open it can read your passwords.'),
    });
    if (response !== 0) return false;
    const { canceled, filePath } = await dialog.showSaveDialog(w?.win, { defaultPath: 'lionsbrows-passwords.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (canceled || !filePath) return false;
    fs.writeFileSync(filePath, ctx.passwords.exportCsv(), { mode: 0o600 });
    return true;
  },

  dangerProceed(_s, url) {
    require('./safety').proceed(String(url));
  },

  readerArticle(_s, id) {
    return require('./reader').article(id);
  },

  bangs() {
    return Object.entries(searchEngines.BANGS).map(([key, b]) => ({ key, name: b.name }));
  },
};

const SETTINGS_ONLY = new Set(['passwordsInfo', 'passwordReveal', 'passwordRemove', 'passwordNeverRemove', 'passwordsImport', 'passwordsExport']);

const LIMITED = {
  reader: ['getSettings', 'setSettings', 'readerArticle'],
  error: ['getSettings', 'dangerProceed'],
};

async function call(event, method, ...args) {
  const url = event.senderFrame?.url || '';
  if (!url.startsWith('lions://')) throw new Error('Not allowed');
  const host = new URL(url).hostname;
  const allowed = LIMITED[host];
  if (allowed && !allowed.includes(method)) throw new Error('Not allowed');
  if (SETTINGS_ONLY.has(method) && host !== 'settings') throw new Error('Not allowed');
  const fn = API[method];
  if (typeof fn !== 'function') throw new Error(`Unknown method ${method}`);
  return fn(event.sender, ...args);
}

function broadcast(name, data) {
  for (const wc of webContents.getAllWebContents()) {
    if (!wc.isDestroyed() && wc.getURL().startsWith('lions://')) wc.send('lions:event', name, data);
  }
}

module.exports = { call, broadcast };
