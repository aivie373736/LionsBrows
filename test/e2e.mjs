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
  '/cookies': `<title>Cookies</title><p>Lions everywhere</p><div id="cookie-banner">We use cookies. <button>Accept all</button></div>`,
  '/article': `<title>All about lions</title><header><nav><a href="/">Home</a> <a href="/two">Two</a></nav></header>
        <article><h1>All about lions</h1><p class="byline">By Leo Roar</p>
        ${Array.from({ length: 8 }, (_, i) => `<p>${'The lion is a large cat of the genus Panthera native to Africa and India. It has a muscular, broad-chested body, a short rounded head, round ears and a hairy tuft at the end of its tail. '.repeat(3)} Paragraph ${i + 1}.</p>`).join('')}
        <p><img src="/lion.png" onerror="window.pwned = 1" alt="A lion"></p><script>window.inlineRan = 1</script></article>
        <footer>Copyright</footer>`,
  '/opener': `<title>Opener</title><script>window.openedOk = () => !!window.opener;</script>`,
  '/shadow-login': `<title>Shadow login</title><login-box></login-box><script>
        customElements.define('login-box', class extends HTMLElement { constructor() { super(); this.attachShadow({ mode: 'open' }).innerHTML = '<input name="username" type="text"><input name="password" type="password"><button id="go">Log in</button>'; this.shadowRoot.getElementById('go').onclick = () => setTimeout(() => (location.href = '/two?shadow'), 100); } });
        </script>`,
  '/step1': `<title>Step 1</title><form action="/step2"><input type="email" name="identifier" autocomplete="username"><button>Next</button></form>`,
  '/step2': `<title>Step 2</title><form action="/two"><input type="password" name="Passwd" autocomplete="current-password"><button>Next</button></form>`,
  '/autoplay': `<title>Autoplay</title><video src="/background.webm"></video>`,
  '/french': `<html lang="fr-FR"><title>Lions</title><p>Le lion est un grand félin.</p>`,
  '/video': `<title>Video</title><video src="/background.webm" width="320" height="180" loop></video>`,
  '/signup': `<title>Create account</title><form action="/two" method="get"><input id="email" name="email" type="email" autocomplete="username"><input id="new" name="password" type="password" autocomplete="new-password"><input id="confirm" name="confirm" type="password" autocomplete="new-password"><button id="create" type="submit">Create account</button></form>`,
  '/login': `<title>Sign in</title><form action="/two" method="get"><input id="user" name="u" type="email" autocomplete="username"><input id="pass" name="p" type="password" autocomplete="current-password"><button id="go" type="submit">Sign in</button></form>`,
  '/download': null,
};

function signedPackage(files) {
  const crypto = require('node:crypto');
  const { zipSync, strToU8 } = require('fflate');
  const varint = (n) => {
    const out = [];
    for (; n > 127; n = Math.floor(n / 128)) out.push((n & 127) | 128);
    return Buffer.from([...out, n]);
  };
  const field = (num, bytes) => Buffer.concat([varint(num * 8 + 2), varint(bytes.length), bytes]);
  const u32 = (n) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    return b;
  };
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = publicKey.export({ type: 'spki', format: 'der' });
  const signedData = field(1, crypto.createHash('sha256').update(key).digest().subarray(0, 16));
  const archive = Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name, data]) => [name, typeof data === 'string' ? strToU8(data) : new Uint8Array(data)]))));
  const signature = crypto.sign('sha256', Buffer.concat([Buffer.from('CRX3 SignedData\x00', 'latin1'), u32(signedData.length), signedData, archive]), privateKey);
  const header = Buffer.concat([field(2, Buffer.concat([field(1, key), field(2, signature)])), field(10000, signedData)]);
  const id = require(path.join(root, 'src/main/crx.js')).idFromKey(key);
  return { id, buf: Buffer.concat([Buffer.from('Cr24'), u32(3), u32(header.length), header, archive]) };
}

