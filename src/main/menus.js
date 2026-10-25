'use strict';

// Native menus: right-click on a page, on a tab, the ⋯ menu, the shield
// (ad blocker) menu, the workspace menu and the macOS application menu.

const { Menu, clipboard, dialog, app } = require('electron');
const { ctx } = require('./context');
const { engine, searchUrl } = require('./search-engines');
const omnibox = require('./omnibox');
const adblock = require('./adblock');
const workspaces = require('./workspaces');
const { run, accelerator, openWindow, openInternal } = require('./actions');

const SEP = { type: 'separator' };
const isMac = process.platform === 'darwin';

function tidy(template) {
  // Drop leading, trailing and doubled separators.
  const out = [];
  for (const item of template) {
    if (!item) continue;
    if (item.type === 'separator' && (!out.length || out[out.length - 1].type === 'separator')) continue;
    out.push(item);
  }
  while (out.length && out[out.length - 1].type === 'separator') out.pop();
  return out;
}

function popup(w, template, opts = {}) {
  const menu = Menu.buildFromTemplate(tidy(template));
  menu.popup({ window: w.win, ...opts });
}

function short(text, n = 28) {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/** Shortcut hint shown in menus; the shortcut itself is handled in shortcuts.js. */
function acc(id) {
  const a = accelerator(id);
  return a ? { accelerator: a, registerAccelerator: false } : {};
}

function pageMenu(tab, params) {
  const w = tab.owner;
  const wc = tab.wc;
  if (!wc) return;
  const engineId = ctx.settings().searchEngine;
  const t = [];

  if (params.linkURL) {
    t.push(
      { label: 'Open link in new tab', click: () => w.newTab({ url: params.linkURL, background: true, afterId: tab.id }) },
      { label: 'Open link in split view', click: () => w.openInSplit(params.linkURL) },
      { label: 'Open link in new window', click: () => openWindow({ urls: [params.linkURL] }) },
      { label: 'Open link in private window', click: () => openWindow({ isPrivate: true, urls: [params.linkURL] }) },
      SEP,
      { label: 'Copy link address', click: () => clipboard.writeText(params.linkURL) },
      SEP,
    );
  }

  if (params.mediaType === 'image' && params.srcURL) {
    t.push(
      { label: 'Open image in new tab', click: () => w.newTab({ url: params.srcURL, background: true, afterId: tab.id }) },
      { label: 'Save image as…', click: () => wc.downloadURL(params.srcURL) },
      { label: 'Copy image', click: () => wc.copyImageAt(params.x, params.y) },
      { label: 'Copy image address', click: () => clipboard.writeText(params.srcURL) },
      SEP,
    );
  }

  if (params.mediaType === 'video') {
    const x = Math.round(params.x);
    const y = Math.round(params.y);
    t.push(
      {
        label: 'Picture in picture',
        click: () =>
          wc
            .executeJavaScript(
              `(() => { const el = document.elementFromPoint(${x}, ${y}); const v = (el && (el.closest('video') || (el.querySelector && el.querySelector('video')))) || document.querySelector('video'); if (v) v.requestPictureInPicture().catch(() => {}); })()`,
              true,
            )
            .catch(() => {}),
      },
      SEP,
    );
  }

  if (params.isEditable) {
    if (params.misspelledWord) {
      for (const s of params.dictionarySuggestions.slice(0, 5)) t.push({ label: s, click: () => wc.replaceMisspelling(s) });
      t.push({ label: 'Add to dictionary', click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord) }, SEP);
    }
    const f = params.editFlags;
    t.push(
      { role: 'undo', enabled: f.canUndo },
      { role: 'redo', enabled: f.canRedo },
      SEP,
      { role: 'cut', enabled: f.canCut },
      { role: 'copy', enabled: f.canCopy },
      { role: 'paste', enabled: f.canPaste },
      { role: 'pasteAndMatchStyle', enabled: f.canPaste },
      { role: 'selectAll', enabled: f.canSelectAll },
      SEP,
    );
  } else if (params.selectionText && params.selectionText.trim()) {
    const sel = params.selectionText.trim();
    t.push({ role: 'copy' });
    const asUrl = omnibox.classify(sel, engineId);
    if (asUrl && asUrl.type === 'url' && !/\s/.test(sel)) {
      t.push({ label: `Go to ${short(sel)}`, click: () => w.newTab({ url: asUrl.url, afterId: tab.id }) });
    }
    t.push({ label: `Search ${engine(engineId).name} for “${short(sel)}”`, click: () => w.newTab({ url: searchUrl(engineId, sel), afterId: tab.id }) }, SEP);
  }

  if (!params.linkURL && !params.isEditable && !params.selectionText && params.mediaType === 'none') {
    const h = wc.navigationHistory;
    t.push(
      { label: 'Back', enabled: h.canGoBack(), click: () => tab.back() },
      { label: 'Forward', enabled: h.canGoForward(), click: () => tab.forward() },
      { label: 'Reload', click: () => tab.reload() },
      SEP,
      { label: 'Save page as…', click: () => run('savePage', w) },
      { label: 'Print…', click: () => wc.print() },
      { label: 'Take full-page screenshot', click: () => run('screenshot', w) },
      SEP,
    );
  }

  t.push({ label: 'Inspect', click: () => wc.inspectElement(params.x, params.y) });
  popup(w, t, { frame: params.frame });
}

