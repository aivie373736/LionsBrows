'use strict';

// One browser tab. A tab can be "asleep" (no WebContentsView, just a URL,
// title and its back/forward history) to save memory; it wakes up when shown.

const path = require('node:path');
const { WebContentsView, dialog, nativeTheme } = require('electron');
const { ctx } = require('./context');
const sessions = require('./sessions');

const PAGE_PRELOAD = path.join(__dirname, '..', 'preload', 'page.js');
const NEWTAB = 'lions://newtab/';
const ZOOM_FACTORS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
const DARK_BG = '#1b1916';

let nextId = 1;

class Tab {
  constructor(owner, { url = NEWTAB, title = '', favicon = '', pinned = false, workspaceId, webContents = null, openerId = null } = {}) {
    this.id = nextId++;
    this.owner = owner;
    this.workspaceId = workspaceId;
    this.url = url;
    this.title = title;
    this.favicon = favicon;
    this.pinned = pinned;
    this.openerId = openerId;
    this.loading = false;
    this.audible = false;
    this.muted = false;
    this.crashed = false;
    this.blocked = 0;
    this.errorUrl = null;
    this.typed = false;
    this.lastActive = Date.now();
    this.savedHistory = null;
    this.view = null;
    this.closing = false;
    if (webContents) this.#createView(webContents);
  }

  get wc() {
    return this.view && !this.view.webContents.isDestroyed() ? this.view.webContents : null;
  }

  get sleeping() {
    return !this.view;
  }

  get displayUrl() {
    return this.errorUrl || this.url;
  }

  get isInternal() {
    return this.displayUrl.startsWith('lions://');
  }

  get partition() {
    return ctx.partitionFor(this.workspaceId, this.owner.isPrivate, this.owner.privateId);
  }

  /** Make sure the tab has a live page, waking it up if it was asleep. */
  ensureView() {
    if (this.view) return this.view;
    this.#createView(null);
    const wc = this.view.webContents;
    const saved = this.savedHistory;
    this.savedHistory = null;
    if (saved && saved.entries.length && wc.navigationHistory.restore) {
      wc.navigationHistory.restore(saved).catch(() => wc.loadURL(this.url));
    } else {
      wc.loadURL(this.url).catch(() => {});
    }
    return this.view;
  }

