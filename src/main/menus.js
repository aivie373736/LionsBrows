'use strict';

const { Menu, clipboard, dialog, app, nativeImage } = require('electron');
const { ctx } = require('./context');
const { engine, searchUrl } = require('./search-engines');
const omnibox = require('./omnibox');
const adblock = require('./adblock');
const workspaces = require('./workspaces');
const { run, accelerator, openWindow, openInternal, reopenWindow } = require('./actions');
const { tr, locale } = require('./i18n');

const SEP = { type: 'separator' };
const isMac = process.platform === 'darwin';

function tidy(template) {
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

function acc(id) {
  const a = accelerator(id);
  return a ? { accelerator: a, registerAccelerator: false } : {};
}

function highlightLink(url, text) {
  const encode = (s) => encodeURIComponent(s).replace(/-/g, '%2D');
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const fragment = words.length > 10 ? `${encode(words.slice(0, 4).join(' '))},${encode(words.slice(-4).join(' '))}` : encode(words.join(' '));
  return `${url.split('#')[0]}#:~:text=${fragment}`;
}

function pageMenu(tab, params) {
  const w = tab.owner;
  const wc = tab.wc;
  if (!wc) return;
  const engineId = ctx.settings().searchEngine;
  const t = [];

  if (params.linkURL) {
    t.push(
      { label: tr('Open link in new tab'), click: () => w.newTab({ url: params.linkURL, background: true, afterId: tab.id }) },
      { label: tr('Open link in split view'), click: () => w.openInSplit(params.linkURL) },
      { label: tr('Open link in new window'), click: () => openWindow({ urls: [params.linkURL] }) },
      { label: tr('Open link in private window'), click: () => openWindow({ isPrivate: true, urls: [params.linkURL] }) },
      SEP,
      { label: tr('Copy link address'), click: () => clipboard.writeText(params.linkURL) },
      SEP,
    );
  }

  if (params.mediaType === 'image' && params.srcURL) {
    t.push(
      { label: tr('Open image in new tab'), click: () => w.newTab({ url: params.srcURL, background: true, afterId: tab.id }) },
      { label: tr('Save image as…'), click: () => wc.downloadURL(params.srcURL) },
      { label: tr('Copy image'), click: () => wc.copyImageAt(params.x, params.y) },
      { label: tr('Copy image address'), click: () => clipboard.writeText(params.srcURL) },
      SEP,
    );
  }

  if (params.mediaType === 'video') {
    const x = Math.round(params.x);
    const y = Math.round(params.y);
    t.push(
      {
        label: tr('Picture in picture'),
        click: () =>
          wc
            .executeJavaScriptInIsolatedWorld(
              1012,
              [{ code: `(() => { const el = document.elementFromPoint(${x}, ${y}); const v = (el && (el.closest('video') || (el.querySelector && el.querySelector('video')))) || document.querySelector('video'); if (v) v.requestPictureInPicture().catch(() => {}); })()` }],
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
      t.push({ label: tr('Add to dictionary'), click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord) }, SEP);
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
      t.push({ label: tr('Go to {text}', { text: short(sel) }), click: () => w.newTab({ url: asUrl.url, afterId: tab.id }) });
    }
    t.push({ label: tr('Search {engine} for “{text}”', { engine: engine(engineId).name, text: short(sel) }), click: () => w.newTab({ url: searchUrl(engineId, sel), afterId: tab.id }) });
    if (/^https?:/.test(tab.displayUrl)) t.push({ label: tr('Copy link to highlight'), click: () => clipboard.writeText(highlightLink(tab.displayUrl, sel)) });
    t.push(SEP);
  }

  if (!params.linkURL && !params.isEditable && !params.selectionText && params.mediaType === 'none') {
    const h = wc.navigationHistory;
    t.push(
      { label: tr('Back'), enabled: h.canGoBack(), click: () => tab.back() },
      { label: tr('Forward'), enabled: h.canGoForward(), click: () => tab.forward() },
      { label: tr('Reload'), click: () => tab.reload() },
      SEP,
      { label: tr('Save page as…'), click: () => run('savePage', w) },
      { label: tr('Print…'), click: () => wc.print() },
      { label: tr('Take full-page screenshot'), click: () => run('screenshot', w) },
      SEP,
    );
  }

  const extensionItems = require('./extensions').contextMenuItems(tab, params);
  if (extensionItems.length) t.push(...extensionItems, SEP);

  t.push({ label: tr('Inspect'), click: () => wc.inspectElement(params.x, params.y) });
  popup(w, t, { frame: params.frame });
}

function tabMenu(w, tabId) {
  const tab = w.tabById(tabId);
  if (!tab) return;
  const visible = w.visibleTabs().includes(tab);
  const others = ctx.workspaces().filter((ws) => ws.id !== tab.workspaceId);
  popup(w, [
    { label: tr('New tab'), click: () => w.newTab({ afterId: tab.id }) },
    { label: tr('Reload'), click: () => tab.reload() },
    { label: tr('Duplicate'), click: () => w.duplicateTab(tab.id) },
    { label: tab.pinned ? tr('Unpin tab') : tr('Pin tab'), click: () => w.togglePin(tab.id) },
    { label: tab.muted ? tr('Unmute tab') : tr('Mute tab'), click: () => tab.setMuted(!tab.muted) },
    { label: tr('Open in split view'), enabled: !visible, click: () => w.splitWith(tab.id) },
    { label: tr('Put tab to sleep'), enabled: !visible && !tab.sleeping, click: () => w.sleepTab(tab.id) },
    !w.isPrivate && others.length
      ? { label: tr('Move to workspace'), submenu: others.map((ws) => ({ label: ws.name, click: () => w.moveTabToWorkspace(tab.id, ws.id) })) }
      : null,
    { label: tr('Copy link'), enabled: !tab.url.startsWith('lions://newtab'), click: () => clipboard.writeText(tab.displayUrl) },
    SEP,
    { label: tr('Close tab'), click: () => w.closeTab(tab.id) },
    { label: tr('Close other tabs'), click: () => w.closeOtherTabs(tab.id) },
    { label: tr('Close tabs below'), click: () => w.closeTabsBelow(tab.id) },
  ]);
}

function toolbarItems() {
  const s = ctx.settings();
  return [
    { label: tr('Split view button'), type: 'checkbox', checked: s.showSplitButton, click: () => ctx.setSetting('showSplitButton', !s.showSplitButton) },
    { label: tr('Notes button'), type: 'checkbox', checked: s.showNotesButton, click: () => ctx.setSetting('showNotesButton', !s.showNotesButton) },
    {
      label: tr('Always show downloads button'),
      type: 'checkbox',
      checked: s.downloadsButton === 'always',
      click: () => ctx.setSetting('downloadsButton', s.downloadsButton === 'always' ? 'auto' : 'always'),
    },
  ];
}

function toolbarMenu(w, x, y) {
  const s = ctx.settings();
  popup(
    w,
    [
      ...toolbarItems(),
      SEP,
      { label: tr('Bookmarks toolbar'), type: 'checkbox', checked: s.showBookmarksBar, click: () => ctx.setSetting('showBookmarksBar', !s.showBookmarksBar) },
      { label: tr('Tabs on the side'), type: 'checkbox', checked: !w.horizontal, click: () => ctx.setSetting('layout', w.horizontal ? 'vertical' : 'horizontal') },
    ],
    { x: Math.round(x), y: Math.round(y) },
  );
}

function menuIcon(dataUrl) {
  if (!dataUrl) return undefined;
  const image = nativeImage.createFromDataURL(dataUrl);
  return image.isEmpty() ? undefined : image.resize({ width: 16, height: 16, quality: 'best' });
}

function extensionsSubmenu(w) {
  const { STORE_ORIGIN } = require('./extensions');
  return {
    label: tr('Extensions'),
    submenu: [
      { label: tr('Manage extensions'), click: () => w.newTab({ url: 'lions://settings/#extensions' }) },
      { label: tr('Chrome Web Store'), click: () => w.newTab({ url: `${STORE_ORIGIN}/category/extensions` }) },
    ],
  };
}

function extensionsMenu(w, rect) {
  const extensions = require('./extensions');
  const r = { x: Number(rect.x) || 0, y: Number(rect.y) || 0, width: Number(rect.width) || 0, height: Number(rect.height) || 0 };
  const items = extensions.toolbar(w);
  popup(
    w,
    [
      ...items.map((x) => ({ label: short(x.name, 40), icon: menuIcon(x.icon), click: () => extensions.activate(w, x.id, r) })),
      SEP,
      items.length
        ? { label: tr('Show in toolbar'), submenu: items.map((x) => ({ label: short(x.name, 40), type: 'checkbox', checked: x.pinned, click: () => extensions.setPinned(x.id, !x.pinned) })) }
        : null,
      ...extensionsSubmenu(w).submenu,
    ],
    { x: Math.max(0, Math.round(r.x + r.width - 260)), y: Math.round(r.y + r.height + 4) },
  );
}

async function confirmRemoveExtension(w, id, name) {
  const { response } = await dialog.showMessageBox(w.win, {
    type: 'question',
    message: tr('Remove “{name}”?', { name }),
    buttons: [tr('Remove'), tr('Cancel')],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (response === 0) require('./extensions').remove(id);
}

function extensionMenu(w, id, x, y) {
  const extensions = require('./extensions');
  const item = extensions.toolbar(w).find((e) => e.id === id);
  if (!item) return;
  const info = extensions.list().find((e) => e.id === id);
  popup(
    w,
    [
      { label: short(item.name, 40), enabled: false },
      SEP,
      info?.options ? { label: tr('Options'), click: () => extensions.openOptions(w, id) } : null,
      { label: item.pinned ? tr('Unpin from toolbar') : tr('Pin to toolbar'), click: () => extensions.setPinned(id, !item.pinned) },
      { label: tr('Remove from LionsBrows…'), click: () => confirmRemoveExtension(w, id, item.name) },
      SEP,
      { label: tr('Manage extensions'), click: () => w.newTab({ url: 'lions://settings/#extensions' }) },
    ],
    { x: Math.round(x), y: Math.round(y) },
  );
}

function recentlyClosedSubmenu(w) {
  const tabs = w.closed.map((t, i) => ({ ...t, kind: 'tab', i }));
  const windows = w.isPrivate ? [] : ctx.closedWindows.map((x, i) => ({ ...x, kind: 'window', i }));
  const items = [...tabs, ...windows].sort((a, b) => b.at - a.at).slice(0, 12);
  return {
    label: tr('Recently closed'),
    enabled: items.length > 0,
    submenu: items.length
      ? items.map((x, n) => ({
          label: x.kind === 'tab' ? short(x.title || x.url, 48) : x.count === 1 ? tr('Window with 1 tab') : tr('Window with {n} tabs', { n: x.count }),
          ...(n === 0 ? acc('reopenTab') : {}),
          click: () => (x.kind === 'tab' ? w.reopenClosed(x.i) : reopenWindow(x.i)),
        }))
      : [{ label: tr('Recently closed'), enabled: false }],
  };
}

function workspacesSubmenu(w) {
  if (w.isPrivate) return null;
  return {
    label: tr('Workspaces'),
    submenu: [
      ...ctx.workspaces().map((ws) => ({ label: ws.name, type: 'radio', checked: ws.id === w.activeWorkspaceId, click: () => w.switchWorkspace(ws.id) })),
      SEP,
      { label: tr('New workspace…'), click: () => run('newWorkspace', w) },
    ],
  };
}

function updateItem() {
  const u = require('./updater').state();
  if (u.status === 'ready') return { label: tr('Restart to update to {version}', u), click: () => require('./updater').install() };
  if (u.status === 'available') return { label: tr('Download LionsBrows {version}', u), click: () => require('./updater').install() };
  return null;
}

function mainMenu(w, x, y) {
  const tab = w.activeTab();
  const zoom = tab?.wc ? Math.round(tab.wc.getZoomFactor() * 100) : 100;
  const update = updateItem();
  popup(
    w,
    [
      update,
      update ? SEP : null,
      { label: tr('New tab'), ...acc('newTab'), click: () => run('newTab', w) },
      { label: tr('New window'), ...acc('newWindow'), click: () => run('newWindow', w) },
      { label: tr('New private window'), ...acc('newPrivateWindow'), click: () => run('newPrivateWindow', w) },
      recentlyClosedSubmenu(w),
      SEP,
      { label: tr('History'), ...acc('history'), click: () => run('history', w) },
      { label: tr('Bookmarks'), ...acc('bookmarksPage'), click: () => run('bookmarksPage', w) },
      { label: tr('Downloads'), ...acc('downloads'), click: () => run('downloads', w) },
      { label: tr('Notes'), ...acc('notes'), click: () => run('notes', w) },
      w.isPrivate ? null : extensionsSubmenu(w),
      workspacesSubmenu(w),
      SEP,
      {
        label: tr('Zoom ({zoom}%)', { zoom }),
        submenu: [
          { label: tr('Zoom in'), ...acc('zoomIn'), click: () => run('zoomIn', w) },
          { label: tr('Zoom out'), ...acc('zoomOut'), click: () => run('zoomOut', w) },
          { label: tr('Reset to 100%'), ...acc('zoomReset'), click: () => run('zoomReset', w) },
        ],
      },
      { label: tr('Find in page…'), ...acc('find'), click: () => run('find', w) },
      { label: tr('Split view'), ...acc('split'), type: 'checkbox', checked: Boolean(w.space().split), click: () => run('split', w) },
      {
        label: tr('More tools'),
        submenu: [
          { label: tr('Take full-page screenshot'), click: () => run('screenshot', w) },
          { label: tr('Save page as…'), ...acc('savePage'), click: () => run('savePage', w) },
          { label: tr('Print…'), ...acc('print'), click: () => run('print', w) },
          { label: tr('Put background tabs to sleep'), click: () => run('sleepTabs', w) },
          SEP,
          { label: tr('Developer tools'), ...acc('devtools'), click: () => run('devtools', w) },
        ],
      },
      SEP,
      {
        label: tr('Customize'),
        submenu: [
          { label: tr('Tabs on the side'), type: 'checkbox', checked: !w.horizontal, click: () => ctx.setSetting('layout', w.horizontal ? 'vertical' : 'horizontal') },
          { label: tr('Bookmarks toolbar'), type: 'checkbox', checked: ctx.settings().showBookmarksBar, click: () => ctx.setSetting('showBookmarksBar', !ctx.settings().showBookmarksBar) },
          SEP,
          ...toolbarItems(),
          SEP,
          { label: tr('Colors and background…'), click: () => w.newTab({ url: 'lions://settings/#appearance' }) },
        ],
      },
      { label: tr('Settings'), ...acc('settings'), click: () => run('settings', w) },
      { label: tr('About LionsBrows'), click: () => w.newTab({ url: 'lions://settings/#about' }) },
      isMac ? null : SEP,
      isMac ? null : { label: tr('Exit'), click: () => app.quit() },
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
      { label: isWeb ? tr('{n} ads & trackers blocked on this page', { n: tab.blocked }) : tr('The ad blocker works on websites'), enabled: false },
      SEP,
      isWeb
        ? {
            label: tr('Block ads on {host}', { host }),
            type: 'checkbox',
            checked: on && !adblock.isAllowlisted(url),
            enabled: on,
            click: () => {
              adblock.toggleSite(url);
              tab.reload();
            },
          }
        : null,
      { label: tr('Ad blocker on all sites'), type: 'checkbox', checked: on, click: () => ctx.setSetting('adblock', !on) },
      SEP,
      { label: tr('{n} blocked in total', { n: total.toLocaleString(locale()) }), enabled: false },
      { label: tr('Privacy settings…'), click: () => w.newTab({ url: 'lions://settings/#privacy' }) },
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
      { label: tr('Switch to {name}', { name: ws.name }), enabled: w.activeWorkspaceId !== ws.id, click: () => w.switchWorkspace(ws.id) },
      { label: tr('Rename…'), click: () => w.openPalette('prompt', { title: tr('Rename workspace'), action: `renameWorkspace:${ws.id}`, value: ws.name }) },
      { label: tr('Color'), submenu: Object.entries(workspaces.COLOR_NAMES).map(([color, name]) => ({ label: tr(name), type: 'radio', checked: ws.color === color, click: () => workspaces.setColor(ws.id, color) })) },
      {
        label: tr('Separate logins and cookies'),
        sublabel: tr('Sign in to different accounts here'),
        type: 'checkbox',
        checked: Boolean(ws.isolated),
        click: () => workspaces.setIsolated(ws.id, !ws.isolated),
      },
      SEP,
      { label: tr('New workspace…'), click: () => run('newWorkspace', w) },
      {
        label: tr('Delete workspace…'),
        enabled: ctx.workspaces().length > 1,
        click: async () => {
          const { response } = await dialog.showMessageBox(w.win, {
            type: 'warning',
            buttons: [tr('Delete'), tr('Cancel')],
            defaultId: 1,
            cancelId: 1,
            message: tr('Delete the workspace “{name}”?', { name: ws.name }),
            detail: tr('Its tabs will be moved to another workspace.'),
          });
          if (response === 0) workspaces.remove(ws.id);
        },
      },
    ],
    { x: Math.round(x), y: Math.round(y) },
  );
}

function workspaceSwitcher(w, x, y) {
  const current = ctx.workspace(w.activeWorkspaceId);
  popup(
    w,
    [
      ...ctx.workspaces().map((ws) => ({
        label: ws.name,
        type: 'radio',
        checked: ws.id === w.activeWorkspaceId,
        click: () => w.switchWorkspace(ws.id),
      })),
      SEP,
      { label: tr('New workspace…'), click: () => run('newWorkspace', w) },
      { label: tr('Rename “{name}”…', { name: current.name }), click: () => w.openPalette('prompt', { title: tr('Rename workspace'), action: `renameWorkspace:${current.id}`, value: current.name }) },
      { label: tr('Color'), submenu: Object.entries(workspaces.COLOR_NAMES).map(([color, name]) => ({ label: tr(name), type: 'radio', checked: current.color === color, click: () => workspaces.setColor(current.id, color) })) },
      {
        label: tr('Separate logins and cookies'),
        type: 'checkbox',
        checked: Boolean(current.isolated),
        click: () => workspaces.setIsolated(current.id, !current.isolated),
      },
      {
        label: tr('Delete “{name}”…', { name: current.name }),
        enabled: ctx.workspaces().length > 1,
        click: async () => {
          const { response } = await dialog.showMessageBox(w.win, {
            type: 'warning',
            buttons: [tr('Delete'), tr('Cancel')],
            defaultId: 1,
            cancelId: 1,
            message: tr('Delete the workspace “{name}”?', { name: current.name }),
            detail: tr('Its tabs will be moved to another workspace.'),
          });
          if (response === 0) workspaces.remove(current.id);
        },
      },
    ],
    { x: Math.round(x), y: Math.round(y) },
  );
}

function allTabsMenu(w, x, y) {
  const tabs = w.space().tabs;
  popup(
    w,
    tabs.map((t) => ({
      label: short(t.title || t.displayUrl || tr('New Tab'), 60),
      type: 'checkbox',
      checked: t.id === w.space().activeId,
      click: () => w.activate(t.id),
    })),
    { x: Math.round(x), y: Math.round(y) },
  );
}

function passwordMenu(w, x, y) {
  const tab = w.activeTab();
  const saved = require('./logins').savedFor(tab);
  popup(
    w,
    [
      ...saved.map((l) => ({ label: l.username || tr('(no username)'), click: () => require('./logins').fill(tab, l.id) })),
      saved.length ? SEP : null,
      { label: tr('Manage passwords'), click: () => w.newTab({ url: 'lions://settings/#passwords' }) },
    ],
    { x: Math.round(x), y: Math.round(y) },
  );
}

function bookmarkMenu(w, id) {
  const b = require('./bookmarks')
    .all()
    .find((x) => x.id === id);
  if (!b) return;
  popup(w, [
    { label: tr('Open in new tab'), click: () => w.newTab({ url: b.url, background: true, afterId: w.space().activeId }) },
    { label: tr('Open in split view'), click: () => w.openInSplit(b.url) },
    { label: tr('Open in private window'), click: () => openWindow({ isPrivate: true, urls: [b.url] }) },
    SEP,
    { label: tr('Copy link'), click: () => clipboard.writeText(b.url) },
    { label: tr('Delete bookmark'), click: () => require('./bookmarks').remove(b.id) },
    SEP,
    { label: tr('Manage bookmarks'), click: () => openInternal(w, 'bookmarks') },
    { label: tr('Hide bookmarks toolbar'), click: () => ctx.setSetting('showBookmarksBar', false) },
  ]);
}

function installAppMenu() {
  if (!isMac) {
    Menu.setApplicationMenu(null);
    return;
  }
  const act = (id, label) => ({
    label: tr(label),
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
      label: tr('File'),
      submenu: [act('newTab', 'New Tab'), act('newWindow', 'New Window'), act('newPrivateWindow', 'New Private Window'), act('reopenTab', 'Reopen Closed Tab'), SEP, act('focusAddress', 'Open Location…'), act('savePage', 'Save Page As…'), act('print', 'Print…'), SEP, act('closeTab', 'Close Tab')],
    },
    { role: 'editMenu' },
    {
      label: tr('View'),
      submenu: [act('toggleSidebar', 'Toggle Sidebar'), act('split', 'Split View'), act('notes', 'Notes'), SEP, act('reload', 'Reload'), act('hardReload', 'Hard Reload'), SEP, act('zoomIn', 'Zoom In'), act('zoomOut', 'Zoom Out'), act('zoomReset', 'Actual Size'), SEP, act('fullscreen', 'Enter Full Screen'), act('devtools', 'Developer Tools')],
    },
    { label: tr('History'), submenu: [act('back', 'Back'), act('forward', 'Forward'), SEP, act('history', 'Show All History')] },
    { label: tr('Bookmarks'), submenu: [act('bookmark', 'Bookmark This Page'), act('bookmarksPage', 'Show All Bookmarks')] },
    { role: 'windowMenu', submenu: [{ role: 'minimize' }, { role: 'zoom' }, SEP, act('nextTab', 'Next Tab'), act('prevTab', 'Previous Tab'), SEP, { role: 'front' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { highlightLink, pageMenu, tabMenu, mainMenu, toolbarMenu, extensionMenu, extensionsMenu, passwordMenu, shieldMenu, workspaceMenu, workspaceSwitcher, allTabsMenu, bookmarkMenu, installAppMenu, openInternal };
