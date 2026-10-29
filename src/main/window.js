'use strict';

const path = require('node:path');
const { BaseWindow, WebContentsView, nativeTheme, screen } = require('electron');
const { ctx } = require('./context');
const { Tab, NEWTAB } = require('./tab');
const omnibox = require('./omnibox');
const adblock = require('./adblock');
const downloads = require('./downloads');
const bookmarks = require('./bookmarks');
const i18n = require('./i18n');

const UI_PRELOAD = path.join(__dirname, '..', 'preload', 'ui.js');
const UI_HTML = path.join(__dirname, '..', 'ui', 'index.html');
const OVERLAY_HTML = path.join(__dirname, '..', 'ui', 'overlay.html');
const BUBBLE_HTML = path.join(__dirname, '..', 'ui', 'bubble.html');
const BUBBLE_W = 388;
const SITE_W = 392;
const ICON = path.join(__dirname, '..', 'shared', 'icon.png');

const VERTICAL = { toolbar: 48, sidebar: 252, sidebarCollapsed: 60, panel: 340, find: 44, gap: 8, radius: 8 };
const HORIZONTAL = { tabstrip: 40, navbar: 44, panel: 340, find: 44, gap: 8, radius: 10 };
const BOOKMARKS_H = 30;

const COLORS = {
  dark: { bg: '#1c1b21', fg: '#fbfbfe' },
  light: { bg: '#efeef3', fg: '#15141a' },
  private: { bg: '#1f1630', fg: '#f6f2ff' },
};

function liveContents(view) {
  const wc = view && view.webContents;
  return wc && !wc.isDestroyed() ? wc : null;
}

function readableOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum > 150 ? '#15141a' : '#fbfbfe';
}

let privateCounter = 0;

function onSomeDisplay(b) {
  return screen.getAllDisplays().some(({ workArea: a }) => b.x < a.x + a.width - 50 && b.x + b.width > a.x + 50 && b.y >= a.y - 10 && b.y < a.y + a.height - 50);
}

class BrowserWin {
  constructor({ isPrivate = false, restore = null, urls = [], full = false } = {}) {
    this.isPrivate = isPrivate;
    this.privateId = isPrivate ? ++privateCounter : 0;
    this.focusedAt = Date.now();
    this.spaces = new Map();
    this.tabsById = new Map();
    this.attached = new Set();
    this.closed = [];
    this.panel = null;
    this.find = { open: false, query: '', matches: 0, active: 0 };
    this.htmlFullscreenTab = null;
    this.wasFullscreen = false;
    this.overlay = null;
    this.overlayOpen = false;
    this.bubble = null;
    if (this.bubbleKind === 'site') this.siteHiddenAt = Date.now();
    this.bubbleOpen = false;
    this.bubbleTab = null;
    this.bubbleKind = null;
    this.bubbleHeight = 220;
    this.bubbleKind = null;
    this.siteAnchor = null;
    this.addressAnchor = null;
    this.statePending = false;
    this.forget = false;
    this.lastArea = { x: 0, y: 0, width: 800, height: 600 };
    this.activeWorkspaceId = isPrivate ? 'private' : ctx.workspace(restore?.activeWorkspaceId)?.id || ctx.workspaces()[0].id;

    this.#createWindow(restore);
    ctx.windows.add(this);

    if (restore && !isPrivate) this.#restore(restore, full);
    for (const url of urls) this.newTab({ url });
    if (!this.space().tabs.length) this.newTab();
    else if (!urls.length) this.activate(this.space().activeId || this.space().tabs[0].id);
  }

