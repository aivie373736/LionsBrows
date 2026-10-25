'use strict';

// Ad & tracker blocking with Ghostery's filter engine (EasyList, EasyPrivacy
// and friends). We wire the engine up ourselves instead of using
// `enableBlockingInSession` so that it works across several sessions
// (workspaces, private windows) and respects the per-site allowlist.

const fs = require('node:fs');
const path = require('node:path');
const { app, ipcMain, net, webContents } = require('electron');
const { ElectronBlocker, Request } = require('@ghostery/adblocker-electron');
const { ctx } = require('./context');

const PRELOAD_PATH = require.resolve('@ghostery/adblocker-electron-preload');
const REFRESH_AFTER = 3 * 86_400_000; // refresh filter lists every 3 days

let blocker = null;
let cacheFile = null;

const fetchImpl = (url, init) => net.fetch(url, init);

async function init() {
  cacheFile = path.join(app.getPath('userData'), 'adblock-engine.bin');
  ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', (event, url, msg) => {
    if (!blocker || !isActiveFor(event.sender.getURL())) return undefined;
    return blocker.onInjectCosmeticFilters(event, url, msg);
  });
  ipcMain.handle('@ghostery/adblocker/is-mutation-observer-enabled', (event) => {
    return blocker ? blocker.onIsMutationObserverEnabled(event) : false;
  });

  try {
    const buf = await fs.promises.readFile(cacheFile);
    blocker = ElectronBlocker.deserialize(new Uint8Array(buf));
    const age = Date.now() - (await fs.promises.stat(cacheFile)).mtimeMs;
    if (age > REFRESH_AFTER) refresh();
  } catch {
    await refresh();
  }
}

async function refresh() {
  try {
    const fresh = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetchImpl);
    blocker = fresh;
    await fs.promises.writeFile(cacheFile, fresh.serialize());
  } catch (err) {
    console.warn('[adblock] could not download filter lists:', err.message);
    if (!blocker) setTimeout(refresh, 10 * 60_000); // try again later
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isAllowlisted(url) {
  const host = hostOf(url);
  if (!host) return false;
  return ctx.config.get('adblockAllowlist').some((h) => host === h || host.endsWith(`.${h}`));
}

function isActiveFor(topUrl) {
  return ctx.settings().adblock && !isAllowlisted(topUrl);
}

function toggleSite(url) {
  const host = hostOf(url);
  if (!host) return;
  ctx.config.update((d) => {
    const list = d.adblockAllowlist;
    const i = list.indexOf(host);
    if (i >= 0) list.splice(i, 1);
    else list.push(host);
  });
}

function topUrlOf(webContentsId) {
  const wc = webContentsId ? webContents.fromId(webContentsId) : null;
  return wc && !wc.isDestroyed() ? wc.getURL() : '';
}

/** Called from the session's onBeforeRequest for every non-main-frame request. */
function onBeforeRequest(details, callback) {
  if (!blocker || details.resourceType === 'mainFrame') return callback({});
  const topUrl = topUrlOf(details.webContentsId);
  if (!topUrl.startsWith('http') || !isActiveFor(topUrl)) return callback({});

  const request = Request.fromRawDetails({
    requestId: `${details.id}`,
    sourceUrl: details.frame?.url || topUrl,
    tabId: details.webContentsId,
    type: details.resourceType || 'other',
    url: details.url,
  });
  if (request.type === 'other') request.guessTypeOfRequest();

  const { redirect, match } = blocker.match(request);
  if (redirect) callback({ redirectURL: redirect.dataUrl });
  else if (match) callback({ cancel: true });
  else return callback({});
  ctx.events.emit('request-blocked', details.webContentsId);
}

function isReady() {
  return Boolean(blocker);
}

function onHeadersReceived(details, callback) {
  if (!blocker || !ctx.settings().adblock) return callback({});
  return blocker.onHeadersReceived(details, callback);
}

function attach(ses) {
  ses.registerPreloadScript({ type: 'frame', filePath: PRELOAD_PATH });
}

module.exports = { init, refresh, isReady, attach, onBeforeRequest, onHeadersReceived, isAllowlisted, toggleSite, hostOf };
