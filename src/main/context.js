'use strict';

// Shared app-wide state: persistent stores, history, open windows and an
// event bus. Kept in one module so the other main-process modules don't need
// to import each other in circles.

const path = require('node:path');
const EventEmitter = require('node:events');
const { app, nativeTheme } = require('electron');
const { JsonStore } = require('./store');
const { History } = require('./history');

const DEFAULT_SETTINGS = {
  searchEngine: 'duckduckgo',
  searchSuggestions: true,
  startup: 'restore', // 'restore' | 'newtab'
  theme: 'system', // 'system' | 'light' | 'dark'
  accent: 'gold',
  sidebarCollapsed: false,
  adblock: true,
  httpsUpgrade: true,
  gpc: true,
  tabSleepMinutes: 30, // 0 = never put background tabs to sleep
  askWhereToSave: false,
  downloadsPath: '',
  showTopSites: true,
  showBlockedStats: true,
  greetingName: '',
};

const ACCENTS = {
  gold: '#f0a020',
  orange: '#f26b1d',
  green: '#1f9d6b',
  blue: '#3b7cf6',
  rose: '#e2335d',
  violet: '#8b5cf6',
};

const ctx = {
  events: new EventEmitter(),
  windows: new Set(),
  quitting: false,
  config: null,
  bookmarks: null,
  sessionStore: null,
  notes: null,
  history: null,

  init() {
    const dir = app.getPath('userData');
    this.config = new JsonStore(path.join(dir, 'config.json'), {
      settings: DEFAULT_SETTINGS,
      workspaces: [{ id: 'home', name: 'Home', icon: '🦁', isolated: false }],
      permissions: {},
      adblockAllowlist: [],
      httpOnlyHosts: [],
      extensions: [],
      stats: { blocked: 0, since: Date.now() },
    });
    this.bookmarks = new JsonStore(path.join(dir, 'bookmarks.json'), { items: [] });
    this.sessionStore = new JsonStore(path.join(dir, 'session.json'), { windows: [] });
    this.notes = new JsonStore(path.join(dir, 'notes.json'), {});
    this.history = new History(path.join(dir, 'history.sqlite'));
    nativeTheme.themeSource = this.settings().theme;
  },

  settings() {
    return this.config.get('settings');
  },

  setSetting(key, value) {
    if (!(key in DEFAULT_SETTINGS)) throw new Error(`Unknown setting: ${key}`);
    const settings = { ...this.settings(), [key]: value };
    this.config.set('settings', settings);
    if (key === 'theme') nativeTheme.themeSource = value;
    this.events.emit('settings-changed', key, value);
  },

  accentColor() {
    return ACCENTS[this.settings().accent] || ACCENTS.gold;
  },

  workspaces() {
    return this.config.get('workspaces');
  },

  workspace(id) {
    return this.workspaces().find((w) => w.id === id) || this.workspaces()[0];
  },

  partitionFor(workspaceId, isPrivate, privateId) {
    if (isPrivate) return `lions-private-${privateId}`; // no "persist:" = in-memory only
    const ws = this.workspace(workspaceId);
    return ws && ws.isolated ? `persist:ws-${ws.id}` : 'persist:main';
  },

  lastFocusedWindow() {
    let best = null;
    for (const w of this.windows) if (!best || w.focusedAt > best.focusedAt) best = w;
    return best;
  },

  flushAll() {
    for (const s of [this.config, this.bookmarks, this.sessionStore, this.notes]) {
      try {
        s.flush();
      } catch (err) {
        console.error('Failed to save', s.file, err);
      }
    }
  },
};

module.exports = { ctx, DEFAULT_SETTINGS, ACCENTS };
