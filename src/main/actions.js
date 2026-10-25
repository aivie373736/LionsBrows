'use strict';

const fs = require('node:fs');
const { clipboard, dialog, shell } = require('electron');
const { ctx } = require('./context');
const downloads = require('./downloads');
const bookmarks = require('./bookmarks');
const adblock = require('./adblock');

const isMac = process.platform === 'darwin';
const pick = (other, mac) => (isMac ? mac : other);

function openWindow(opts) {
  const { BrowserWin } = require('./window');
  return new BrowserWin(opts);
}

function activeWc(w) {
  return w.activeTab()?.wc || null;
}

function cycleTab(w, dir) {
  const tabs = w.space().tabs;
  if (tabs.length < 2) return;
  const i = tabs.findIndex((t) => t.id === w.space().activeId);
  w.activate(tabs[(i + dir + tabs.length) % tabs.length].id);
}

function nthTab(w, n) {
  const tabs = w.space().tabs;
  const tab = n === -1 ? tabs[tabs.length - 1] : tabs[n];
  if (tab) w.activate(tab.id);
}

function openInternal(w, page) {
  const url = `lions://${page}/`;
  const existing = w.space().tabs.find((t) => t.url.startsWith(url));
  if (existing) w.activate(existing.id);
  else w.newTab({ url });
}

async function screenshot(w) {
  const wc = activeWc(w);
  if (!wc) return;
  let png;
  try {
    wc.debugger.attach('1.3');
    const metrics = await wc.debugger.sendCommand('Page.getLayoutMetrics');
    const size = metrics.cssContentSize || metrics.contentSize;
    const { data } = await wc.debugger.sendCommand('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: Math.ceil(size.width), height: Math.min(Math.ceil(size.height), 16384), scale: 1 },
    });
    png = Buffer.from(data, 'base64');
  } catch {
    png = (await wc.capturePage()).toPNG();
  } finally {
    if (wc.debugger.isAttached()) wc.debugger.detach();
  }
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const file = downloads.uniquePath(downloads.downloadsDir(), `Screenshot ${stamp}.png`);
  fs.writeFileSync(file, png);
  shell.showItemInFolder(file);
}

