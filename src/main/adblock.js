'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, ipcMain, net, webContents } = require('electron');
const { ctx } = require('./context');

const PRELOAD_PATH = require.resolve('@ghostery/adblocker-electron-preload');
const REFRESH_AFTER = 3 * 86_400_000;

let blocker = null;
let lib = null;
let loading = null;

function ghostery() {
  if (!lib) lib = require('@ghostery/adblocker-electron');
  return lib;
}

const fetchImpl = (url, init) => net.fetch(url, init);

function full() {
  return Boolean(ctx.settings().blockCookieBanners);
}

function cacheFile(withBanners = full()) {
  return path.join(app.getPath('userData'), withBanners ? 'adblock-engine-full.bin' : 'adblock-engine.bin');
}

async function load() {
  const withBanners = full();
  try {
    const buf = await fs.promises.readFile(cacheFile(withBanners));
    const engine = ghostery().ElectronBlocker.deserialize(new Uint8Array(buf));
    if (withBanners === full()) blocker = engine;
    const age = Date.now() - (await fs.promises.stat(cacheFile(withBanners))).mtimeMs;
    if (age > REFRESH_AFTER) refresh();
  } catch {
    if (withBanners && !blocker) {
      const basic = await fs.promises.readFile(cacheFile(false)).catch(() => null);
      if (basic) blocker = ghostery().ElectronBlocker.deserialize(new Uint8Array(basic));
    }
    await refresh();
  }
}

function reload() {
  loading = (loading || Promise.resolve()).then(load, load);
  return loading;
}

async function init() {
  ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', (event, url, msg) => {
    if (!blocker || !isActiveFor(event.sender.getURL())) return undefined;
    return blocker.onInjectCosmeticFilters(event, url, msg);
  });
  ipcMain.handle('@ghostery/adblocker/is-mutation-observer-enabled', (event) => {
    return blocker ? blocker.onIsMutationObserverEnabled(event) : false;
  });

  ctx.events.on('settings-changed', (key) => key === 'blockCookieBanners' && reload());
  await reload();
}

async function refresh() {
  const withBanners = full();
  try {
    const { ElectronBlocker } = ghostery();
    const fresh = await (withBanners ? ElectronBlocker.fromPrebuiltFull(fetchImpl) : ElectronBlocker.fromPrebuiltAdsAndTracking(fetchImpl));
    if (withBanners === full()) blocker = fresh;
    await fs.promises.writeFile(cacheFile(withBanners), fresh.serialize());
  } catch (err) {
    console.warn('[adblock] could not download filter lists:', err.message);
    if (!blocker) setTimeout(refresh, 10 * 60_000);
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

function onBeforeRequest(details, callback) {
  if (!blocker || details.resourceType === 'mainFrame') return callback({});
  const topUrl = topUrlOf(details.webContentsId);
  if (!topUrl.startsWith('http') || !isActiveFor(topUrl)) return callback({});

  const request = ghostery().Request.fromRawDetails({
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
