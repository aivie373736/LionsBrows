'use strict';

const path = require('node:path');
const EventEmitter = require('node:events');
const { app, nativeTheme } = require('electron');
const { JsonStore } = require('./store');
const { History } = require('./history');
const searchEngines = require('./search-engines');
const { tr } = require('./i18n');

const DEFAULT_SETTINGS = {
  searchEngine: 'google',
  searchSuggestions: true,
  customSearchName: '',
  customSearchUrl: '',
  welcomeDone: false,
  startup: 'restore',
  blockAutoplay: true,
  autoPictureInPicture: true,
  offerTranslate: true,
  language: 'auto',
  autoUpdate: true,
  layout: 'horizontal',
  theme: 'system',
  accent: '#7542e5',
  frameColor: '',
  showBookmarksBar: false,
  showSplitButton: false,
  showNotesButton: false,
  downloadsButton: 'auto',
  sidebarCollapsed: false,
  adblock: true,
  blockCookieBanners: true,
  safeBrowsing: true,
  httpsUpgrade: true,
  gpc: true,
  cookies: 'keep',
  blockThirdPartyCookies: false,
  defaultCamera: 'ask',
  defaultMicrophone: 'ask',
  defaultLocation: 'ask',
  defaultNotifications: 'ask',
  memorySaver: 'auto',
  lowEndMode: 'auto',
  askWhereToSave: false,
  downloadsPath: '',
  showTopSites: true,
  showBlockedStats: true,
  showGreeting: false,
  greetingName: '',
  ntBackground: 'default',
  ntBackgroundColor: '#1f2a37',
  ntBackgroundFile: '',
  ntBackgroundDim: 0.25,
  ntBackgroundBlur: 0,
  readerFont: 'serif',
  readerSize: 20,
  readerTheme: 'auto',
  offerToSavePasswords: true,
  autofillPasswords: true,
};

const ACCENTS = {
  purple: '#7542e5',
  blue: '#0061e0',
  teal: '#008787',
  green: '#1f8a3e',
  red: '#d7264c',
  orange: '#e8811a',
  pink: '#c50093',
  graphite: '#5b5b66',
};

const WORKSPACE_COLORS = ['#7542e5', '#0061e0', '#1f8a3e', '#e8811a', '#008787', '#d7264c', '#5b5b66', '#c50093'];

const LEGACY_ACCENTS = { gold: '#f0a020', orange: '#f26b1d', green: '#1f9d6b', blue: '#3b7cf6', rose: '#e2335d', violet: '#8b5cf6' };

const HEX = /^#[0-9a-f]{6}$/i;

function migrate(config) {
  const s = config.get('settings');
  if (!HEX.test(s.accent)) config.set('settings', { ...s, accent: LEGACY_ACCENTS[s.accent] || DEFAULT_SETTINGS.accent });
  const workspaces = config.get('workspaces');
  if (workspaces.some((w) => !HEX.test(w.color || ''))) {
    config.set(
      'workspaces',
      workspaces.map((w, i) => {
        const { icon, ...rest } = w;
        return HEX.test(w.color || '') ? rest : { ...rest, color: WORKSPACE_COLORS[i % WORKSPACE_COLORS.length] };
      }),
    );
  }
}

function syncCustomEngine(settings) {
  searchEngines.setCustomEngine(settings.customSearchName, settings.customSearchUrl);
}

const ctx = {
  events: new EventEmitter(),
  windows: new Set(),
  closedWindows: [],
  quitting: false,
  config: null,
  bookmarks: null,
  sessionStore: null,
  notes: null,
  history: null,
  passwords: null,

  init() {
    const dir = app.getPath('userData');
    this.config = new JsonStore(path.join(dir, 'config.json'), {
      settings: DEFAULT_SETTINGS,
      workspaces: [{ id: 'home', name: tr('Personal'), color: WORKSPACE_COLORS[0], isolated: false }],
      permissions: {},
      adblockAllowlist: [],
      httpOnlyHosts: [],
      zoom: {},
      extensions: [],
      unpinnedExtensions: [],
      stats: { blocked: 0, since: Date.now() },
      siteDataCleared: false,
    });
    migrate(this.config);
    this.bookmarks = new JsonStore(path.join(dir, 'bookmarks.json'), { items: [] });
    this.sessionStore = new JsonStore(path.join(dir, 'session.json'), { windows: [] });
    this.notes = new JsonStore(path.join(dir, 'notes.json'), {});
    this.history = new History(path.join(dir, 'history.sqlite'));
    const { Vault } = require('./passwords');
    this.passwords = new Vault(path.join(dir, 'passwords.json'), require('./logins').codec);
    nativeTheme.themeSource = this.settings().theme;
    syncCustomEngine(this.settings());
  },

  settings() {
    return this.config.get('settings');
  },

  setSetting(key, value) {
    this.setSettings({ [key]: value });
  },

  setSettings(patch) {
    for (const key of Object.keys(patch)) if (!(key in DEFAULT_SETTINGS)) throw new Error(`Unknown setting: ${key}`);
    this.config.set('settings', { ...this.settings(), ...patch });
    if ('theme' in patch) nativeTheme.themeSource = patch.theme;
    if ('customSearchName' in patch || 'customSearchUrl' in patch) syncCustomEngine(this.settings());
    for (const key of Object.keys(patch)) this.events.emit('settings-changed', key, patch[key]);
  },

  accentColor() {
    const accent = this.settings().accent;
    return HEX.test(accent) ? accent : DEFAULT_SETTINGS.accent;
  },

  workspaces() {
    return this.config.get('workspaces');
  },

  workspace(id) {
    return this.workspaces().find((w) => w.id === id) || this.workspaces()[0];
  },

  partitionFor(workspaceId, isPrivate, privateId) {
    if (isPrivate) return `lions-private-${privateId}`;
    const ws = this.workspace(workspaceId);
    return ws && ws.isolated ? `persist:ws-${ws.id}` : 'persist:main';
  },

  lastFocusedWindow() {
    let best = null;
    for (const w of this.windows) if (!best || w.focusedAt > best.focusedAt) best = w;
    return best;
  },

  flushAll() {
    for (const s of [this.config, this.bookmarks, this.sessionStore, this.notes, this.passwords]) {
      try {
        s.flush();
      } catch (err) {
        console.error('Failed to save', s.file, err);
      }
    }
  },
};

module.exports = { ctx, DEFAULT_SETTINGS, ACCENTS, WORKSPACE_COLORS, HEX };
