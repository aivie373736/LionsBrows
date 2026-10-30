'use strict';

const { ipcMain, clipboard } = require('electron');
const { ctx } = require('./context');
const menus = require('./menus');
const palette = require('./palette');
const downloads = require('./downloads');
const internalApi = require('./internal-api');
const { run, openInternal } = require('./actions');
const logins = require('./logins');
const extensions = require('./extensions');
const permissions = require('./permissions');
const { getDomain } = require('tldts');

const privateNotes = new Map();

function notesKey(w, wsId) {
  return wsId && ctx.workspaces().some((x) => x.id === wsId) ? wsId : w.activeWorkspaceId;
}

const UI = {
  ready: (w) => w.scheduleState(),
  newTab: (w) => w.newTab(),
  activate: (w, id) => w.activate(id),
  close: (w, id) => w.closeTab(id),
  back: (w) => w.activeTab()?.back(),
  forward: (w) => w.activeTab()?.forward(),
  reload: (w, hard) => w.activeTab()?.reload(Boolean(hard)),
  stop: (w) => w.activeTab()?.stop(),
  toggleSidebar: (w) => w.toggleSidebar(),
  togglePanel: (w, name) => ['notes', 'downloads'].includes(name) && w.togglePanel(name),
  toggleSplit: (w) => w.toggleSplit(),
  swapSplit: (w) => w.swapSplit(),
  setSplitRatio: (w, r) => w.setSplitRatio(r),
  openPalette: (w, mode) => w.openPalette(mode === 'address' ? 'address' : 'command'),
  mainMenu: (w, x, y) => menus.mainMenu(w, x, y),
  tabMenu: (w, id) => menus.tabMenu(w, id),
  shieldMenu: (w, x, y) => menus.shieldMenu(w, x, y),
  workspaceMenu: (w, id, x, y) => menus.workspaceMenu(w, id, x, y),
  workspaceSwitcher: (w, x, y) => menus.workspaceSwitcher(w, x, y),
  allTabsMenu: (w, x, y) => menus.allTabsMenu(w, x, y),
  toolbarMenu: (w, x, y) => menus.toolbarMenu(w, x, y),
  bookmarkMenu: (w, id) => menus.bookmarkMenu(w, id),
  openBookmark: (w, url, newTab) => /^https?:/i.test(String(url)) && w.openUrl(String(url), { newTab: Boolean(newTab), background: Boolean(newTab) }),
  toggleBookmark: (w) => run('bookmark', w),
  toggleReader: (w) => run('reader', w),
  passwordKey: (w, x, y) => (w.activeTab()?.pendingLogin ? w.showPasswordBubble() : menus.passwordMenu(w, x, y)),
  addressAnchor: (w, right, bottom) => {
    w.addressAnchor = { right: Number(right) || 0, bottom: Number(bottom) || 0 };
    if (w.bubbleOpen) w.layout();
  },
  toggleMute: (w, id) => {
    const t = w.tabById(id);
    if (t) t.setMuted(!t.muted);
  },
  moveTab: (w, id, beforeId, pinned) => w.moveTab(id, beforeId, pinned),
  moveToWorkspace: (w, id, wsId) => w.moveTabToWorkspace(id, wsId),
  switchWorkspace: (w, id) => w.switchWorkspace(id),
  newWorkspace: (w) => run('newWorkspace', w),
  find: (w, text, opts = {}) => w.findText(String(text), { forward: opts.forward !== false, next: Boolean(opts.next) }),
  closeFind: (w) => w.closeFind(),
  zoomReset: (w) => w.activeTab()?.zoom(0),
  getNotes: (w) => (w.isPrivate ? privateNotes.get(w.privateId) : ctx.notes.get(notesKey(w))) || '',
  setNotes: (w, wsId, text) => {
    const value = String(text).slice(0, 200_000);
    if (w.isPrivate) privateNotes.set(w.privateId, value);
    else ctx.notes.set(notesKey(w, wsId), value);
  },
  download: (w, id, action) => downloads.action(id, action),
  openDownloadsPage: (w) => openInternal(w, 'downloads'),
  settings: (w) => run('settings', w),
  reopenTab: (w) => run('reopenTab', w),
  extensionClick: (w, id, rect) => extensions.activate(w, String(id), rect || {}),
  extensionMenu: (w, id, x, y) => menus.extensionMenu(w, String(id), x, y),
  extensionsMenu: (w, rect) => menus.extensionsMenu(w, rect || {}),
  extensionInstall: (w) => extensions.installFromPage(w),
  translatePage: (w) => {
    const tab = w.activeTab();
    const translate = require('./translate');
    const url = tab && (translate.originalUrl(tab.displayUrl) || translate.proxyUrl(tab.displayUrl, require('./i18n').lang()));
    if (url) tab.navigate(url);
  },
  siteInfo: (w, rect) => {
    if (w.bubbleOpen && w.bubbleKind === 'site') return w.hideBubble();
    if (Date.now() - (w.siteHiddenAt || 0) < 300) return undefined;
    return w.showSiteBubble(rect || {});
  },
};