function tabMenu(w, tabId) {
  const tab = w.tabById(tabId);
  if (!tab) return;
  const visible = w.visibleTabs().includes(tab);
  const others = ctx.workspaces().filter((ws) => ws.id !== tab.workspaceId);
  popup(w, [
    { label: 'New tab', click: () => w.newTab({ afterId: tab.id }) },
    { label: 'Reload', click: () => tab.reload() },
    { label: 'Duplicate', click: () => w.duplicateTab(tab.id) },
    { label: tab.pinned ? 'Unpin tab' : 'Pin tab', click: () => w.togglePin(tab.id) },
    { label: tab.muted ? 'Unmute tab' : 'Mute tab', click: () => tab.setMuted(!tab.muted) },
    { label: 'Open in split view', enabled: !visible, click: () => w.splitWith(tab.id) },
    { label: 'Put tab to sleep', enabled: !visible && !tab.sleeping, click: () => w.sleepTab(tab.id) },
    !w.isPrivate && others.length
      ? { label: 'Move to workspace', submenu: others.map((ws) => ({ label: `${ws.icon}  ${ws.name}`, click: () => w.moveTabToWorkspace(tab.id, ws.id) })) }
      : null,
    { label: 'Copy link', enabled: !tab.url.startsWith('lions://newtab'), click: () => clipboard.writeText(tab.displayUrl) },
    SEP,
    { label: 'Close tab', click: () => w.closeTab(tab.id) },
    { label: 'Close other tabs', click: () => w.closeOtherTabs(tab.id) },
    { label: 'Close tabs below', click: () => w.closeTabsBelow(tab.id) },
  ]);
}

function mainMenu(w, x, y) {
  const tab = w.activeTab();
  const zoom = tab?.wc ? Math.round(tab.wc.getZoomFactor() * 100) : 100;
  popup(
    w,
    [
      { label: 'New tab', ...acc('newTab'), click: () => run('newTab', w) },
      { label: 'New window', ...acc('newWindow'), click: () => run('newWindow', w) },
      { label: 'New private window', ...acc('newPrivateWindow'), click: () => run('newPrivateWindow', w) },
      { label: 'Reopen closed tab', ...acc('reopenTab'), enabled: w.closed.length > 0, click: () => run('reopenTab', w) },
      SEP,
      { label: 'History', ...acc('history'), click: () => run('history', w) },
      { label: 'Bookmarks', ...acc('bookmarksPage'), click: () => run('bookmarksPage', w) },
      { label: 'Downloads', ...acc('downloads'), click: () => run('downloads', w) },
      { label: 'Notes', ...acc('notes'), click: () => run('notes', w) },
      SEP,
      {
        label: `Zoom (${zoom}%)`,
        submenu: [
          { label: 'Zoom in', ...acc('zoomIn'), click: () => run('zoomIn', w) },
          { label: 'Zoom out', ...acc('zoomOut'), click: () => run('zoomOut', w) },
          { label: 'Reset to 100%', ...acc('zoomReset'), click: () => run('zoomReset', w) },
        ],
      },
      { label: 'Find in page…', ...acc('find'), click: () => run('find', w) },
      { label: 'Split view', ...acc('split'), type: 'checkbox', checked: Boolean(w.space().split), click: () => run('split', w) },
      {
        label: 'More tools',
        submenu: [
          { label: 'Take full-page screenshot', click: () => run('screenshot', w) },
          { label: 'Save page as…', ...acc('savePage'), click: () => run('savePage', w) },
          { label: 'Print…', ...acc('print'), click: () => run('print', w) },
          { label: 'Put background tabs to sleep', click: () => run('sleepTabs', w) },
          SEP,
          { label: 'Developer tools', ...acc('devtools'), click: () => run('devtools', w) },
        ],
      },
      SEP,
      { label: 'Settings', ...acc('settings'), click: () => run('settings', w) },
      { label: 'About LionsBrows', click: () => w.newTab({ url: 'lions://settings/#about' }) },
      isMac ? null : SEP,
      isMac ? null : { label: 'Exit', click: () => app.quit() },
    ],
    { x: Math.round(x), y: Math.round(y) },
  );
}