  #colors() {
    if (this.isPrivate) return COLORS.private;
    const frame = ctx.settings().frameColor;
    if (frame) return { bg: frame, fg: readableOn(frame) };
    return nativeTheme.shouldUseDarkColors ? COLORS.dark : COLORS.light;
  }

  get horizontal() {
    return ctx.settings().layout !== 'vertical';
  }

  #titlebarHeight() {
    return this.horizontal ? HORIZONTAL.tabstrip : VERTICAL.toolbar;
  }

  #trafficLights() {
    return this.horizontal ? { x: 13, y: 13 } : { x: 16, y: 17 };
  }

  #createWindow(restore) {
    const c = this.#colors();
    const bounds = restore?.bounds;
    const opts = {
      width: bounds?.width || 1320,
      height: bounds?.height || 860,
      minWidth: 560,
      minHeight: 380,
      show: false,
      title: this.isPrivate ? `LionsBrows (${i18n.tr('Private')})` : 'LionsBrows',
      backgroundColor: c.bg,
      titleBarStyle: 'hidden',
      icon: ICON,
    };
    if (bounds && onSomeDisplay(bounds)) Object.assign(opts, { x: bounds.x, y: bounds.y });
    if (process.platform === 'darwin') opts.trafficLightPosition = this.#trafficLights();
    else opts.titleBarOverlay = { color: c.bg, symbolColor: c.fg, height: this.#titlebarHeight() };

    this.win = new BaseWindow(opts);
    if (restore?.maximized) this.win.maximize();

    this.ui = new WebContentsView({ webPreferences: { preload: UI_PRELOAD, sandbox: true, contextIsolation: true, spellcheck: false } });
    this.ui.setBackgroundColor(c.bg);
    this.win.contentView.addChildView(this.ui);
    this.ui.webContents.loadFile(UI_HTML, { query: { private: this.isPrivate ? '1' : '0', platform: process.platform, lang: i18n.lang() } });
    this.ui.webContents.on('before-input-event', (event, input) => require('./shortcuts').handle(this, input, event));
    this.ui.webContents.once('did-finish-load', () => this.#show());
    setTimeout(() => this.#show(), 2500);

    this.win.on('resize', () => this.layout());
    this.win.on('enter-full-screen', () => this.layout());
    this.win.on('leave-full-screen', () => this.layout());
    this.win.on('focus', () => {
      this.focusedAt = Date.now();
    });
    this.win.on('close', () => this.#onClose());
    this.win.on('closed', () => this.#onClosed());
    this.layout();
  }

  #show() {
    if (this.shown || this.win.isDestroyed()) return;
    this.shown = true;
    this.win.show();
    this.focusActive();
  }

  applyTheme() {
    const c = this.#colors();
    this.ui.setBackgroundColor(c.bg);
    if (process.platform === 'darwin') this.win.setWindowButtonPosition?.(this.#trafficLights());
    else this.win.setTitleBarOverlay?.({ color: c.bg, symbolColor: c.fg, height: this.#titlebarHeight() });
    this.layout();
    this.scheduleState();
  }

  #onClose() {
    if (this.isPrivate) return;
    const normal = [...ctx.windows].filter((w) => !w.isPrivate);
    if (!ctx.quitting && normal.length > 1) {
      this.forget = true;
      const count = this.allTabs().filter((t) => !t.url.startsWith(NEWTAB)).length;
      if (count) {
        ctx.closedWindows.push({ at: Date.now(), count, state: this.serialize() });
        if (ctx.closedWindows.length > 5) ctx.closedWindows.shift();
      }
    }
    require('./session').saveNow();
  }

  #onClosed() {
    ctx.windows.delete(this);
    for (const tab of this.tabsById.values()) tab.destroy();
    this.tabsById.clear();
    for (const view of [this.ui, this.overlay, this.bubble]) liveContents(view)?.close();
    if (this.isPrivate) {
      const ses = require('electron').session.fromPartition(ctx.partitionFor(null, true, this.privateId));
      ses.clearStorageData().catch(() => {});
      ses.clearCache().catch(() => {});
    }
  }

  ownsWebContents(wc) {
    if (!wc) return false;
    if (wc === this.ui.webContents || wc === this.overlay?.webContents || wc === this.bubble?.webContents) return true;
    for (const t of this.tabsById.values()) if (t.wc === wc) return true;
    return false;
  }

  space(id = this.activeWorkspaceId) {
    let s = this.spaces.get(id);
    if (!s) {
      s = { tabs: [], activeId: null, split: null };
      this.spaces.set(id, s);
    }
    return s;
  }

  allTabs() {
    return [...this.tabsById.values()];
  }

  tabById(id) {
    return this.tabsById.get(id) || null;
  }

  activeTab() {
    return this.tabById(this.space().activeId);
  }

  visibleTabs() {
    const s = this.space();
    if (s.split) {
      const a = this.tabById(s.split.a);
      const b = this.tabById(s.split.b);
      if (a && b) return [a, b];
      s.split = null;
    }
    const t = this.tabById(s.activeId);
    return t ? [t] : [];
  }

  #restore(saved, full = false) {
    const startup = full ? 'restore' : ctx.settings().startup;
    for (const [wsId, data] of Object.entries(saved.spaces || {})) {
      if (!ctx.workspaces().some((w) => w.id === wsId)) continue;
      const s = this.space(wsId);
      const tabs = (data.tabs || []).filter((t) => startup === 'restore' || t.pinned);
      for (const t of tabs) {
        const tab = new Tab(this, { ...t, workspaceId: wsId });
        s.tabs.push(tab);
        this.tabsById.set(tab.id, tab);
      }
      if (startup === 'restore') {
        s.activeId = s.tabs[data.activeIndex]?.id ?? s.tabs[0]?.id ?? null;
        if (data.split && s.tabs[data.split[0]] && s.tabs[data.split[1]]) {
          s.split = { a: s.tabs[data.split[0]].id, b: s.tabs[data.split[1]].id, ratio: data.split[2] || 0.5 };
        }
      } else {
        s.activeId = s.tabs[0]?.id ?? null;
      }
    }
  }

  newTab({ url = NEWTAB, background = false, workspaceId = this.activeWorkspaceId, afterId = null, adopt = null, pinned = false, typed = false } = {}) {
    const s = this.space(workspaceId);
    const tab = new Tab(this, { url, workspaceId, webContents: adopt, openerId: afterId, pinned });
    let index = s.tabs.length;
    if (afterId) {
      const i = s.tabs.findIndex((t) => t.id === afterId);
      if (i >= 0) {
        index = i + 1;
        while (index < s.tabs.length && s.tabs[index].openerId === afterId) index++;
      }
    }
    s.tabs.splice(index, 0, tab);
    this.tabsById.set(tab.id, tab);
    this.#sortPinned(s);
    tab.typed = typed;

    if (background || workspaceId !== this.activeWorkspaceId) {
      if (!adopt) tab.ensureView();
      tab.view.setBounds(this.lastArea);
      this.scheduleState();
      require('./memory').schedule();
    } else {
      this.activate(tab.id);
    }
    this.scheduleSave();
    return tab;
  }

  activate(id) {
    const tab = this.tabById(id);
    if (!tab) return;
    if (tab.workspaceId !== this.activeWorkspaceId) {
      this.activeWorkspaceId = tab.workspaceId;
    }
    const s = this.space();
    if (s.split && tab.id !== s.split.a && tab.id !== s.split.b) s.split = null;
    const prev = this.tabById(s.activeId);
    if (prev && prev !== tab) prev.lastActive = Date.now();
    s.activeId = tab.id;
    tab.lastActive = Date.now();
    if (this.find.open) this.closeFind(false);
    if (this.bubbleOpen && this.bubbleTab !== tab.id) this.hideBubble(false);
    this.layout();
    require('./extensions').selected(tab);
    if (!this.overlayOpen) this.focusActive();
    this.scheduleState();
    this.scheduleSave();
    require('./memory').schedule();
  }

  focusActive() {
    const t = this.activeTab();
    if (t?.wc && !this.win.isDestroyed()) t.wc.focus();
  }

  tabFocused(tab) {
    const s = this.space(tab.workspaceId);
    if (s.split && (s.split.a === tab.id || s.split.b === tab.id) && s.activeId !== tab.id) {
      s.activeId = tab.id;
      this.scheduleState();
    }
  }

  closeTab(id) {
    const tab = this.tabById(id);
    if (!tab) return;
    const s = this.space(tab.workspaceId);
    const idx = s.tabs.indexOf(tab);
    if (!tab.url.startsWith(NEWTAB)) {
      this.closed.push({ ...tab.serialize(), workspaceId: tab.workspaceId, index: idx, at: Date.now() });
      if (this.closed.length > 25) this.closed.shift();
    }
    s.tabs.splice(idx, 1);
    this.tabsById.delete(id);
    if (this.bubbleTab === id) this.hideBubble(false);
    if (this.htmlFullscreenTab === tab) this.setHtmlFullscreen(tab, false);

    if (s.split && (s.split.a === id || s.split.b === id)) {
      const other = s.split.a === id ? s.split.b : s.split.a;
      s.split = null;
      if (s.activeId === id) s.activeId = other;
    }
    if (s.activeId === id) {
      const opener = tab.openerId && s.tabs.find((t) => t.id === tab.openerId);
      const next = opener && Date.now() - tab.lastActive < 1000 ? opener : s.tabs[idx] || s.tabs[idx - 1];
      s.activeId = next ? next.id : null;
    }
    tab.destroy();

    if (!s.tabs.length) {
      const othersHaveTabs = [...this.spaces.values()].some((o) => o !== s && o.tabs.length);
      if (!othersHaveTabs && tab.workspaceId === this.activeWorkspaceId) {
        this.win.close();
        return;
      }
      this.newTab({ workspaceId: tab.workspaceId, background: tab.workspaceId !== this.activeWorkspaceId });
      return;
    }
    if (tab.workspaceId === this.activeWorkspaceId) this.activate(s.activeId);
    else this.scheduleState();
    this.scheduleSave();
  }

  tabDestroyed(tab) {
    if (this.tabsById.has(tab.id)) this.closeTab(tab.id);
  }

  closeOtherTabs(id) {
    const tab = this.tabById(id);
    if (!tab) return;
    for (const t of [...this.space(tab.workspaceId).tabs]) if (t !== tab && !t.pinned) this.closeTab(t.id);
  }

  closeTabsBelow(id) {
    const tab = this.tabById(id);
    if (!tab) return;
    const tabs = this.space(tab.workspaceId).tabs;
    for (const t of tabs.slice(tabs.indexOf(tab) + 1)) if (!t.pinned) this.closeTab(t.id);
  }

  reopenClosed(index = this.closed.length - 1) {
    const [last] = this.closed.splice(index, 1);
    if (!last) return;
    const workspaceId = ctx.workspaces().some((w) => w.id === last.workspaceId) || this.isPrivate ? last.workspaceId : this.activeWorkspaceId;
    const tab = this.newTab({ url: last.url, workspaceId, pinned: last.pinned });
    const s = this.space(workspaceId);
    s.tabs.splice(s.tabs.indexOf(tab), 1);
    s.tabs.splice(Math.min(last.index, s.tabs.length), 0, tab);
    this.#sortPinned(s);
    this.scheduleState();
  }

  duplicateTab(id) {
    const tab = this.tabById(id);
    if (tab) this.newTab({ url: tab.displayUrl, afterId: id, workspaceId: tab.workspaceId });
  }

  #sortPinned(s) {
    s.tabs.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  }

  togglePin(id) {
    const tab = this.tabById(id);
    if (!tab) return;
    tab.pinned = !tab.pinned;
    const s = this.space(tab.workspaceId);
    s.tabs.splice(s.tabs.indexOf(tab), 1);
    const firstUnpinned = s.tabs.findIndex((t) => !t.pinned);
    s.tabs.splice(firstUnpinned === -1 ? s.tabs.length : firstUnpinned, 0, tab);
    this.scheduleState();
    this.scheduleSave();
  }

  moveTab(id, beforeId, pinned) {
    const tab = this.tabById(id);
    if (!tab) return;
    const s = this.space(tab.workspaceId);
    s.tabs.splice(s.tabs.indexOf(tab), 1);
    if (typeof pinned === 'boolean') tab.pinned = pinned;
    let idx = beforeId ? s.tabs.findIndex((t) => t.id === beforeId) : -1;
    if (idx === -1) {
      const lastOfSection = s.tabs.map((t) => t.pinned).lastIndexOf(tab.pinned);
      idx = tab.pinned ? lastOfSection + 1 : s.tabs.length;
    }
    s.tabs.splice(idx, 0, tab);
    this.#sortPinned(s);
    this.scheduleState();
    this.scheduleSave();
  }

  sleepTab(id) {
    const tab = this.tabById(id);
    if (!tab || this.visibleTabs().includes(tab)) return;
    tab.sleep();
  }

  rebuildTab(tab) {
    if (!tab.view) return;
    tab.audible = false;
    tab.sleep();
    this.layout();
  }

  sleepOtherTabs() {
    const visible = this.visibleTabs();
    for (const t of this.allTabs()) if (!visible.includes(t)) t.sleep();
  }

  tabChanged(tab) {
    this.scheduleState();
    if (tab.workspaceId === this.activeWorkspaceId) this.scheduleSave();
  }

  detachView(view) {
    if (!this.attached.has(view)) return;
    this.attached.delete(view);
    if (!this.win.isDestroyed()) this.win.contentView.removeChildView(view);
  }

  switchWorkspace(id) {
    if (this.isPrivate || !ctx.workspaces().some((w) => w.id === id) || id === this.activeWorkspaceId) return;
    const prev = this.activeTab();
    if (prev) prev.lastActive = Date.now();
    this.closeFind(false);
    this.activeWorkspaceId = id;
    const s = this.space();
    if (!s.tabs.length) return void this.newTab();
    this.activate(s.activeId || s.tabs[0].id);
  }

  cycleWorkspace(dir) {
    const list = ctx.workspaces();
    const i = list.findIndex((w) => w.id === this.activeWorkspaceId);
    this.switchWorkspace(list[(i + dir + list.length) % list.length].id);
  }

  moveTabToWorkspace(id, wsId) {
    const tab = this.tabById(id);
    if (!tab || tab.workspaceId === wsId || !ctx.workspaces().some((w) => w.id === wsId)) return;
    const from = this.space(tab.workspaceId);
    const wasActive = from.activeId === tab.id;
    const oldPartition = tab.partition;
    from.tabs.splice(from.tabs.indexOf(tab), 1);
    if (from.split && (from.split.a === id || from.split.b === id)) from.split = null;
    if (wasActive) from.activeId = from.tabs[0]?.id ?? null;
    this.detachView(tab.view);
    tab.workspaceId = wsId;
    const to = this.space(wsId);
    to.tabs.push(tab);
    this.#sortPinned(to);
    if (!to.activeId) to.activeId = tab.id;
    if (tab.partition !== oldPartition && tab.view) {
      tab.audible = false;
      tab.sleep();
    }
    if (!from.tabs.length) this.newTab({ workspaceId: from === this.space() ? this.activeWorkspaceId : tab.workspaceId, background: from !== this.space() });
    if (wasActive && from === this.space() && from.activeId) this.activate(from.activeId);
    this.layout();
    this.scheduleState();
    this.scheduleSave();
  }

  toggleSplit() {
    const s = this.space();
    if (s.split) {
      s.split = null;
    } else {
      const active = this.activeTab();
      if (!active) return;
      const partner = s.tabs.filter((t) => t !== active).sort((a, b) => b.lastActive - a.lastActive)[0] || this.newTab({ background: true });
      s.split = { a: active.id, b: partner.id, ratio: 0.5 };
    }
    this.layout();
    this.focusActive();
    this.scheduleState();
    this.scheduleSave();
  }

  splitWith(tabId) {
    const s = this.space();
    const active = this.activeTab();
    const other = this.tabById(tabId);
    if (!active || !other || active === other || other.workspaceId !== this.activeWorkspaceId) return;
    s.split = { a: active.id, b: other.id, ratio: 0.5 };
    this.layout();
    this.scheduleState();
  }

  openInSplit(url) {
    const tab = this.newTab({ url, background: true, afterId: this.space().activeId });
    this.splitWith(tab.id);
  }

  swapSplit() {
    const s = this.space();
    if (!s.split) return;
    s.split = { a: s.split.b, b: s.split.a, ratio: 1 - s.split.ratio };
    this.layout();
    this.scheduleState();
  }

  setSplitRatio(ratio) {
    const s = this.space();
    if (!s.split) return;
    s.split.ratio = Math.min(0.85, Math.max(0.15, Number(ratio) || 0.5));
    this.layout();
    this.scheduleState();
  }

  #paneRects(width, height) {
    const s = ctx.settings();
    const bookmarksBar = s.showBookmarksBar ? BOOKMARKS_H : 0;
    let area;
    let gap;
    if (this.horizontal) {
      const top = HORIZONTAL.tabstrip + HORIZONTAL.navbar + bookmarksBar;
      const right = this.panel ? HORIZONTAL.panel : HORIZONTAL.gap;
      const bottom = HORIZONTAL.gap + (this.find.open ? HORIZONTAL.find : 0);
      area = { x: HORIZONTAL.gap, y: top, width: Math.max(50, width - HORIZONTAL.gap - right), height: Math.max(50, height - top - bottom) };
      gap = HORIZONTAL.gap;
    } else {
      const left = s.sidebarCollapsed ? VERTICAL.sidebarCollapsed : VERTICAL.sidebar;
      const top = VERTICAL.toolbar + bookmarksBar;
      const right = this.panel ? VERTICAL.panel : VERTICAL.gap;
      const bottom = VERTICAL.gap + (this.find.open ? VERTICAL.find : 0);
      area = { x: left, y: top, width: Math.max(50, width - left - right), height: Math.max(50, height - top - bottom) };
      gap = VERTICAL.gap;
    }
    this.lastArea = area;
    const visible = this.visibleTabs();
    if (visible.length === 2) {
      const w1 = Math.round((area.width - gap) * this.space().split.ratio);
      return [
        [visible[0], { x: area.x, y: area.y, width: w1, height: area.height }],
        [visible[1], { x: area.x + w1 + gap, y: area.y, width: area.width - w1 - gap, height: area.height }],
      ];
    }
    return visible.map((t) => [t, area]);
  }

  layout() {
    if (!this.win || this.win.isDestroyed()) return;
    const [width, height] = this.win.getContentSize();
    this.ui.setBounds({ x: 0, y: 0, width, height });

    const fs = this.htmlFullscreenTab;
    const rects = new Map(fs && fs.workspaceId === this.activeWorkspaceId ? [[fs, { x: 0, y: 0, width, height }]] : this.#paneRects(width, height));
    this.panes = [...rects].map(([t, r]) => ({ tabId: t.id, ...r }));

    let added = false;
    for (const tab of this.tabsById.values()) {
      const r = rects.get(tab);
      if (r) {
        const view = tab.ensureView();
        if (!this.attached.has(view)) {
          this.win.contentView.addChildView(view);
          this.attached.add(view);
          added = true;
        }
        view.setBounds(r);
        view.setBorderRadius?.(fs ? 0 : VERTICAL.radius);
      } else if (tab.view) {
        this.detachView(tab.view);
      }
    }
    if (this.bubbleOpen) {
      if (added) {
        this.win.contentView.removeChildView(this.bubble);
        this.win.contentView.addChildView(this.bubble);
      }
      const anchor = this.addressAnchor || { right: width - 8, bottom: this.lastArea.y };
      const site = this.bubbleKind === 'site' && this.siteAnchor;
      const w = site ? SITE_W : BUBBLE_W;
      const x = Math.max(8, Math.min(width - w - 8, site ? this.siteAnchor.x - 16 : anchor.right - w + 12));
      const y = (site ? this.siteAnchor.bottom : anchor.bottom) + 2;
      this.bubble.setBounds({ x, y, width: w, height: Math.min(this.bubbleHeight, height - y - 8) });
    }
    if (this.overlayOpen) {
      if (added || this.bubbleOpen) {
        this.win.contentView.removeChildView(this.overlay);
        this.win.contentView.addChildView(this.overlay);
      }
      this.overlay.setBounds({ x: 0, y: 0, width, height });
    }
  }

  #ensureBubble() {
    if (this.bubble) return this.bubbleReady;
    this.bubble = new WebContentsView({ webPreferences: { preload: UI_PRELOAD, sandbox: true, contextIsolation: true, transparent: true, spellcheck: false } });
    this.bubble.setBackgroundColor('#00000000');
    this.bubbleReady = new Promise((resolve) => this.bubble.webContents.once('did-finish-load', resolve));
    this.bubble.webContents.loadFile(BUBBLE_HTML, { query: { platform: process.platform, lang: i18n.lang() } });
    this.bubble.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        event.preventDefault();
        this.hideBubble();
      }
    });
    this.bubble.webContents.on('blur', () => {
      if (this.bubbleOpen && this.bubbleKind === 'site') setTimeout(() => this.bubbleKind === 'site' && !this.bubble.webContents.isFocused() && this.hideBubble(false), 120);
    });
    return this.bubbleReady;
  }

  #openBubble(tab, kind) {
    if (!this.bubbleOpen) {
      this.win.contentView.addChildView(this.bubble);
      this.bubbleOpen = true;
    }
    this.bubbleKind = kind;
    this.bubbleTab = tab.id;
    this.layout();
  }

  async showSiteBubble(rect = {}) {
    const tab = this.activeTab();
    const url = tab?.wc ? tab.displayUrl : '';
    if (!/^https?:/.test(url)) return;
    const { host, origin, protocol } = new URL(url);
    const domain = require('tldts').getDomain(host) || host;
    const [cookies] = await Promise.all([tab.wc.session.cookies.get({ domain }).catch(() => []), this.#ensureBubble()]);
    if (this.win.isDestroyed() || this.activeTab() !== tab) return;
    this.siteAnchor = { x: Number(rect.x) || 0, bottom: (Number(rect.y) || 0) + (Number(rect.height) || 0) };
    this.#openBubble(tab, 'site');
    this.bubble.webContents.send('bubble:show', {
      kind: 'site',
      host,
      secure: protocol === 'https:',
      permissions: require('./permissions').siteState(origin, this.isPrivate),
      cookies: cookies.length,
      accent: ctx.accentColor(),
      dark: nativeTheme.shouldUseDarkColors,
      isPrivate: this.isPrivate,
    });
    this.bubble.webContents.focus();
    this.scheduleState();
  }

  async showPasswordBubble() {
    const tab = this.activeTab();
    const pending = tab?.pendingLogin;
    if (!pending) return;
    await this.#ensureBubble();
    if (this.win.isDestroyed() || this.activeTab() !== tab) return;
    this.#openBubble(tab, 'password');
    this.bubble.webContents.send('bubble:show', {
      kind: 'password',
      host: new URL(pending.origin).host,
      username: pending.username,
      password: pending.password,
      update: pending.update,
      accent: ctx.accentColor(),
      dark: nativeTheme.shouldUseDarkColors,
      isPrivate: this.isPrivate,
    });
    this.bubble.webContents.focus();
    this.scheduleState();
  }

  hideBubble(refocus = true) {
    if (!this.bubbleOpen) return;
    this.bubbleOpen = false;
    this.bubbleTab = null;
    if (!this.win.isDestroyed()) this.win.contentView.removeChildView(this.bubble);
    if (refocus) this.focusActive();
    this.scheduleState();
  }

  setHtmlFullscreen(tab, on) {
    if (on) {
      this.htmlFullscreenTab = tab;
      this.wasFullscreen = this.win.isFullScreen();
      if (!this.wasFullscreen) this.win.setFullScreen(true);
    } else if (this.htmlFullscreenTab === tab) {
      this.htmlFullscreenTab = null;
      if (!this.wasFullscreen && this.win.isFullScreen()) this.win.setFullScreen(false);
    }
    this.layout();
    this.scheduleState();
  }

  toggleSidebar() {
    ctx.setSetting('sidebarCollapsed', !ctx.settings().sidebarCollapsed);
  }

  togglePanel(name) {
    this.panel = this.panel === name ? null : name;
    this.layout();
    this.scheduleState();
  }

  openFind() {
    this.find.open = true;
    this.layout();
    this.scheduleState();
    this.ui.webContents.focus();
    this.ui.webContents.send('ui:focus-find');
  }

  findText(text, { forward = true, next = false } = {}) {
    const wc = this.activeTab()?.wc;
    this.find.query = text;
    if (!wc) return;
    if (!text) {
      wc.stopFindInPage('clearSelection');
      Object.assign(this.find, { matches: 0, active: 0 });
      this.scheduleState();
      return;
    }
    wc.findInPage(text, { forward, findNext: !next });
  }

  onFindResult(tab, result) {
    if (tab !== this.activeTab() || !result.finalUpdate) return;
    Object.assign(this.find, { matches: result.matches, active: result.activeMatchOrdinal });
    this.scheduleState();
  }

  closeFind(refocus = true) {
    if (!this.find.open) return;
    this.find.open = false;
    this.find.matches = 0;
    this.activeTab()?.wc?.stopFindInPage('clearSelection');
    this.layout();
    this.scheduleState();
    if (refocus) this.focusActive();
  }

  #ensureOverlay() {
    if (this.overlay) return this.overlayReady;
    this.overlay = new WebContentsView({ webPreferences: { preload: UI_PRELOAD, sandbox: true, contextIsolation: true, transparent: true, spellcheck: false } });
    this.overlay.setBackgroundColor('#00000000');
    this.overlayReady = new Promise((resolve) => this.overlay.webContents.once('did-finish-load', resolve));
    this.overlay.webContents.loadFile(OVERLAY_HTML, { query: { platform: process.platform, lang: i18n.lang() } });
    this.overlay.webContents.on('before-input-event', (event, input) => require('./shortcuts').handle(this, input, event, { overlay: true }));
    return this.overlayReady;
  }

  async openPalette(mode = 'command', extra = {}) {
    await this.#ensureOverlay();
    if (this.win.isDestroyed()) return;
    if (!this.overlayOpen) {
      this.win.contentView.addChildView(this.overlay);
      this.overlayOpen = true;
    }
    this.layout();
    this.overlay.webContents.focus();
    const tab = this.activeTab();
    const text = mode === 'address' && tab && !tab.url.startsWith(NEWTAB) ? tab.displayUrl : '';
    this.overlay.webContents.send('overlay:open', { mode, text, accent: ctx.accentColor(), dark: nativeTheme.shouldUseDarkColors, isPrivate: this.isPrivate, ...extra });
  }

  closePalette() {
    if (!this.overlayOpen) return;
    this.win.contentView.removeChildView(this.overlay);
    this.overlayOpen = false;
    this.focusActive();
  }

  openInput(text, { newTab = false } = {}) {
    const result = omnibox.classify(text, ctx.settings().searchEngine);
    if (result) this.openUrl(result.url, { newTab, typed: true });
  }

  openUrl(url, { newTab = false, background = false, typed = false } = {}) {
    const tab = this.activeTab();
    if (!newTab && tab) {
      tab.navigate(url, { typed });
      this.focusActive();
    } else {
      this.newTab({ url, background, typed, afterId: background ? tab?.id : null });
    }
  }

  handleWindowOpen(opener, details) {
    const isPopup = details.disposition === 'new-window' && /(width|height|popup)/i.test(details.features || '');
    if (isPopup) {
      return {
        action: 'allow',
        outlivesOpener: false,
        overrideBrowserWindowOptions: { width: 560, height: 680, autoHideMenuBar: true, backgroundColor: '#ffffff', icon: ICON },
      };
    }
    return {
      action: 'allow',
      createWindow: (options) => {
        const tab = this.newTab({
          url: details.url,
          adopt: options.webContents,
          afterId: opener.id,
          workspaceId: opener.workspaceId,
          background: details.disposition === 'background-tab',
        });
        return tab.view.webContents;
      },
    };
  }

  state() {
    const s = this.space();
    const active = this.activeTab();
    let nav = null;
    if (active) {
      const st = active.state();
      const url = active.displayUrl;
      const isWeb = /^https?:/.test(url);
      const saved = require('./logins').savedFor(active).length;
      nav = {
        ...st,
        key: active.pendingLogin ? 'pending' : active.hasLoginForm && saved ? 'saved' : null,
        display: omnibox.displayUrl(url),
        secure: url.startsWith('https:') || url.startsWith('lions:'),
        isWeb,
        bookmarked: bookmarks.has(url),
        adblockOn: isWeb && ctx.settings().adblock && !adblock.isAllowlisted(url),
        storeOffer: require('./extensions').storeOffer(this),
      };
    }
    const settings = ctx.settings();
    const dl = downloads.summary();
    const update = require('./updater').state();
    return {
      isPrivate: this.isPrivate,
      platform: process.platform,
      dark: nativeTheme.shouldUseDarkColors,
      accent: ctx.accentColor(),
      layout: this.horizontal ? 'horizontal' : 'vertical',
      frameColor: this.isPrivate ? '' : settings.frameColor,
      bookmarks: settings.showBookmarksBar ? bookmarks.all().slice(0, 50).map((b) => ({ id: b.id, url: b.url, title: b.title, favicon: b.favicon })) : null,
      sidebarCollapsed: ctx.settings().sidebarCollapsed,
      panel: this.panel,
      htmlFullscreen: Boolean(this.htmlFullscreenTab),
      windowFullscreen: this.win.isFullScreen(),
      workspaces: this.isPrivate
        ? []
        : ctx.workspaces().map((w) => ({ id: w.id, name: w.name, color: w.color, isolated: Boolean(w.isolated), count: this.spaces.get(w.id)?.tabs.length || 0 })),
      activeWorkspaceId: this.activeWorkspaceId,
      tabs: s.tabs.map((t) => t.state()),
      activeTabId: s.activeId,
      split: s.split ? { ...s.split } : null,
      panes: (this.panes || []).map((p) => ({ ...p, focused: p.tabId === s.activeId })),
      nav,
      find: { ...this.find },
      downloads: dl,
      toolbar: {
        split: settings.showSplitButton || Boolean(s.split),
        notes: settings.showNotesButton || this.panel === 'notes',
        downloads: settings.downloadsButton === 'always' || dl.session > 0 || this.panel === 'downloads',
      },
      downloadList: this.panel === 'downloads' ? downloads.list().slice(0, 40) : [],
      canReopen: this.closed.length > 0,
      extensions: require('./extensions').toolbar(this),
      update: update.status === 'ready' || update.status === 'available' ? { status: update.status, version: update.version } : null,
    };
  }

  scheduleState() {
    if (this.statePending) return;
    this.statePending = true;
    setImmediate(() => {
      this.statePending = false;
      const wc = liveContents(this.ui);
      if (!wc || this.win.isDestroyed()) return;
      const state = this.state();
      wc.send('ui:state', state);
      const title = state.nav?.title ? `${state.nav.title} - LionsBrows` : 'LionsBrows';
      if (this.win.getTitle() !== title) this.win.setTitle(this.isPrivate ? `${title} (${i18n.tr('Private')})` : title);
    });
  }

  scheduleSave() {
    if (!this.isPrivate) require('./session').scheduleSave();
  }

  serialize() {
    const spaces = {};
    for (const [id, s] of this.spaces) {
      if (!s.tabs.length) continue;
      const idx = (tabId) => s.tabs.findIndex((t) => t.id === tabId);
      spaces[id] = {
        tabs: s.tabs.map((t) => t.serialize()),
        activeIndex: Math.max(0, idx(s.activeId)),
        split: s.split ? [idx(s.split.a), idx(s.split.b), s.split.ratio] : null,
      };
    }
    return {
      bounds: this.win.getNormalBounds(),
      maximized: this.win.isMaximized(),
      activeWorkspaceId: this.activeWorkspaceId,
      spaces,
    };
  }
}

module.exports = { BrowserWin };