  #createView(adopt) {
    const ses = sessions.forPartition(this.partition, { isPrivate: this.owner.isPrivate });
    const options = adopt
      ? { webContents: adopt }
      : {
          webPreferences: {
            session: ses,
            preload: PAGE_PRELOAD,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            webviewTag: false,
            plugins: true, // built-in PDF viewer
            spellcheck: true,
            safeDialogs: true,
            scrollBounce: true,
          },
        };
    this.view = new WebContentsView(options);
    this.view.setBorderRadius?.(10);
    this.#syncBackground(this.url);
    this.#wire(this.view.webContents);
  }

  #syncBackground(url) {
    if (!this.view) return;
    const internal = (url || '').startsWith('lions://');
    if (internal && this.owner.isPrivate) this.view.setBackgroundColor('#221b2e');
    else this.view.setBackgroundColor(internal && nativeTheme.shouldUseDarkColors ? DARK_BG : '#ffffff');
  }

  #wire(wc) {
    const changed = () => this.owner.tabChanged(this);
    const menus = () => require('./menus');
    const shortcuts = () => require('./shortcuts');

    wc.setWindowOpenHandler((details) => this.owner.handleWindowOpen(this, details));

    wc.on('did-start-loading', () => {
      this.loading = true;
      changed();
    });
    wc.on('did-stop-loading', () => {
      this.loading = false;
      changed();
    });
    wc.on('did-start-navigation', (event) => {
      if (event.isMainFrame && !event.isSameDocument) this.#syncBackground(event.url);
    });
    wc.on('did-navigate', (_e, url) => {
      this.url = url;
      this.crashed = false;
      this.blocked = 0;
      if (!url.startsWith('lions://error')) this.errorUrl = null;
      this.#record(url);
      changed();
    });
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (!isMainFrame) return;
      this.url = url;
      this.#record(url);
      changed();
    });
    wc.on('page-title-updated', (_e, title) => {
      this.title = title;
      if (!this.owner.isPrivate) ctx.history.setTitle(this.url, title);
      changed();
    });
    wc.on('page-favicon-updated', (_e, favicons) => {
      this.favicon = favicons[0] || '';
      if (!this.owner.isPrivate) ctx.history.setFavicon(this.url, this.favicon);
      changed();
    });
    wc.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
      if (!isMainFrame || code === -3) return; // -3 = aborted (new navigation, download...)
      const httpUrl = sessions.consumeFailedUpgrade(wc.id, failedUrl);
      if (httpUrl) {
        wc.loadURL(httpUrl).catch(() => {});
        return;
      }
      this.#showError(String(code), desc, failedUrl);
    });
    wc.on('render-process-gone', (_e, details) => {
      if (details.reason === 'clean-exit' || this.closing) return;
      this.crashed = true;
      changed();
      this.#showError('crash', details.reason, this.displayUrl);
    });
    wc.on('audio-state-changed', (event) => {
      this.audible = event.audible;
      changed();
    });
    wc.on('enter-html-full-screen', () => this.owner.setHtmlFullscreen(this, true));
    wc.on('leave-html-full-screen', () => this.owner.setHtmlFullscreen(this, false));
    wc.on('found-in-page', (_e, result) => this.owner.onFindResult(this, result));
    wc.on('zoom-changed', (_e, direction) => this.zoom(direction === 'in' ? 1 : -1));
    wc.on('context-menu', (_e, params) => menus().pageMenu(this, params));
    wc.on('before-input-event', (event, input) => shortcuts().handle(this.owner, input, event));
    wc.on('focus', () => this.owner.tabFocused(this));
    wc.on('will-prevent-unload', (event) => {
      const choice = dialog.showMessageBoxSync(this.owner.win, {
        type: 'question',
        buttons: ['Leave', 'Stay'],
        defaultId: 0,
        cancelId: 1,
        message: 'Leave this site?',
        detail: 'Changes you made may not be saved.',
      });
      if (choice === 0) event.preventDefault();
    });
    wc.on('destroyed', () => {
      if (!this.closing && this.view && this.view.webContents === wc) this.owner.tabDestroyed(this);
    });
  }

  #record(url) {
    if (this.owner.isPrivate) return;
    ctx.history.add(url, this.title, { typed: this.typed });
    this.typed = false;
  }

  #showError(code, desc, url) {
    this.errorUrl = url;
    const q = new URLSearchParams({ code, desc: desc || '', url: url || '' });
    this.wc?.loadURL(`lions://error/?${q}`).catch(() => {});
  }

  navigate(url, { typed = false } = {}) {
    this.typed = typed;
    this.errorUrl = null;
    if (!this.view) {
      this.url = url;
      this.savedHistory = null;
      this.ensureView();
      return;
    }
    this.wc.loadURL(url).catch(() => {});
  }

  back() {
    const h = this.wc?.navigationHistory;
    if (h?.canGoBack()) h.goBack();
  }

  forward() {
    const h = this.wc?.navigationHistory;
    if (h?.canGoForward()) h.goForward();
  }

  reload(hard = false) {
    if (!this.wc) return this.ensureView();
    if (this.errorUrl) return this.navigate(this.errorUrl);
    if (hard) this.wc.reloadIgnoringCache();
    else this.wc.reload();
  }

  stop() {
    this.wc?.stop();
  }

  setMuted(muted) {
    this.muted = muted;
    this.wc?.setAudioMuted(muted);
    this.owner.tabChanged(this);
  }

  zoom(step) {
    const wc = this.wc;
    if (!wc) return;
    const current = wc.getZoomFactor();
    let next = 1;
    if (step !== 0) {
      const idx = ZOOM_FACTORS.findIndex((f) => f >= current - 0.001);
      const base = idx === -1 ? ZOOM_FACTORS.length - 1 : idx;
      next = ZOOM_FACTORS[Math.min(ZOOM_FACTORS.length - 1, Math.max(0, base + step))];
    }
    wc.setZoomFactor(next);
    this.owner.tabChanged(this);
  }

  /** Put the tab to sleep: free its renderer but keep its history. */
  sleep() {
    const wc = this.wc;
    if (!wc || this.audible) return false;
    const h = wc.navigationHistory;
    this.savedHistory = h.getAllEntries ? { entries: h.getAllEntries(), index: h.getActiveIndex() } : null;
    this.#dropView();
    this.owner.tabChanged(this);
    return true;
  }

  #dropView() {
    const view = this.view;
    if (!view) return;
    this.closing = true;
    this.owner.detachView(view);
    this.view = null;
    if (!view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false });
    this.closing = false;
  }

  destroy() {
    this.closing = true;
    this.#dropView();
    this.closing = true;
  }

  state() {
    const wc = this.wc;
    return {
      id: this.id,
      title: this.title || this.#fallbackTitle(),
      url: this.displayUrl,
      favicon: this.favicon,
      loading: this.loading,
      audible: this.audible,
      muted: this.muted,
      pinned: this.pinned,
      sleeping: this.sleeping,
      crashed: this.crashed,
      internal: this.isInternal,
      zoom: wc ? Math.round(wc.getZoomFactor() * 100) : 100,
      canGoBack: wc ? wc.navigationHistory.canGoBack() : false,
      canGoForward: wc ? wc.navigationHistory.canGoForward() : false,
      blocked: this.blocked,
    };
  }

  #fallbackTitle() {
    if (this.url.startsWith(NEWTAB)) return 'New Tab';
    try {
      return new URL(this.displayUrl).host || this.displayUrl;
    } catch {
      return this.displayUrl;
    }
  }

  serialize() {
    return { url: this.displayUrl, title: this.title, favicon: this.favicon, pinned: this.pinned };
  }
}

module.exports = { Tab, NEWTAB };
