'use strict';

// The lions:// scheme serves LionsBrows' built-in pages:
//   lions://newtab/        -> src/pages/newtab.html
//   lions://settings/x.js  -> src/pages/x.js
//   lions://assets/logo.svg -> src/shared/logo.svg

const fs = require('node:fs');
const path = require('node:path');
const { protocol } = require('electron');

const PAGES_DIR = path.join(__dirname, '..', 'pages');
const SHARED_DIR = path.join(__dirname, '..', 'shared');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

const CSP = [
  "default-src 'self' lions:",
  'img-src lions: https: http: data: blob:',
  "style-src 'self' lions: 'unsafe-inline'",
  "script-src 'self' lions:",
  "connect-src 'self' lions:",
  "frame-src 'none'",
].join('; ');

function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'lions', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, codeCache: true } },
  ]);
}

function resolve(url) {
  const u = new URL(url);
  const page = u.hostname;
  const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
  const base = page === 'assets' ? SHARED_DIR : PAGES_DIR;
  const file = rel ? path.normalize(path.join(base, rel)) : path.join(PAGES_DIR, `${page}.html`);
  if (!file.startsWith(base + path.sep)) return null; // no ../ escapes
  return file;
}

async function handler(request) {
  const file = resolve(request.url);
  if (!file) return new Response('Not found', { status: 404 });
  try {
    const body = await fs.promises.readFile(file);
    return new Response(body, {
      headers: {
        'content-type': MIME[path.extname(file)] || 'application/octet-stream',
        'content-security-policy': CSP,
        'cache-control': 'no-cache',
        // lions://newtab may fetch() shared files from lions://assets.
        ...(new URL(request.url).hostname === 'assets' ? { 'access-control-allow-origin': '*' } : {}),
      },
    });
  } catch {
    return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  }
}

function attach(ses) {
  if (!ses.protocol.isProtocolHandled('lions')) ses.protocol.handle('lions', handler);
}

module.exports = { registerScheme, attach, resolve };
