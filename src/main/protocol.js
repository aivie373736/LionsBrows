'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { app, protocol } = require('electron');

const PAGES_DIR = path.join(__dirname, '..', 'pages');
const SHARED_DIR = path.join(__dirname, '..', 'shared');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.ogv': 'video/ogg',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

const CSP = [
  "default-src 'self' lions:",
  'img-src lions: https: http: data: blob:',
  'media-src lions: blob:',
  "style-src 'self' lions: 'unsafe-inline'",
  "script-src 'self' lions:",
  "connect-src 'self' lions:",
  "frame-src 'none'",
].join('; ');

function backgroundsDir() {
  return path.join(app.getPath('userData'), 'backgrounds');
}

function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'lions', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } },
  ]);
}

function resolve(url) {
  const u = new URL(url);
  const page = u.hostname;
  const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
  const base = page === 'assets' ? SHARED_DIR : page === 'background' ? backgroundsDir() : PAGES_DIR;
  if (page === 'background' && !rel) return null;
  const file = rel ? path.normalize(path.join(base, rel)) : path.join(PAGES_DIR, `${page}.html`);
  if (!file.startsWith(base + path.sep)) return null;
  return file;
}

function notFound() {
  return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
}

async function serveRange(file, request, type) {
  const { size } = await fs.promises.stat(file);
  const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') || '');
  const headers = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-cache' };
  if (!range) {
    return new Response(Readable.toWeb(fs.createReadStream(file)), { headers: { ...headers, 'content-length': String(size) } });
  }
  let start = range[1] ? Number(range[1]) : size - Number(range[2]);
  let end = range[1] && range[2] ? Number(range[2]) : size - 1;
  start = Math.max(0, start);
  end = Math.min(end, size - 1);
  if (start > end) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
  return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
    status: 206,
    headers: { ...headers, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${size}` },
  });
}

async function handler(request) {
  if (request.url === 'lions://assets/strings.js') {
    return new Response(require('./i18n').script(), { headers: { 'content-type': MIME['.js'], 'cache-control': 'no-cache', 'access-control-allow-origin': '*' } });
  }
  const file = resolve(request.url);
  if (!file) return notFound();
  const host = new URL(request.url).hostname;
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  try {
    if (host === 'background') return await serveRange(file, request, type);
    const body = await fs.promises.readFile(file);
    return new Response(body, {
      headers: {
        'content-type': type,
        'content-security-policy': CSP,
        'cache-control': 'no-cache',
        ...(host === 'assets' ? { 'access-control-allow-origin': '*' } : {}),
      },
    });
  } catch {
    return notFound();
  }
}

function attach(ses) {
  if (!ses.protocol.isProtocolHandled('lions')) ses.protocol.handle('lions', handler);
}

module.exports = { registerScheme, attach, resolve, backgroundsDir, MIME };
