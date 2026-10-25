'use strict';

// Every workspace (and every private window) can have its own Electron
// session. This module configures each one the same way: user agent,
// lions:// pages, ad blocking, HTTPS upgrades, privacy headers, permissions
// and downloads.

const { session, app } = require('electron');
const { ctx } = require('./context');
const adblock = require('./adblock');
const downloads = require('./downloads');
const permissions = require('./permissions');
const protocol = require('./protocol');
const extensions = require('./extensions');

const configured = new WeakSet();
const upgrades = new Map(); // webContentsId -> { httpUrl, host, count, at }

/** A plain Chrome user agent so sites don't treat us as an "embedded" browser. */
function chromeUserAgent() {
  const major = process.versions.chrome.split('.')[0];
  const platform =
    process.platform === 'darwin'
      ? 'Macintosh; Intel Mac OS X 10_15_7'
      : process.platform === 'win32'
        ? 'Windows NT 10.0; Win64; x64'
        : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

function isLocalHost(host) {
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.lan') ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
    host.startsWith('[')
  );
}

function httpsUpgrade(details) {
  if (!ctx.settings().httpsUpgrade || !details.url.startsWith('http://')) return null;
  const u = new URL(details.url);
  if (isLocalHost(u.hostname) || u.port) return null;
  if (ctx.config.get('httpOnlyHosts').includes(u.hostname)) return null;

  // A site that redirects https -> http would loop forever; give up after 3 tries.
  const prev = upgrades.get(details.webContentsId);
  const recent = prev && prev.host === u.hostname && Date.now() - prev.at < 5000;
  const count = recent ? prev.count + 1 : 1;
  if (count > 3) {
    markHttpOnly(u.hostname);
    return null;
  }
  upgrades.set(details.webContentsId, { httpUrl: details.url, host: u.hostname, count, at: Date.now() });
  u.protocol = 'https:';
  return u.toString();
}

function markHttpOnly(host) {
  ctx.config.update((d) => {
    if (!d.httpOnlyHosts.includes(host)) d.httpOnlyHosts.push(host);
  });
}

/**
 * If a navigation we upgraded to HTTPS failed, return the original http:// URL
 * (and remember that this host doesn't do HTTPS).
 */
function consumeFailedUpgrade(webContentsId, failedUrl) {
  const rec = upgrades.get(webContentsId);
  if (!rec) return null;
  try {
    if (new URL(failedUrl).hostname !== rec.host) return null;
  } catch {
    return null;
  }
  upgrades.delete(webContentsId);
  markHttpOnly(rec.host);
  return rec.httpUrl;
}

function setup(ses, { isPrivate = false } = {}) {
  if (configured.has(ses)) return ses;
  configured.add(ses);

  ses.setUserAgent(chromeUserAgent());
  protocol.attach(ses);
  adblock.attach(ses);
  permissions.attach(ses, { isPrivate });
  downloads.attach(ses, { isPrivate });

  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    if (details.resourceType === 'mainFrame') {
      const upgraded = httpsUpgrade(details);
      return callback(upgraded ? { redirectURL: upgraded } : {});
    }
    adblock.onBeforeRequest(details, callback);
  });
  ses.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, callback) => {
    adblock.onHeadersReceived(details, callback);
  });
  ses.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
    const headers = details.requestHeaders;
    if (ctx.settings().gpc && details.url.startsWith('http')) headers['Sec-GPC'] = '1';
    callback({ requestHeaders: headers });
  });

  if (!isPrivate) extensions.loadInto(ses);
  return ses;
}

function forPartition(partition, opts) {
  return setup(session.fromPartition(partition), opts);
}

function init() {
  app.userAgentFallback = chromeUserAgent();
}

module.exports = { init, setup, forPartition, consumeFailedUpgrade, chromeUserAgent };
