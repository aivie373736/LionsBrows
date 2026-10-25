'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, nativeTheme } = require('electron');

// Tests and portable setups can point LionsBrows at a separate profile folder.
if (process.env.LIONSBROWS_USER_DATA) app.setPath('userData', path.resolve(process.env.LIONSBROWS_USER_DATA));

// Log unexpected errors instead of Electron's default modal error box, which
// would freeze the whole browser until it's dismissed.
process.on('uncaughtException', (err) => console.error('[main] uncaught exception:', err));
process.on('unhandledRejection', (err) => {
  // A page that navigates away mid-request (e.g. while the ad blocker injects
  // its styles) is a normal race, not a bug worth reporting.
  if (/Render frame was disposed|WebContents was destroyed/.test(String(err && err.message))) return;
  console.error('[main] unhandled rejection:', err);
});

// node:sqlite still prints an "experimental" warning in some Node versions.
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name !== 'ExperimentalWarning') console.warn(w);
});

const protocol = require('./protocol');
protocol.registerScheme(); // must happen before the app is ready

const { ctx } = require('./context');

// Lets the end-to-end tests (test/e2e.mjs) reach into the main process.
if (process.env.LIONSBROWS_TEST === '1') global.lionsTest = { ctx, require };

function urlsFromArgv(argv) {
  return argv
    .slice(app.isPackaged ? 1 : 2)
    .filter((a) => !a.startsWith('-'))
    .map((a) => {
      if (/^(https?|lions|file):/i.test(a)) return a;
      const file = path.resolve(a);
      return /\.(html?|pdf|svg|txt|png|jpe?g|gif|webp)$/i.test(a) && fs.existsSync(file) ? pathToFileURL(file).href : null;
    })
    .filter(Boolean);
}

const pendingUrls = urlsFromArgv(process.argv);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => openUrls(urlsFromArgv(argv)));
  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (app.isReady()) openUrls([url]);
    else pendingUrls.push(url);
  });
  app.whenReady().then(start);
}

function openUrls(urls) {
  const { BrowserWin } = require('./window');
  const w = ctx.lastFocusedWindow();
  if (!w) return void new BrowserWin({ urls });
  for (const url of urls) w.newTab({ url });
  if (w.win.isMinimized()) w.win.restore();
  w.win.show();
  w.win.focus();
}

function findTabByWebContentsId(id) {
  for (const w of ctx.windows) for (const t of w.allTabs()) if (t.wc && t.wc.id === id) return { w, t };
  return null;
}

function sleepIdleTabs() {
  const minutes = ctx.settings().tabSleepMinutes;
  if (!minutes) return;
  const cutoff = Date.now() - minutes * 60_000;
  for (const w of ctx.windows) {
    const visible = new Set(w.visibleTabs());
    for (const t of w.allTabs()) {
      if (!visible.has(t) && t.view && !t.audible && !t.loading && t.lastActive < cutoff) t.sleep();
    }
  }
}

async function start() {
  ctx.init();
  const downloads = require('./downloads');
  const sessions = require('./sessions');
  const adblock = require('./adblock');
  const menus = require('./menus');
  const ipc = require('./ipc');
  const sessionStore = require('./session');
  const internalApi = require('./internal-api');
  const { BrowserWin } = require('./window');

  downloads.init();
  sessions.init();
  menus.installAppMenu();
  ipc.init();
  adblock.init().catch((err) => console.warn('[adblock]', err.message));

  // Open the previous session, or a fresh window.
  const saved = sessionStore.saved();
  if (saved.length) {
    saved.forEach((restore, i) => new BrowserWin({ restore, urls: i === 0 ? pendingUrls : [] }));
  } else {
    new BrowserWin({ urls: pendingUrls });
  }

  setInterval(sleepIdleTabs, 60_000);

  nativeTheme.on('updated', () => {
    for (const w of ctx.windows) w.applyTheme();
    internalApi.broadcast('theme-changed');
  });

  ctx.events.on('settings-changed', (key) => {
    for (const w of ctx.windows) {
      if (key === 'sidebarCollapsed') w.layout();
      if (key === 'theme') w.applyTheme();
      w.scheduleState();
    }
    internalApi.broadcast(key === 'theme' ? 'theme-changed' : 'settings-changed', ctx.settings());
  });

  let statsTimer = null;
  ctx.events.on('request-blocked', (wcId) => {
    const found = findTabByWebContentsId(wcId);
    if (found) {
      found.t.blocked++;
      if (found.w.activeTab() === found.t) found.w.scheduleState();
    }
    ctx.config.get('stats').blocked++;
    if (!statsTimer) statsTimer = setTimeout(() => ((statsTimer = null), ctx.config.save()), 5000);
  });

  ctx.events.on('downloads-changed', () => {
    for (const w of ctx.windows) w.scheduleState();
    internalApi.broadcast('downloads-changed');
  });
  ctx.events.on('download-started', () => {
    const w = ctx.lastFocusedWindow();
    if (w && w.panel !== 'downloads') w.togglePanel('downloads');
  });
  ctx.events.on('workspaces-changed', () => {
    for (const w of ctx.windows) w.scheduleState();
  });
  ctx.events.on('bookmarks-changed', () => {
    for (const w of ctx.windows) w.scheduleState();
    internalApi.broadcast('bookmarks-changed');
  });

  app.on('before-quit', () => {
    ctx.quitting = true;
    sessionStore.saveNow();
    downloads.flush();
    ctx.flushAll();
  });
}

app.on('activate', () => {
  // macOS: clicking the dock icon with no windows open.
  if (app.isReady() && ctx.windows.size === 0) {
    const { BrowserWin } = require('./window');
    new BrowserWin({ restore: require('./session').saved()[0] || null });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  try {
    ctx.history?.close();
  } catch {
    /* already closed */
  }
});

app.on('web-contents-created', (_e, wc) => {
  wc.on('will-attach-webview', (event) => event.preventDefault());
  // Pop-up windows (e.g. "Sign in with Google") open their own links as tabs.
  if (wc.getType() === 'window') {
    wc.setWindowOpenHandler(({ url }) => {
      const w = ctx.lastFocusedWindow();
      if (w) w.newTab({ url });
      return { action: 'deny' };
    });
  }
});