const BUBBLE = {
  size: (w, height) => {
    w.bubbleHeight = Math.max(80, Math.min(480, Math.ceil(Number(height) || 0)));
    w.layout();
  },
  passwordSave: (w, username) => {
    logins.save(w.activeTab(), username);
    w.hideBubble();
  },
  passwordNever: (w) => {
    logins.never(w.activeTab());
    w.hideBubble();
  },
  passwordDismiss: (w) => {
    const tab = w.activeTab();
    if (tab) tab.pendingLogin = null;
    w.hideBubble();
  },
  close: (w) => w.hideBubble(),
  sitePermission: (w, kind, value) => {
    const origin = permissions.originOf(w.activeTab()?.displayUrl || '');
    if (!/^https?:/.test(origin)) return null;
    return permissions.setSite(origin, w.isPrivate, String(kind), String(value));
  },
  siteClear: async (w) => {
    const tab = w.activeTab();
    if (!tab?.wc || !/^https?:/.test(tab.displayUrl)) return false;
    const { origin, host } = new URL(tab.displayUrl);
    const ses = tab.wc.session;
    const cookies = await ses.cookies.get({ domain: getDomain(host) || host }).catch(() => []);
    await Promise.all(cookies.map((c) => ses.cookies.remove(`http${c.secure ? 's' : ''}://${c.domain.replace(/^\./, '')}${c.path}`, c.name).catch(() => {})));
    await ses.clearStorageData({ origin, storages: ['localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage', 'filesystem'] }).catch(() => {});
    return true;
  },
  qrCopy: (w) => {
    const url = w.activeTab()?.displayUrl;
    if (url) clipboard.writeText(url);
  },
  siteReload: (w) => {
    w.activeTab()?.reload();
    w.hideBubble();
  },
  siteSettings: (w) => {
    w.hideBubble(false);
    w.newTab({ url: 'lions://settings/#privacy' });
  },
};

const OVERLAY = {
  query: (w, text, mode) => palette.query(w, String(text || ''), mode),
  suggest: (w, text) => palette.suggest(w, String(text || '')),
  run: (w, item, opts) => palette.run(w, item, opts || {}),
  close: (w) => w.closePalette(),
};

function windowFor(sender, kind) {
  for (const w of ctx.windows) {
    if (kind === 'ui' && w.ui.webContents === sender) return w;
    if (kind === 'overlay' && w.overlay?.webContents === sender) return w;
    if (kind === 'bubble' && w.bubble?.webContents === sender) return w;
  }
  return null;
}

function init() {
  ipcMain.handle('ui:cmd', (event, cmd, ...args) => {
    const w = windowFor(event.sender, 'ui');
    const fn = UI[cmd];
    if (!w || !fn) return undefined;
    return fn(w, ...args);
  });
  ipcMain.handle('overlay:cmd', (event, cmd, ...args) => {
    const w = windowFor(event.sender, 'overlay');
    const fn = OVERLAY[cmd];
    if (!w || !fn) return undefined;
    return fn(w, ...args);
  });
  ipcMain.handle('bubble:cmd', (event, cmd, ...args) => {
    const w = windowFor(event.sender, 'bubble');
    const fn = BUBBLE[cmd];
    if (!w || !fn) return undefined;
    return fn(w, ...args);
  });
  ipcMain.handle('lions:call', (event, method, ...args) => internalApi.call(event, method, ...args));
  logins.init();
  extensions.init();
}

module.exports = { init };