function shieldMenu(w, x, y) {
  const tab = w.activeTab();
  const url = tab?.displayUrl || '';
  const isWeb = /^https?:/.test(url);
  const host = adblock.hostOf(url);
  const on = ctx.settings().adblock;
  const total = ctx.config.get('stats').blocked;
  popup(
    w,
    [
      { label: isWeb ? `${tab.blocked} ads & trackers blocked on this page` : 'The ad blocker works on websites', enabled: false },
      SEP,
      isWeb
        ? {
            label: `Block ads on ${host}`,
            type: 'checkbox',
            checked: on && !adblock.isAllowlisted(url),
            enabled: on,
            click: () => {
              adblock.toggleSite(url);
              tab.reload();
            },
          }
        : null,
      { label: 'Ad blocker on all sites', type: 'checkbox', checked: on, click: () => ctx.setSetting('adblock', !on) },
      SEP,
      { label: `${total.toLocaleString('en-US')} blocked in total`, enabled: false },
      { label: 'Privacy settings…', click: () => w.newTab({ url: 'lions://settings/#privacy' }) },
    ],
    { x: Math.round(x), y: Math.round(y) },
  );
}

function workspaceMenu(w, wsId, x, y) {
  const ws = ctx.workspaces().find((s) => s.id === wsId);
  if (!ws) return;
  popup(
    w,
    [
      { label: `Switch to ${ws.name}`, enabled: w.activeWorkspaceId !== ws.id, click: () => w.switchWorkspace(ws.id) },
      { label: 'Rename…', click: () => w.openPalette('prompt', { title: 'Rename workspace', action: `renameWorkspace:${ws.id}`, value: ws.name }) },
      { label: 'Icon', submenu: workspaces.ICONS.map((icon) => ({ label: icon, type: 'radio', checked: ws.icon === icon, click: () => workspaces.setIcon(ws.id, icon) })) },
      {
        label: 'Separate logins and cookies',
        sublabel: 'Sign in to different accounts here',
        type: 'checkbox',
        checked: Boolean(ws.isolated),
        click: () => workspaces.setIsolated(ws.id, !ws.isolated),
      },
      SEP,
      { label: 'New workspace…', click: () => run('newWorkspace', w) },
      {
        label: 'Delete workspace…',
        enabled: ctx.workspaces().length > 1,
        click: async () => {
          const { response } = await dialog.showMessageBox(w.win, {
            type: 'warning',
            buttons: ['Delete', 'Cancel'],
            defaultId: 1,
            cancelId: 1,
            message: `Delete the workspace “${ws.name}”?`,
            detail: 'Its tabs will be moved to another workspace.',
          });
          if (response === 0) workspaces.remove(ws.id);
        },
      },
    ],
    { x: Math.round(x), y: Math.round(y) },
  );
}

/** The menu bar on macOS. Elsewhere the ⋯ menu replaces it. */
function installAppMenu() {
  if (!isMac) {
    Menu.setApplicationMenu(null);
    return;
  }
  const act = (id, label) => ({
    label,
    ...acc(id),
    click: () => {
      const w = ctx.lastFocusedWindow();
      if (w) run(id, w);
      else if (id === 'newTab' || id === 'newWindow') openWindow({});
      else if (id === 'newPrivateWindow') openWindow({ isPrivate: true });
    },
  });
  const template = [
    {
      role: 'appMenu',
      submenu: [{ role: 'about' }, SEP, act('settings', 'Settings…'), SEP, { role: 'services' }, SEP, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, SEP, { role: 'quit' }],
    },
    {
      label: 'File',
      submenu: [act('newTab', 'New Tab'), act('newWindow', 'New Window'), act('newPrivateWindow', 'New Private Window'), act('reopenTab', 'Reopen Closed Tab'), SEP, act('focusAddress', 'Open Location…'), act('savePage', 'Save Page As…'), act('print', 'Print…'), SEP, act('closeTab', 'Close Tab')],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [act('toggleSidebar', 'Toggle Sidebar'), act('split', 'Split View'), act('notes', 'Notes'), SEP, act('reload', 'Reload'), act('hardReload', 'Hard Reload'), SEP, act('zoomIn', 'Zoom In'), act('zoomOut', 'Zoom Out'), act('zoomReset', 'Actual Size'), SEP, act('fullscreen', 'Enter Full Screen'), act('devtools', 'Developer Tools')],
    },
    { label: 'History', submenu: [act('back', 'Back'), act('forward', 'Forward'), SEP, act('history', 'Show All History')] },
    { label: 'Bookmarks', submenu: [act('bookmark', 'Bookmark This Page'), act('bookmarksPage', 'Show All Bookmarks')] },
    { role: 'windowMenu', submenu: [{ role: 'minimize' }, { role: 'zoom' }, SEP, act('nextTab', 'Next Tab'), act('prevTab', 'Previous Tab'), SEP, { role: 'front' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { pageMenu, tabMenu, mainMenu, shieldMenu, workspaceMenu, installAppMenu, openInternal };
