import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
}
const electronPath = require('electron');

const SHOTS = process.env.SHOTS;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lionsbrows-e2e-'));
const downloadsDir = path.join(profile, 'dl');
fs.mkdirSync(downloadsDir);

const PAGES = {
  '/': `<title>Lion Test Home</title><h1>Welcome to the lion test page</h1>
        <p>The lion sleeps tonight. Lion lion lion.</p>
        <a id="two" href="/two">two</a>
        <script src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"></script>
        <script src="https://www.google-analytics.com/analytics.js"></script>`,
  '/two': `<title>Page Two</title><p>second page</p>`,
  '/opener': `<title>Opener</title><script>window.openedOk = () => !!window.opener;</script>`,
  '/download': null,
};

const server = http.createServer((req, res) => {
  if (req.url === '/download') {
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="roar.txt"' });
    return res.end('ROAR '.repeat(1000));
  }
  const body = PAGES[req.url.split('?')[0]];
  if (body === undefined) {
    res.writeHead(404);
    return res.end('nope');
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta charset="utf-8">${body}`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, what, timeout = 15000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    try {
      last = await fn();
      if (last) return last;
    } catch (err) {
      last = err;
    }
    await wait(150);
  }
  throw new Error(`Timed out waiting for: ${what} (last: ${last})`);
}

function shot(name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  execSync(`import -window root ${path.join(SHOTS, `${name}.png`)}`);
}

async function launch() {
  const app = await playwright._electron.launch({
    executablePath: electronPath,
    args: [root, '--no-sandbox'],
    env: { ...process.env, LIONSBROWS_USER_DATA: profile, LIONSBROWS_TEST: '1' },
  });
  app.process().stderr.on('data', (d) => {
    const text = String(d);
    if (/\[main\]|Error:/.test(text) && !/Failed to load URL/.test(text)) {
      mainErrors.push(text.trim());
      process.stdout.write(`    [main] ${text}`);
    }
  });
  const main = (fn, arg) => app.evaluate(async ({}, [src, a]) => {
    const { ctx, require } = globalThis.lionsTest;
    const w = ctx.lastFocusedWindow();
    const value = await new Function('ctx', 'require', 'w', 'arg', `return (${src})(ctx, require, w, arg)`)(ctx, require, w, a);
    if (value === undefined || value === null || typeof value !== 'object') return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return null;
    }
  }, [fn.toString(), arg]);
  await until(() => main((ctx) => ctx.windows.size === 1), 'first window');
  return { app, main };
}

async function pageFor(app, predicate) {
  return until(() => app.windows().find((p) => predicate(p.url())), 'page');
}

async function activePage(app, main) {
  const mark = `tab-${Date.now()}-${Math.random()}`;
  await until(() => main((ctx, r, w, m) => w.activeTab().wc.executeJavaScript(`window.e2eMark = ${JSON.stringify(m)}; true`), mark), 'mark active tab');
  return until(async () => {
    for (const p of app.windows()) {
      if ((await p.evaluate(() => window.e2eMark).catch(() => null)) === mark) return p;
    }
    return null;
  }, 'active tab page');
}

const results = [];
const mainErrors = [];
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push(['ok', name]);
    console.log(`  ✓ ${name} (${Date.now() - t}ms)`);
  } catch (err) {
    results.push(['FAIL', name]);
    console.log(`  ✗ ${name}\n    ${err.stack || err}`);
  }
}

console.log(`LionsBrows e2e · profile ${profile}`);
let { app, main } = await launch();

await step('starts with a new tab page and the UI', async () => {
  const ui = await pageFor(app, (u) => u.includes('/ui/index.html'));
  await ui.waitForSelector('.tab.active');
  assert.equal(await ui.textContent('.tab.active .title'), 'New Tab');
  const nt = await pageFor(app, (u) => u.startsWith('lions://newtab'));
  await nt.waitForSelector('#search');
  await main((ctx, r, w, dir) => ctx.setSetting('downloadsPath', dir), downloadsDir);
  shot('01-newtab');
});

await step('navigates, records history and shows the address', async () => {
  await main((ctx, r, w, url) => w.openInput(url), `${BASE}/`);
  await until(() => main((ctx, r, w) => w.activeTab().title === 'Lion Test Home'), 'title');
  const ui = await pageFor(app, (u) => u.includes('/ui/index.html'));
  await until(async () => (await ui.textContent('#addr-text')).includes('127.0.0.1'), 'address bar');
  const hits = await main((ctx) => ctx.history.search('lion test'));
  assert.ok(hits.length >= 1, 'history entry');
});

await step('ad blocker blocks known ad/tracker scripts', async () => {
  await until(() => main((ctx, r) => r('./adblock').isReady()), 'filter lists', 90000);
  await main((ctx, r, w) => w.activeTab().reload(true));
  const blocked = await until(() => main((ctx, r, w) => w.activeTab().blocked), 'blocked count > 0', 30000);
  assert.ok(blocked >= 1);
  shot('02-page');
});

await step('find in page counts matches', async () => {
  await main((ctx, r, w) => w.openFind());
  await main((ctx, r, w) => w.findText('lion'));
  const matches = await until(() => main((ctx, r, w) => w.find.matches), 'matches');
  assert.ok(matches >= 4, `got ${matches}`);
  shot('03-find');
  await main((ctx, r, w) => w.closeFind());
});

await step('command bar finds and opens things', async () => {
  const before = await main((ctx, r, w) => w.space().tabs.length);
  await main((ctx, r, w) => w.openPalette('command'));
  const overlay = await pageFor(app, (u) => u.includes('/ui/overlay.html'));
  await overlay.waitForSelector('#q');
  await overlay.fill('#q', 'lion test');
  await overlay.waitForSelector('.item.tab');
  await overlay.fill('#q', '12*(3+4)');
  await overlay.waitForSelector('.item.calc');
  assert.match(await overlay.textContent('.item.calc .title'), /84/);
  shot('04-palette');
  await overlay.fill('#q', `${BASE.replace('http://', '')}/two`);
  await overlay.waitForSelector('.item.url');
  await overlay.press('#q', 'Enter');
  await until(() => main((ctx, r, w) => w.activeTab().title === 'Page Two'), 'opened in new tab');
  assert.equal(await main((ctx, r, w) => w.space().tabs.length), before + 1);
});

await step('window.open keeps the opener and opens a tab next to it', async () => {
  await main((ctx, r, w, url) => w.openUrl(url), `${BASE}/opener`);
  await until(() => main((ctx, r, w) => w.activeTab().title === 'Opener'), 'opener page');
  const before = await main((ctx, r, w) => w.space().tabs.length);
  await main((ctx, r, w, url) => w.activeTab().wc.executeJavaScript(`window.open(${JSON.stringify(url)}); 1`, true), `${BASE}/two?child`);
  await until(() => main((ctx, r, w) => w.space().tabs.length), 'new tab', 5000);
  await until(async () => (await main((ctx, r, w) => w.space().tabs.length)) === before + 1, 'tab count');
  const hasOpener = await until(
    () => main((ctx, r, w) => {
      const t = w.space().tabs.find((x) => x.url.includes('child'));
      return t && t.wc.executeJavaScript('window.opener !== null');
    }),
    'opener in child',
  );
  assert.equal(hasOpener, true);
});

await step('pop-up windows with features open as real windows', async () => {
  await main((ctx, r, w, url) => w.activeTab().wc.executeJavaScript(`window.open(${JSON.stringify(url)}, 'pop', 'width=400,height=300'); 1`, true), `${BASE}/two?popup`);
  await until(() => main((ctx, r) => r('electron').BrowserWindow.getAllWindows().length === 1), 'popup window');
  await main((ctx, r) => r('electron').BrowserWindow.getAllWindows().forEach((b) => b.close()));
});

await step('split view shows two tabs side by side', async () => {
  await main((ctx, r, w) => w.toggleSplit());
  const panes = await main((ctx, r, w) => w.panes);
  assert.equal(panes.length, 2);
  assert.ok(panes[0].x + panes[0].width < panes[1].x, 'side by side');
  await main((ctx, r, w) => w.setSplitRatio(0.6));
  await wait(400);
  shot('05-split');
  await main((ctx, r, w) => w.toggleSplit());
});

await step('keyboard shortcuts work (Ctrl+T, Ctrl+W, Ctrl+Shift+T)', async () => {
  const count = () => main((ctx, r, w) => w.space().tabs.length);
  const n = await count();
  const key = (keyCode, modifiers) => main((ctx, r, w, a) => {
    const wc = w.activeTab().wc;
    wc.sendInputEvent({ type: 'keyDown', keyCode: a.keyCode, modifiers: a.modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode: a.keyCode, modifiers: a.modifiers });
  }, { keyCode, modifiers });
  const mod = process.platform === 'darwin' ? 'meta' : 'control';
  await key('T', [mod]);
  await until(async () => (await count()) === n + 1, 'Ctrl+T');
  await wait(300);
  await key('W', [mod]);
  await until(async () => (await count()) === n, 'Ctrl+W');
  await main((ctx, r, w, url) => w.openUrl(url, { newTab: true }), `${BASE}/two?closed`);
  await until(async () => (await count()) === n + 1, 'opened');
  await wait(500);
  await key('W', [mod]);
  await until(async () => (await count()) === n, 'closed');
  await key('T', [mod, 'shift']);
  await until(() => main((ctx, r, w) => w.space().tabs.some((t) => t.url.includes('closed'))), 'reopened');
});

await step('background tabs can sleep and wake up where they were', async () => {
  const id = await main((ctx, r, w) => w.space().tabs.find((t) => t.title === 'Lion Test Home').id);
  await main((ctx, r, w, tid) => w.sleepTab(tid), id);
  assert.equal(await main((ctx, r, w, tid) => w.tabById(tid).sleeping, id), true);
  await main((ctx, r, w, tid) => w.activate(tid), id);
  await until(() => main((ctx, r, w, tid) => !w.tabById(tid).sleeping && w.tabById(tid).wc.getURL().endsWith('/'), id), 'woke up');
});

await step('bookmarks', async () => {
  await main((ctx, r) => r('./actions').run('bookmark', ctx.lastFocusedWindow()));
  assert.equal(await main((ctx, r, w) => r('./bookmarks').has(w.activeTab().displayUrl)), true);
});

await step('workspaces keep their own tabs', async () => {
  const wsId = await main((ctx, r, w) => {
    const ws = r('./workspaces').create('Work');
    w.switchWorkspace(ws.id);
    return ws.id;
  });
  assert.equal(await main((ctx, r, w) => w.space().tabs.length), 1);
  assert.equal(await main((ctx, r, w) => w.activeWorkspaceId), wsId);
  const ui = await pageFor(app, (u) => u.includes('/ui/index.html'));
  await until(async () => (await ui.textContent('#ws-button')) === 'W', 'workspace button shows the new workspace');
  await wait(300);
  shot('06-workspace');
  await main((ctx, r, w) => w.switchWorkspace('home'));
  assert.ok((await main((ctx, r, w) => w.space().tabs.length)) >= 4);
});

await step('notes are saved to the workspace they were written in', async () => {
  await main((ctx, r, w) => w.togglePanel('notes'));
  const ui = await pageFor(app, (u) => u.includes('/ui/index.html'));
  await ui.waitForSelector('#panel-notes:not([hidden]) #notes');
  await wait(200);
  await ui.fill('#notes', 'roar notes');
  const other = await main((ctx) => ctx.workspaces().find((x) => x.id !== 'home').id);
  await main((ctx, r, w, id) => w.switchWorkspace(id), other);
  await until(() => main((ctx) => ctx.notes.get('home') === 'roar notes'), 'notes saved to Home');
  assert.notEqual(await main((ctx, r, w, id) => ctx.notes.get(id) || '', other), 'roar notes');
  await main((ctx, r, w) => {
    w.switchWorkspace('home');
    w.togglePanel('notes');
  });
});

await step('search engine can be picked on the new tab page', async () => {
  await main((ctx, r, w) => w.newTab());
  const nt = await activePage(app, main);
  await nt.waitForSelector('#engine-btn .engine-logo');
  await nt.click('#engine-btn', { force: true });
  await nt.waitForSelector('#engine-menu:not([hidden]) .engine-item');
  shot('07-engines');
  await nt.click('.engine-item:has-text("DuckDuckGo")', { force: true });
  await until(() => main((ctx) => ctx.settings().searchEngine === 'duckduckgo'), 'engine saved');
  assert.match(await nt.getAttribute('#search', 'placeholder'), /DuckDuckGo/);
  await nt.fill('#search', 'lion facts');
  await nt.press('#search', 'Enter');
  await until(
    () => main((ctx, r, w) => [w.activeTab().displayUrl, w.activeTab().wc.getURL()].some((u) => u.includes('duckduckgo.com'))),
    'searched with DuckDuckGo',
  );
  await main((ctx) => ctx.setSetting('searchEngine', 'google'));
});

await step('your own video plays as the new tab background', async () => {
  await main((ctx, r, w) => w.newTab());
  const nt = await activePage(app, main);
  await nt.waitForSelector('#customize-btn');
  const type = await nt.evaluate((file) => window.lions.call('useBackgroundFile', file, 'video').then((b) => b.type), path.join(root, 'test/fixtures/background.webm'));
  assert.equal(type, 'video');
  const playing = await until(
    () => nt.evaluate(() => {
      const v = document.querySelector('#bg video');
      return v && !v.paused && v.readyState >= 2 && v.currentTime > 0;
    }),
    'video playing',
  );
  assert.ok(playing);
  await nt.click('#customize-btn', { force: true });
  await nt.waitForSelector('#customize:not([hidden]) .bg-option.on');
  await wait(400);
  shot('08-video-background');
  await nt.evaluate(() => window.lions.call('clearBackground'));
  await until(() => nt.evaluate(() => !document.querySelector('#bg video')), 'background cleared');
});

await step('custom colors and the tabs-on-the-side layout', async () => {
  const ui = await pageFor(app, (u) => u.includes('/ui/index.html'));
  await main((ctx) => ctx.setSettings({ frameColor: '#1d3557', accent: '#2ea043' }));
  await until(() => ui.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === '#1d3557'), 'toolbar color applied');
  await main((ctx) => ctx.setSetting('layout', 'vertical'));
  await until(() => ui.evaluate(() => document.body.classList.contains('v') && getComputedStyle(document.getElementById('sidebar')).display !== 'none'), 'sidebar shown');
  const x = await main((ctx, r, w) => w.panes[0].x);
  assert.ok(x >= 200, `page starts after the sidebar (x=${x})`);
  await wait(500);
  shot('09-vertical-custom-colors');
  await main((ctx) => ctx.setSettings({ layout: 'horizontal', frameColor: '', accent: '#ee801b' }));
  await until(() => ui.evaluate(() => document.body.classList.contains('h')), 'back to tabs on top');
});

await step('downloads save to the downloads folder', async () => {
  await main((ctx, r, w, url) => w.activeTab().wc.downloadURL(url), `${BASE}/download`);
  await until(() => main((ctx, r) => r('./downloads').list().some((d) => d.state === 'completed')), 'download done');
  assert.ok(fs.existsSync(path.join(downloadsDir, 'roar.txt')));
  await wait(300);
  shot('10-downloads');
  await main((ctx, r, w) => w.panel && w.togglePanel(w.panel));
});

await step('unreachable sites show the error page', async () => {
  await main((ctx, r, w) => w.openUrl('http://127.0.0.1:9/'));
  await until(() => main((ctx, r, w) => w.activeTab().url.startsWith('lions://error')), 'error page');
  assert.equal(await main((ctx, r, w) => w.activeTab().displayUrl), 'http://127.0.0.1:9/');
  await wait(400);
  shot('11-error');
});

await step('settings and history pages render', async () => {
  await main((ctx, r, w) => r('./actions').run('history', w));
  const hist = await pageFor(app, (u) => u.startsWith('lions://history'));
  await hist.waitForSelector('.list-item a.title');
  await wait(300);
  shot('12-history');
  await main((ctx, r, w) => r('./actions').run('settings', w));
  const settings = await pageFor(app, (u) => u.startsWith('lions://settings'));
  await settings.waitForSelector('#privacy');
  await wait(400);
  shot('13-settings');
});

await step('dark mode', async () => {
  await main((ctx) => ctx.setSetting('theme', 'dark'));
  await main((ctx, r, w) => w.newTab());
  await wait(900);
  shot('14-dark');
  await main((ctx) => ctx.setSetting('theme', 'system'));
});

await step('private windows use a separate, in-memory session', async () => {
  await main((ctx, r) => r('./actions').openWindow({ isPrivate: true, urls: [] }));
  await until(() => main((ctx) => [...ctx.windows].some((w) => w.isPrivate)), 'private window');
  const partition = await main((ctx) => {
    const pw = [...ctx.windows].find((w) => w.isPrivate);
    return pw.activeTab().partition;
  });
  assert.match(partition, /^lions-private-/);
  await wait(800);
  shot('15-private');
  await main((ctx) => [...ctx.windows].find((w) => w.isPrivate).win.close());
});

await step('session is restored after a restart', async () => {
  const before = await main((ctx, r, w) => w.space().tabs.map((t) => t.displayUrl));
  await main((ctx, r) => r('./session').saveNow());
  await app.close();
  ({ app, main } = await launch());
  const after = await until(() => main((ctx, r, w) => w.space().tabs.length && w.space().tabs.map((t) => t.displayUrl)), 'restored');
  assert.deepEqual(after, before);
  assert.ok(await main((ctx, r) => r('./bookmarks').all().length === 1), 'bookmark persisted');
});

await app.close();
server.close();

const failed = results.filter(([s]) => s === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} passed, ${mainErrors.length} main-process errors`);
process.exit(failed.length || mainErrors.length ? 1 : 0);
