'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, nativeTheme } = require('electron');

if (process.env.LIONSBROWS_USER_DATA) app.setPath('userData', path.resolve(process.env.LIONSBROWS_USER_DATA));

process.on('uncaughtException', (err) => console.error('[main] uncaught exception:', err));
process.on('unhandledRejection', (err) => {
  if (/Render frame was disposed|WebContents was destroyed|Script failed to execute/.test(String(err && err.message))) return;
  console.error('[main] unhandled rejection:', err);
});

process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name !== 'ExperimentalWarning') console.warn(w);
});

const protocol = require('./protocol');
protocol.registerScheme();

function savedSettings() {
  try {
    return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'config.json'), 'utf8')).settings || {};
  } catch {
    return {};
  }
}

const saved = savedSettings();
const i18n = require('./i18n');
i18n.configure(saved.language);
if (saved.language === 'de') app.commandLine.appendSwitch('lang', 'de');
else if (saved.language === 'en') app.commandLine.appendSwitch('lang', 'en-US');

const lowEndSetting = saved.lowEndMode || 'auto';
const lowEndMode = lowEndSetting === 'on' || (lowEndSetting === 'auto' && os.totalmem() <= 4 * 1024 ** 3);
if (lowEndMode) {
  app.commandLine.appendSwitch('enable-low-end-device-mode');
  app.commandLine.appendSwitch('renderer-process-limit', '4');
  app.commandLine.appendSwitch('process-per-site');
}

const { ctx } = require('./context');
ctx.lowEndModeActive = lowEndMode;

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
  if (ctx.settings().cookies === 'session' && !ctx.config.get('siteDataCleared')) await sessions.clearSiteData();
  if (ctx.config.get('siteDataCleared')) ctx.config.set('siteDataCleared', false);

  const saved = sessionStore.saved();
  const welcome = !ctx.settings().welcomeDone && (process.env.LIONSBROWS_TEST !== '1' || process.env.LIONSBROWS_WELCOME === '1');
  if (welcome) {
    pendingUrls.push('lions://welcome/');
    ctx.setSetting('welcomeDone', true);
  }
  if (saved.length) {
    saved.forEach((restore, i) => new BrowserWin({ restore, urls: i === 0 ? pendingUrls : [] }));
  } else {
    new BrowserWin({ urls: pendingUrls });
  }
  setImmediate(() => adblock.init().catch((err) => console.warn('[adblock]', err.message)));
  setImmediate(() => require('./safety').init().catch((err) => console.warn('[safety]', err.message)));
  require('electron').components?.whenReady?.().catch((err) => console.warn('[widevine]', err.message));

  require('./memory').start();
  require('./updater').start();

  nativeTheme.on('updated', () => {
    for (const w of ctx.windows) w.applyTheme();
    internalApi.broadcast('theme-changed');
  });

  ctx.events.on('settings-changed', (key) => {
    if (key === 'memorySaver') require('./memory').enforce();
    for (const w of ctx.windows) {
      if (key === 'theme' || key === 'frameColor' || key === 'layout') w.applyTheme();
      else if (key === 'sidebarCollapsed' || key === 'showBookmarksBar') w.layout();
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
  ctx.events.on('update-changed', () => {
    for (const w of ctx.windows) w.scheduleState();
    internalApi.broadcast('update-changed');
  });
  ctx.events.on('workspaces-changed', () => {
    for (const w of ctx.windows) w.scheduleState();
  });
  ctx.events.on('bookmarks-changed', () => {
    for (const w of ctx.windows) w.scheduleState();
    internalApi.broadcast('bookmarks-changed');
  });

  let siteDataPending = true;
  app.on('before-quit', (event) => {
    if (siteDataPending && ctx.settings().cookies === 'session') {
      siteDataPending = false;
      event.preventDefault();
      sessions
        .clearSiteData()
        .then(() => ctx.config.set('siteDataCleared', true))
        .finally(() => app.quit());
      return;
    }
    ctx.quitting = true;
    sessionStore.saveNow();
    downloads.flush();
    ctx.flushAll();
  });
}

app.on('activate', () => {
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
  }
});

app.on('web-contents-created', (_e, wc) => {
  wc.on('will-attach-webview', (event) => event.preventDefault());
  if (wc.getType() === 'window') {
    wc.setWindowOpenHandler(({ url }) => {
      const w = ctx.lastFocusedWindow();
      if (w) w.newTab({ url });
      return { action: 'deny' };
    });
  }
});
