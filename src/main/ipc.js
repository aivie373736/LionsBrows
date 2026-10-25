'use strict';

// IPC between the main process and the browser UI / command bar.
// Only whitelisted commands are callable, and only from our own views.

const { ipcMain } = require('electron');
const { ctx } = require('./context');
const menus = require('./menus');
const palette = require('./palette');
const downloads = require('./downloads');
const internalApi = require('./internal-api');
const { run, openInternal } = require('./actions');

const privateNotes = new Map();

function notesKey(w) {
  return w.activeWorkspaceId;
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
  toggleBookmark: (w) => run('bookmark', w),
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
  setNotes: (w, text) => {
    const value = String(text).slice(0, 200_000);
    if (w.isPrivate) privateNotes.set(w.privateId, value);
    else ctx.notes.set(notesKey(w), value);
  },
  download: (w, id, action) => downloads.action(id, action),
  openDownloadsPage: (w) => openInternal(w, 'downloads'),
  settings: (w) => run('settings', w),
  reopenTab: (w) => w.reopenClosed(),
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
  ipcMain.handle('lions:call', (event, method, ...args) => internalApi.call(event, method, ...args));
}

module.exports = { init };