async function savePage(w) {
  const wc = activeWc(w);
  if (!wc) return;
  const name = (w.activeTab().title || 'page').replace(/[\\/:*?"<>|]/g, '_').slice(0, 100);
  const { canceled, filePath } = await dialog.showSaveDialog(w.win, {
    defaultPath: downloads.uniquePath(downloads.downloadsDir(), `${name}.html`),
    filters: [{ name: 'Web page, complete', extensions: ['html'] }],
  });
  if (!canceled && filePath) await wc.savePage(filePath, 'HTMLComplete');
}

function toggleBookmark(w) {
  const tab = w.activeTab();
  if (!tab || !/^https?:/.test(tab.displayUrl)) return;
  bookmarks.toggle({ url: tab.displayUrl, title: tab.title, favicon: tab.favicon });
  w.scheduleState();
}

const ACTIONS = {
  newTab: { title: 'New tab', keys: ['mod+t'], run: (w) => w.newTab() },
  newWindow: { title: 'New window', keys: ['mod+n'], run: () => openWindow({}) },
  newPrivateWindow: { title: 'New private window', keys: ['mod+shift+n'], run: () => openWindow({ isPrivate: true }) },
  closeTab: { title: 'Close tab', keys: ['mod+w', 'mod+f4'], run: (w) => w.activeTab() && w.closeTab(w.activeTab().id) },
  reopenTab: { title: 'Reopen closed tab', keys: ['mod+shift+t'], run: (w) => w.reopenClosed() },
  duplicateTab: { title: 'Duplicate tab', run: (w) => w.activeTab() && w.duplicateTab(w.activeTab().id) },
  pinTab: { title: 'Pin / unpin tab', run: (w) => w.activeTab() && w.togglePin(w.activeTab().id) },
  muteTab: { title: 'Mute / unmute tab', keys: ['mod+shift+m'], run: (w) => w.activeTab()?.setMuted(!w.activeTab().muted) },
  sleepTabs: { title: 'Put background tabs to sleep (free memory)', run: (w) => w.sleepOtherTabs() },
  closeOtherTabs: { title: 'Close other tabs', run: (w) => w.activeTab() && w.closeOtherTabs(w.activeTab().id) },

  focusAddress: { title: 'Edit address', keys: ['mod+l', 'alt+d', 'f6'], hidden: true, run: (w) => w.openPalette('address') },
  palette: { title: 'Command bar', keys: ['mod+k'], hidden: true, run: (w) => w.openPalette('command') },

  nextTab: { title: 'Next tab', keys: [pick('mod+tab', 'ctrl+tab'), 'mod+pagedown', pick('mod+alt+arrowdown', 'mod+alt+arrowright')], hidden: true, run: (w) => cycleTab(w, 1) },
  prevTab: { title: 'Previous tab', keys: [pick('mod+shift+tab', 'ctrl+shift+tab'), 'mod+pageup', pick('mod+alt+arrowup', 'mod+alt+arrowleft')], hidden: true, run: (w) => cycleTab(w, -1) },
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((n) => [`tab${n}`, { title: `Go to tab ${n}`, keys: [`mod+${n}`], hidden: true, run: (w) => nthTab(w, n - 1) }])),
  lastTab: { title: 'Go to last tab', keys: ['mod+9'], hidden: true, run: (w) => nthTab(w, -1) },

  back: { title: 'Back', keys: ['alt+arrowleft', 'mod+['], hidden: true, run: (w) => w.activeTab()?.back() },
  forward: { title: 'Forward', keys: ['alt+arrowright', 'mod+]'], hidden: true, run: (w) => w.activeTab()?.forward() },
  reload: { title: 'Reload page', keys: ['mod+r', 'f5'], run: (w) => w.activeTab()?.reload() },
  hardReload: { title: 'Hard reload (ignore cache)', keys: ['mod+shift+r', 'shift+f5', 'mod+f5'], run: (w) => w.activeTab()?.reload(true) },

  find: { title: 'Find in page', keys: ['mod+f'], run: (w) => w.openFind() },
  findNext: { title: 'Find next', keys: ['mod+g', 'f3'], hidden: true, run: (w) => w.find.open && w.findText(w.find.query, { next: true }) },
  findPrev: { title: 'Find previous', keys: ['mod+shift+g', 'shift+f3'], hidden: true, run: (w) => w.find.open && w.findText(w.find.query, { next: true, forward: false }) },

  zoomIn: { title: 'Zoom in', keys: ['mod+=', 'mod++', 'mod+shift+='], run: (w) => w.activeTab()?.zoom(1) },
  zoomOut: { title: 'Zoom out', keys: ['mod+-', 'mod+shift+-'], run: (w) => w.activeTab()?.zoom(-1) },
  zoomReset: { title: 'Reset zoom', keys: ['mod+0'], run: (w) => w.activeTab()?.zoom(0) },

  bookmark: { title: 'Bookmark this page', keys: ['mod+d'], run: toggleBookmark },
  history: { title: 'History', keys: [pick('mod+h', 'mod+y')], run: (w) => openInternal(w, 'history') },
  bookmarksPage: { title: 'Bookmarks', keys: ['mod+shift+o'], run: (w) => openInternal(w, 'bookmarks') },
  downloads: { title: 'Downloads', keys: [pick('mod+j', 'mod+shift+j')], run: (w) => w.togglePanel('downloads') },
  downloadsPage: { title: 'All downloads', run: (w) => openInternal(w, 'downloads') },
  notes: { title: 'Notes', keys: ['mod+e'], run: (w) => w.togglePanel('notes') },
  settings: { title: 'Settings', keys: ['mod+,'], run: (w) => openInternal(w, 'settings') },
  clearData: { title: 'Clear browsing data', keys: ['mod+shift+delete', 'mod+shift+backspace'], run: (w) => w.newTab({ url: 'lions://settings/#privacy' }) },

  toggleSidebar: { title: 'Show / hide sidebar', keys: ['mod+b'], run: (w) => w.toggleSidebar() },
  split: { title: 'Split view', keys: ['mod+\\'], run: (w) => w.toggleSplit() },
  swapSplit: { title: 'Swap split view sides', run: (w) => w.swapSplit() },
  fullscreen: { title: 'Full screen', keys: [pick('f11', 'ctrl+mod+f')], run: (w) => w.win.setFullScreen(!w.win.isFullScreen()) },
  devtools: { title: 'Developer tools', keys: ['f12', pick('mod+shift+i', 'mod+alt+i')], run: (w) => activeWc(w)?.toggleDevTools() },
  print: { title: 'Print…', keys: ['mod+p'], run: (w) => activeWc(w)?.print() },
  savePage: { title: 'Save page as…', keys: ['mod+s'], run: savePage },
  screenshot: { title: 'Take full-page screenshot', run: screenshot },
  copyUrl: {
    title: 'Copy page link',
    run: (w) => {
      const tab = w.activeTab();
      if (tab && !tab.url.startsWith('lions://newtab')) clipboard.writeText(tab.displayUrl);
    },
  },
  toggleAdblockSite: {
    title: 'Ad blocker: turn on/off for this site',
    run: (w) => {
      const tab = w.activeTab();
      if (!tab || !/^https?:/.test(tab.displayUrl)) return;
      adblock.toggleSite(tab.displayUrl);
      tab.reload();
    },
  },

  newWorkspace: { title: 'New workspace', run: (w) => w.openPalette('prompt', { title: 'Name your new workspace', action: 'newWorkspace', value: '' }) },
  nextWorkspace: { title: 'Next workspace', keys: [pick('alt+shift+arrowdown', 'ctrl+shift+arrowdown')], run: (w) => w.cycleWorkspace(1) },
  prevWorkspace: { title: 'Previous workspace', keys: [pick('alt+shift+arrowup', 'ctrl+shift+arrowup')], run: (w) => w.cycleWorkspace(-1) },

  themeDark: { title: 'Theme: dark', run: () => ctx.setSetting('theme', 'dark') },
  themeLight: { title: 'Theme: light', run: () => ctx.setSetting('theme', 'light') },
  themeSystem: { title: 'Theme: follow system', run: () => ctx.setSetting('theme', 'system') },
  quit: { title: 'Quit LionsBrows', keys: isMac ? [] : ['mod+shift+q'], run: () => require('electron').app.quit() },
};

function run(id, w, ...args) {
  const action = ACTIONS[id];
  if (!action || !w) return;
  try {
    const result = action.run(w, ...args);
    if (result && typeof result.catch === 'function') result.catch((err) => console.error(`[action ${id}]`, err));
  } catch (err) {
    console.error(`[action ${id}]`, err);
  }
}

function accelerator(id) {
  const key = ACTIONS[id]?.keys?.[0];
  if (!key) return undefined;
  return key
    .split('+')
    .map((p, i, all) => {
      if (p === '' && i === all.length - 1) return 'Plus';
      if (p === 'mod') return 'CmdOrCtrl';
      if (p === 'ctrl') return 'Ctrl';
      if (p === 'alt') return 'Alt';
      if (p === 'shift') return 'Shift';
      if (p === 'arrowleft') return 'Left';
      if (p === 'arrowright') return 'Right';
      if (p === 'arrowup') return 'Up';
      if (p === 'arrowdown') return 'Down';
      return p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1);
    })
    .filter(Boolean)
    .join('+');
}

function shortcutLabel(id) {
  const acc = accelerator(id);
  if (!acc) return '';
  if (!isMac) return acc.replace('CmdOrCtrl', 'Ctrl');
  return acc
    .replace('CmdOrCtrl+', '⌘')
    .replace('Ctrl+', '⌃')
    .replace('Alt+', '⌥')
    .replace('Shift+', '⇧')
    .replace(/\+/g, '');
}

module.exports = { ACTIONS, run, accelerator, shortcutLabel, openWindow, openInternal };