const ROAR = signedPackage({
  'manifest.json': JSON.stringify({ manifest_version: 3, name: 'Roar Counter', version: '1.0.0', description: 'Counts roars', action: { default_popup: 'popup.html', default_title: 'Roar Counter' }, icons: { 48: 'icon.png' } }),
  'icon.png': fs.readFileSync(path.join(root, 'src/shared/icon.png')),
  'popup.html': '<!doctype html><meta charset="utf-8"><body style="width:220px;height:90px;margin:0">Roar!<script src="popup.js"></script></body>',
  'popup.js': "chrome.action.setBadgeText({ text: '7' }); document.body.dataset.ready = '1';",
});

const server = http.createServer((req, res) => {
  if (req.url === '/roar.crx') {
    res.writeHead(200, { 'content-type': 'application/x-chrome-extension' });
    return res.end(ROAR.buf);
  }
  if (req.url === '/background.webm') {
    res.writeHead(200, { 'content-type': 'video/webm' });
    return res.end(fs.readFileSync(path.join(root, 'test/fixtures/background.webm')));
  }
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
    args: [root, '--no-sandbox', '--host-resolver-rules=MAP *.lions.test 127.0.0.1'],
    env: { ...process.env, LIONSBROWS_USER_DATA: profile, LIONSBROWS_TEST: '1' },
  });
  app.process().stderr.on('data', (d) => {
    const text = String(d);
    if (/\[main\]|Error:/.test(text) && !/Failed to load URL|Error: Not allowed/.test(text)) {
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
  return until(async () => {
    await main((ctx, r, w, m) => !w.activeTab().wc.isLoading() && w.activeTab().wc.executeJavaScript(`window.e2eMark = ${JSON.stringify(m)}; true`), mark);
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
    await main((ctx) => {
      for (const w of ctx.windows) {
        w.hideBubble?.(false);
        w.closePalette?.();
        if (w.activeTab()) w.activeTab().pendingLogin = null;
      }
    }).catch(() => {});
  }
}

console.log(`LionsBrows e2e · profile ${profile}`);
let { app, main } = await launch();

await step('starts with a new tab page and the UI', async () => {
  const ui = await pageFor(app, (u) => u.includes('/ui/index.html'));
  await ui.waitForSelector('.tab.active');
  assert.equal(await ui.textContent('.tab.active .title'), 'New Tab');
  for (const id of ['ws-button', 'btn-split', 'btn-notes', 'btn-downloads', 'btn-alltabs']) {
    assert.equal(await ui.$eval(`#${id}`, (e) => e.hidden), true, `#${id} hidden by default`);
  }
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

await step('cookie banners are hidden', async () => {
  const url = BASE.replace('127.0.0.1', 'cookies.lions.test') + '/cookies';
  await main((ctx, r, w, u) => w.newTab({ url: u }), url);
  const page = await activePage(app, main);
  const hidden = () => page.evaluate(() => getComputedStyle(document.getElementById('cookie-banner')).display === 'none');
  await until(hidden, 'banner hidden');
  await main((ctx) => ctx.setSetting('blockCookieBanners', false));
  await until(async () => {
    await page.reload();
    await page.waitForSelector('#cookie-banner', { state: 'attached' });
    await wait(300);
    return !(await hidden());
  }, 'banner shown when turned off', 60000);
  await main((ctx) => ctx.setSetting('blockCookieBanners', true));
  await main((ctx, r, w) => w.closeTab(w.activeTab().id));
});

await step('dangerous sites show a warning first', async () => {
  await main((ctx, r) => r('./safety').setList('phishing', r('./blocklist').build('danger.lions.test')));
  const url = BASE.replace('127.0.0.1', 'danger.lions.test') + '/two';
  await main((ctx, r, w, u) => w.newTab({ url: u }), url);
  const warning = await pageFor(app, (u) => u.startsWith('lions://error/') && u.includes('code=dangerous'));
  await warning.waitForSelector('body.danger');
  assert.equal(await warning.textContent('#title'), 'Dangerous site ahead');
  assert.equal(await main((ctx, r, w) => w.activeTab().displayUrl), url);
  await wait(200);
  shot('03b-dangerous-site');
  await warning.click('#back');
  await until(() => main((ctx, r, w, u) => w.activeTab().wc.getURL() === u, url), 'continued to the site');
  await main((ctx, r, w) => w.closeTab(w.activeTab().id));
  await main((ctx, r) => r('./safety').setList('phishing', new Float64Array()));
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

await step('the address bar completes sites you have visited', async () => {
  const host = new URL(BASE).host;
  await main((ctx, r, w) => w.openPalette('address'));
  const overlay = await pageFor(app, (u) => u.includes('/ui/overlay.html'));
  await overlay.waitForSelector('#q');
  await overlay.fill('#q', '');
  await overlay.locator('#q').pressSequentially('127.0.');
  const completed = (h) => overlay.evaluate((value) => {
    const q = document.getElementById('q');
    return q.value === value && q.selectionStart === 6 && q.selectionEnd === value.length;
  }, h);
  await until(() => completed(host), 'inline completion');
  await overlay.press('#q', 'Backspace');
  await until(() => overlay.evaluate(() => document.getElementById('q').value === '127.0.' && !document.querySelector('.item.sel')?.textContent.includes(':')), 'completion removed');
  await overlay.locator('#q').pressSequentially('0');
  await until(() => overlay.evaluate((h) => document.getElementById('q').value === h, host), 'completed again');
  await overlay.press('#q', 'Enter');
  await until(() => main((ctx, r, w, base) => w.activeTab().wc.getURL() === `${base}/`, BASE), 'opened the completed site');
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

await step('memory saver keeps only a few background tabs awake', async () => {
  await main((ctx) => ctx.setSetting('memorySaver', 'maximum'));
  for (let i = 0; i < 6; i++) await main((ctx, r, w, url) => void w.newTab({ url, background: true }), `${BASE}/two?bg=${i}`);
  await wait(600);
  await main((ctx, r) => r('./memory').enforce());
  const awake = await main((ctx, r, w) => {
    const visible = w.visibleTabs();
    return w.allTabs().filter((t) => t.view && !visible.includes(t)).length;
  });
  assert.ok(awake <= 3, `awake background tabs: ${awake}`);
  const report = await main((ctx, r) => r('./memory').report());
  assert.ok(report.total > 0, 'memory total reported');
  assert.ok(report.tabs.some((t) => t.sleeping), 'some tabs asleep');
  await main((ctx) => ctx.setSetting('memorySaver', 'auto'));
});

await step('reader view shows a clean, safe version of articles', async () => {
  await main((ctx, r, w, url) => w.openUrl(url), `${BASE}/article`);
  await until(() => main((ctx, r, w) => w.activeTab().readerable), 'article is readerable').catch(async (err) => {
    const info = await main(async (ctx, r, w) => ({ url: w.activeTab().wc.getURL(), loading: w.activeTab().wc.isLoading(), direct: await r('./reader').check(w.activeTab()) }));
    throw new Error(`${err.message} ${JSON.stringify(info)}`);
  });
  const ui = await pageFor(app, (u) => u.includes('/ui/index.html'));
  await until(() => ui.$eval('#addr-reader', (e) => !e.hidden), 'reader button shown');
  await main((ctx, r, w) => r('./actions').run('reader', w));
  await until(() => main((ctx, r, w) => w.activeTab().url.startsWith('lions://reader')), 'reader opened');
  assert.equal(await main((ctx, r, w) => w.activeTab().displayUrl), `${BASE}/article`);
  const page = await activePage(app, main);
  await page.waitForSelector('#article:not([hidden]) #content p');
  assert.equal(await page.textContent('#title'), 'All about lions');
  assert.equal(await page.$$eval('#content script, #content [onerror]', (n) => n.length), 0);
  assert.equal(await page.evaluate(() => window.pwned || null), null);
  assert.equal(await page.evaluate(() => typeof window.lions.call), 'function');
  await assert.rejects(page.evaluate(() => window.lions.call('historyList', {})));
  await page.click('[data-theme="sepia"]', { force: true });
  await until(() => main((ctx) => ctx.settings().readerTheme === 'sepia'), 'reader theme saved');
  await wait(300);
  shot('05b-reader');
  await main((ctx) => ctx.setSetting('readerTheme', 'auto'));
  await main((ctx, r, w) => r('./actions').run('reader', w));
  await until(() => main((ctx, r, w, url) => w.activeTab().url === url, `${BASE}/article`), 'back to the article');
});

await step('Widevine is available for protected content', async () => {
  const status = await main(async (ctx, r) => {
    const { components } = r('electron');
    await components.whenReady();
    return components.status();
  });
  assert.ok(Object.values(status).some((c) => /Widevine/.test(c.title)), JSON.stringify(status));
  const page = await activePage(app, main);
  const supported = await page.evaluate(() =>
    navigator
      .requestMediaKeySystemAccess('com.widevine.alpha', [{ initDataTypes: ['cenc'], videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }] }])
      .then(() => true, (err) => String(err)),
  );
  assert.equal(supported, true);
});

await step('passwords are offered for saving, filled in and listed in settings', async () => {
  await main((ctx, r, w, url) => w.openUrl(url), `${BASE}/login`);
  let page = await activePage(app, main);
  await page.waitForSelector('#pass');
  await page.fill('#user', 'leo@example.com');
  await page.fill('#pass', 'roar-123');
  await page.click('#go', { force: true });
  const bubble = await pageFor(app, (u) => u.includes('/ui/bubble.html'));
  await bubble.waitForSelector('#card:not([hidden])');
  assert.match(await bubble.textContent('#title'), /127\.0\.0\.1/);
  assert.equal(await bubble.inputValue('#username'), 'leo@example.com');
  await wait(300);
  shot('05c-save-password');
  await bubble.click('#primary', { force: true });
  await until(() => main((ctx) => ctx.passwords.list().length === 1), 'password saved');
  assert.equal(await main((ctx) => ctx.passwords.list()[0].username), 'leo@example.com');
  assert.equal(await main((ctx, r, w) => w.bubbleOpen), false);

  await main((ctx, r, w, url) => w.openUrl(url), `${BASE}/login?again`);
  page = await activePage(app, main);
  await until(() => page.inputValue('#pass').then((v) => v === 'roar-123'), 'password filled in');
  assert.equal(await page.inputValue('#user'), 'leo@example.com');
  const ui = await pageFor(app, (u) => u.includes('/ui/index.html'));
  await until(() => ui.$eval('#addr-key', (e) => !e.hidden), 'key icon shown');

  await main((ctx, r, w) => w.newTab({ url: 'lions://settings/#passwords' }));
  const settings = await activePage(app, main);
  await settings.waitForSelector('#passwords .list-item.login');
  assert.match(await settings.textContent('#passwords .list-item.login'), /leo@example\.com/);
  assert.equal(await settings.evaluate((id) => window.lions.call('passwordReveal', id), await main((ctx) => ctx.passwords.list()[0].id)), 'roar-123');
  await main((ctx, r, w) => r('./actions').run('history', w));
  const hist = await pageFor(app, (u) => u.startsWith('lions://history'));
  await assert.rejects(hist.evaluate(() => window.lions.call('passwordsInfo')));
  await main((ctx, r, w, url) => w.openUrl(url), `${BASE}/two?after-passwords`);
  await until(() => main((ctx, r, w) => w.activeTab().title === 'Page Two'), 'back on a web page');
});

await step('logins inside web components and two-step logins are captured and filled', async () => {
  const reset = () => main((ctx, r, w) => {
    w.hideBubble(false);
    w.activeTab().pendingLogin = null;
    for (const l of ctx.passwords.list()) ctx.passwords.remove(l.id);
  });
  const open = async (url) => {
    await main((ctx, r, w, u) => w.openUrl(u), url);
    await until(() => main((ctx, r, w, u) => w.activeTab().wc.getURL() === u && !w.activeTab().wc.isLoading(), url), 'page loaded');
    return activePage(app, main);
  };
  const pendingName = () => until(() => main((ctx, r, w) => w.activeTab().pendingLogin && w.activeTab().pendingLogin.username), 'login captured');
  const saveIt = () => main((ctx, r, w) => {
    r('./logins').save(w.activeTab());
    w.hideBubble(false);
  });

  await reset();
  let page = await open(`${BASE}/shadow-login`);
  await page.fill('input[name="username"]', 'shadowlion');
  await page.fill('input[name="password"]', 'shadow-pw');
  await page.click('#go', { force: true });
  assert.equal(await pendingName(), 'shadowlion');
  await saveIt();
  page = await open(`${BASE}/shadow-login?again`);
  await until(() => page.inputValue('input[name="password"]').then((v) => v === 'shadow-pw'), 'filled inside the web component');

  await reset();
  page = await open(`${BASE}/step1`);
  await page.fill('input[type="email"]', 'two.step@example.com');
  await page.click('button', { force: true });
  await until(() => main((ctx, r, w) => w.activeTab().wc.getURL().includes('/step2') && !w.activeTab().wc.isLoading()), 'second step');
  page = await activePage(app, main);
  await page.fill('input[type="password"]', 'two-step-pw');
  await page.click('button', { force: true });
  assert.equal(await pendingName(), 'two.step@example.com');
  await saveIt();
  page = await open(`${BASE}/step1?again`);
  await until(() => page.inputValue('input[type="email"]').then((v) => v === 'two.step@example.com'), 'username filled on step 1');
  page = await open(`${BASE}/step2?again`);
  await until(() => page.inputValue('input[type="password"]').then((v) => v === 'two-step-pw'), 'password filled on step 2');
  await reset();
});

await step('sign-up forms get a strong password that is saved', async () => {
  const url = BASE.replace('127.0.0.1', 'signup.lions.test') + '/signup';
  const origin = new URL(url).origin;
  await main((ctx, r, w, u) => w.newTab({ url: u }), url);
  const page = await activePage(app, main);
  await page.fill('#email', 'leo@lions.test');
  await page.click('#new');
  await page.waitForSelector('lionsbrows-suggestion');
  await wait(200);
  shot('09c-strong-password');
  await page.click('lionsbrows-suggestion');
  const [first, second] = await page.evaluate(() => [document.getElementById('new').value, document.getElementById('confirm').value]);
  assert.equal(first.length, 16);
  assert.equal(first, second);
  assert.match(first, /[a-z]/);
  assert.match(first, /[A-Z]/);
  assert.match(first, /[0-9]/);
  assert.equal(await page.$('lionsbrows-suggestion'), null);
  await page.click('#create');
  await until(() => main((ctx, r, w, o) => ctx.passwords.forOrigin(o).length === 1, origin), 'generated password saved');
  const saved = await main((ctx, r, w, o) => {
    const login = ctx.passwords.forOrigin(o)[0];
    return { username: login.username, password: ctx.passwords.credentials(login.id).password };
  }, origin);
  assert.deepEqual(saved, { username: 'leo@lions.test', password: first });
  assert.equal(await main((ctx, r, w) => w.bubbleOpen), false);
  await main((ctx, r, w) => w.closeTab(w.activeTab().id));
});

await step('autoplay with sound is blocked by default', async () => {
  await main((ctx, r, w, url) => w.openUrl(url), `${BASE}/autoplay`);
  await until(() => main((ctx, r, w) => w.activeTab().title === 'Autoplay'), 'autoplay page');
  const play = (muted) =>
    main((ctx, r, w, m) => w.activeTab().wc.executeJavaScript(`(() => { const v = document.querySelector('video'); v.muted = ${m}; return v.play().then(() => 'played', (e) => e.name); })()`, false), muted);
  assert.equal(await play(false), 'NotAllowedError');
  assert.equal(await play(true), 'played');
});

await step('videos keep playing in picture in picture when you switch tabs', async () => {
  await main((ctx, r, w, url) => w.newTab({ url }), `${BASE}/video`);
  const page = await activePage(app, main);
  assert.equal(await main((ctx, r, w) => w.activeTab().wc.executeJavaScript(`document.querySelector('video').play().then(() => true)`, true)), true);
  const videoTab = await main((ctx, r, w) => {
    w.activeTab().audible = true;
    return w.activeTab().id;
  });
  await main((ctx, r, w) => w.newTab());
  await until(() => page.evaluate(() => Boolean(document.pictureInPictureElement)), 'video in picture in picture');
  await main((ctx, r, w, id) => w.activate(id), videoTab);
  await until(() => page.evaluate(() => !document.pictureInPictureElement), 'picture in picture closed on return');
  await main((ctx, r, w) => r('./media').togglePip(w.activeTab()));
  await until(() => page.evaluate(() => Boolean(document.pictureInPictureElement)), 'command bar action');
  await main((ctx, r, w) => r('./media').togglePip(w.activeTab()));
  await until(() => page.evaluate(() => !document.pictureInPictureElement), 'toggled off');
  await main((ctx, r, w, id) => {
    w.closeTab(id);
    w.closeTab(w.activeTab().id);
  }, videoTab);
});

await step('the page language is detected for translation', async () => {
  await main((ctx, r, w, url) => w.newTab({ url }), `${BASE}/french`);
  await activePage(app, main);
  await until(() => main((ctx, r, w) => w.activeTab().language === 'fr-FR'), 'language detected');
  const offer = await main((ctx, r) => r('./translate').offer('https://fr.wikipedia.org/wiki/Lion', 'fr-FR', 'en'));
  assert.equal(offer, 'translate');
  assert.equal(await main((ctx, r, w) => w.state().nav.translate), null);
  await main((ctx, r, w) => w.closeTab(w.activeTab().id));
});

await step('selected text can be shared as a link to the highlight', async () => {
  const link = await main((ctx, r) => r('./menus').highlightLink('https://example.com/page#top', 'The lion  sleeps\ntonight - really'));
  assert.equal(link, 'https://example.com/page#:~:text=The%20lion%20sleeps%20tonight%20%2D%20really');
  const long = await main((ctx, r) => r('./menus').highlightLink('https://example.com/', 'one two three four five six seven eight nine ten eleven twelve'));
  assert.equal(long, 'https://example.com/#:~:text=one%20two%20three%20four,nine%20ten%20eleven%20twelve');
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
  const ui = await pageFor(app, (u) => u.includes('/ui/index.html'));
  await until(() => ui.$eval('#btn-downloads', (e) => !e.hidden), 'downloads button appears');
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
  await settings.waitForSelector('#performance .mem-value');
  await wait(400);
  shot('13-settings');
});

await step('the site panel shows the connection and changes permissions for the site', async () => {
  await main((ctx, r, w, url) => w.openUrl(url), `${BASE}/two`);
  await activePage(app, main);
  const ui = await pageFor(app, (u) => u.includes('/ui/index.html'));
  await ui.click('#addr-icon');
  const bubble = await pageFor(app, (u) => u.includes('/ui/bubble.html'));
  await until(() => bubble.isVisible('#site'), 'site panel');
  assert.equal(await bubble.textContent('#site-title'), new URL(BASE).host);
  assert.equal(await bubble.textContent('#site-status'), 'Connection is not secure');
  await bubble.click('#site-perms .site-row:nth-child(1) button[data-value="block"]');
  await until(() => main((ctx, r, w, origin) => ctx.config.get('permissions')[origin]?.['media:video'] === 'deny', BASE), 'camera blocked for the site');
  assert.equal(await bubble.isVisible('#site-reload'), true);
  await wait(200);
  shot('16c-site-panel');
  await bubble.click('#site-perms .site-row:nth-child(1) button[data-value="ask"]');
  await until(() => main((ctx, r, w, origin) => !ctx.config.get('permissions')[origin], BASE), 'camera back to ask');
  await bubble.click('#site-close');
  await until(() => main((ctx, r, w) => !w.bubbleOpen), 'panel closed');
});

await step('a QR code opens the page on a phone', async () => {
  await main((ctx, r, w) => r('./actions').run('qrCode', w));
  const bubble = await pageFor(app, (u) => u.includes('/ui/bubble.html'));
  await until(() => bubble.isVisible('#qr'), 'QR panel');
  assert.equal(await bubble.textContent('#qr-url'), `${BASE}/two`);
  assert.ok((await bubble.$$('#qr-code svg path')).length > 0);
  await wait(200);
  shot('16d-qr-code');
  await bubble.click('#qr-copy');
  await until(async () => (await app.evaluate(({ clipboard }) => clipboard.readText())) === `${BASE}/two`, 'link copied');
  await bubble.click('#qr-close');
  await until(() => main((ctx, r, w) => !w.bubbleOpen), 'panel closed');
});

await step('extensions install from a signed package, sit in the toolbar and open their popup', async () => {
  await main((ctx, r, w, a) => r('./extensions').installFromStore(a.id, a.url), { id: ROAR.id, url: `${BASE}/roar.crx` });
  const ui = await pageFor(app, (u) => u.includes('/ui/index.html'));
  await until(async () => (await ui.$$('#ext-pinned button img')).length === 1, 'extension button with its icon');
  assert.equal(await ui.getAttribute('#ext-pinned button', 'title'), 'Roar Counter');
  assert.equal(await ui.isVisible('#btn-extensions'), true);
  await ui.click('#ext-pinned button');
  const popup = await pageFor(app, (u) => u.startsWith(`chrome-extension://${ROAR.id}/popup.html`));
  await until(() => popup.evaluate(() => document.body.dataset.ready === '1'), 'popup script ran');
  await until(() => main(() => require('electron').BrowserWindow.getAllWindows().some((b) => b.isVisible() && b.webContents.getURL().includes('/popup.html'))), 'popup is shown');
  await until(async () => (await ui.textContent('#ext-pinned .ext-badge').catch(() => '')) === '7', 'badge set by the extension');
  await wait(300);
  shot('16b-extension-popup');
  await main(() => require('electron').BrowserWindow.getAllWindows().forEach((b) => b.webContents.getURL().includes('/popup.html') && b.destroy()));
  const listed = await main((ctx, r) => r('./extensions').list());
  assert.deepEqual([listed.length, listed[0].name, listed[0].source, listed[0].version], [1, 'Roar Counter', 'store', '1.0.0']);
  await main((ctx, r, w, id) => r('./extensions').setPinned(id, false), ROAR.id);
  await until(async () => (await ui.$$('#ext-pinned button')).length === 0, 'unpinned');
  await main((ctx, r, w, id) => r('./extensions').remove(id), ROAR.id);
  await until(async () => !(await ui.isVisible('#btn-extensions')), 'extension removed');
  assert.deepEqual(await main((ctx, r) => r('./extensions').list()), []);
});

await step('first-start setup applies privacy choices', async () => {
  assert.equal(await main((ctx) => ctx.settings().welcomeDone), false);
  await main((ctx, r, w) => w.newTab({ url: 'lions://welcome/' }));
  const page = await activePage(app, main);
  await page.waitForSelector('.step[data-step="welcome"]:not([hidden])');
  shot('16a-welcome');
  await page.click('#next', { force: true });
  await page.waitForSelector('.step[data-step="permissions"]:not([hidden])');
  await page.click('#permission-rows .row:nth-child(1) .seg button[data-value="block"]', { force: true });
  await until(() => main((ctx) => ctx.settings().defaultCamera === 'block'), 'camera blocked');
  await page.click('#next', { force: true });
  await page.waitForSelector('.step[data-step="privacy"]:not([hidden])');
  await page.click('.preset[data-preset="strict"]', { force: true });
  await until(() => main((ctx) => ctx.settings().blockThirdPartyCookies && ctx.settings().defaultLocation === 'block'), 'strict preset');
  await page.waitForSelector('.preset[data-preset="strict"].on');
  await wait(300);
  shot('16b-welcome-privacy');
  for (let i = 0; i < 4 && !(await page.isVisible('.step[data-step="done"]')); i++) await page.click('#next', { force: true });
  await page.waitForSelector('.step[data-step="done"]:not([hidden])');
  await page.click('#next', { force: true });
  await until(() => main((ctx, r, w) => ctx.settings().welcomeDone && w.activeTab().url.startsWith('lions://newtab')), 'setup finished');

  await main((ctx, r, w, url) => w.openUrl(url), `${BASE}/two?privacy`);
  await until(() => main((ctx, r, w) => w.activeTab().title === 'Page Two'), 'web page');
  const state = await main((ctx, r, w) => w.activeTab().wc.executeJavaScript("navigator.permissions.query({ name: 'geolocation' }).then((p) => p.state)"));
  assert.equal(state, 'denied');

  await main((ctx, r, w) => w.activeTab().wc.executeJavaScript("document.cookie = 'lion=roar; max-age=3600'; document.cookie"));
  assert.ok((await main((ctx, r, w) => w.activeTab().wc.session.cookies.get({}))).length > 0, 'cookie set');
  await main((ctx, r) => r('./sessions').clearSiteData());
  assert.equal((await main((ctx, r, w) => w.activeTab().wc.session.cookies.get({}))).length, 0, 'cookies cleared');

  await main((ctx) =>
    ctx.setSettings({ defaultCamera: 'ask', blockThirdPartyCookies: false, defaultLocation: 'ask', defaultNotifications: 'ask', searchSuggestions: true }),
  );
});

await step('dark mode', async () => {
  await main((ctx) => ctx.setSetting('theme', 'dark'));
  await main((ctx, r, w) => w.newTab());
  await wait(900);
  shot('14-dark');
  await main((ctx) => ctx.setSetting('theme', 'system'));
});

await step('closed windows can be reopened like tabs', async () => {
  await main((ctx, r, w, base) => r('./actions').openWindow({ urls: [`${base}/two`, `${base}/article`] }), BASE);
  await until(() => main((ctx) => ctx.windows.size === 2), 'second window');
  await until(() => main((ctx) => [...ctx.windows][1].allTabs().every((t) => t.title)), 'second window loaded');
  await main((ctx) => [...ctx.windows][1].win.close());
  await until(() => main((ctx) => ctx.windows.size === 1 && ctx.closedWindows.length === 1), 'window closed and remembered');
  await main((ctx, r) => r('./actions').run('reopenTab', [...ctx.windows][0]));
  await until(() => main((ctx) => ctx.windows.size === 2), 'window reopened');
  const urls = await main((ctx) => [...ctx.windows][1].space().tabs.map((t) => t.displayUrl));
  assert.deepEqual(urls, [`${BASE}/two`, `${BASE}/article`]);
  assert.equal(await main((ctx) => ctx.closedWindows.length), 0);
  await until(() => main((ctx) => !([...ctx.windows][1].activeTab()?.loading ?? true)), 'reopened window loaded');
  await main((ctx, r, w, base) => [...ctx.windows].find((x) => x.allTabs().some((t) => t.displayUrl === `${base}/two`))?.win.close(), BASE);
  await until(() => main((ctx) => ctx.windows.size === 1), 'back to one window');
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

await step('switching the language to German translates the browser after a restart', async () => {
  await main((ctx) => ctx.setSetting('language', 'de'));
  await main((ctx) => ctx.flushAll());
  await app.close();
  ({ app, main } = await launch());
  const ui = await pageFor(app, (u) => u.includes('/ui/index.html'));
  await until(async () => (await ui.getAttribute('#addr-reader', 'title')) === 'Leseansicht', 'toolbar in German');
  await main((ctx, r, w) => r('./actions').run('settings', w));
  const settings = await pageFor(app, (u) => u.startsWith('lions://settings'));
  await settings.waitForSelector('#general .section-title');
  assert.equal((await settings.textContent('#general .section-title')).trim(), 'Allgemein');
  assert.equal(await settings.evaluate(() => document.documentElement.lang), 'de');
  await wait(400);
  shot('16-german-settings');
  await main((ctx, r, w) => w.newTab());
  const nt = await activePage(app, main);
  await nt.waitForSelector('#search');
  assert.match(await nt.getAttribute('#search', 'placeholder'), /suchen/);
  await main((ctx) => ctx.setSetting('language', 'auto'));
});

await app.close();
server.close();

const failed = results.filter(([s]) => s === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} passed, ${mainErrors.length} main-process errors`);
process.exit(failed.length || mainErrors.length ? 1 : 0);
