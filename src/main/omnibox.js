'use strict';

// Pure helpers for turning whatever the user typed into something to open.
// No Electron imports, so this is unit-tested with plain Node.

const { parse } = require('tldts');
const { searchUrl, parseBang } = require('./search-engines');

const SCHEME_RE = /^(https?|file|lions|about|data|blob|chrome|devtools|view-source|ftp|mailto):/i;
const IPV4_RE = /^(\d{1,3})(\.\d{1,3}){3}$/;

function hostOf(text) {
  // Strip path/query/fragment and userinfo to get the host[:port] part.
  const noPath = text.split(/[/?#]/)[0];
  const host = noPath.includes('@') ? noPath.split('@').pop() : noPath;
  return host;
}

function looksLikeHost(host) {
  const bare = host.replace(/:\d{1,5}$/, '');
  if (!bare) return false;
  if (bare === 'localhost' || bare.endsWith('.localhost')) return true;
  if (IPV4_RE.test(bare)) return bare.split('.').every((p) => Number(p) <= 255);
  if (/^\[[0-9a-f:]+\]$/i.test(bare)) return true; // IPv6 literal
  if (!/^[a-z0-9.-]+$/i.test(bare) || bare.startsWith('.') || bare.endsWith('.')) return false;
  const info = parse(bare, { allowPrivateDomains: true });
  return Boolean(info.domain && (info.isIcann || info.isPrivate)) || bare.endsWith('.local') || bare.endsWith('.lan');
}

/**
 * Classify raw input.
 * @returns {{type:'url', url:string} | {type:'search', url:string, query:string} | {type:'bang', url:string, query:string, name:string} | null}
 */
function classify(input, engineId = 'duckduckgo') {
  const text = (input || '').trim();
  if (!text) return null;

  const bang = parseBang(text);
  if (bang) return { type: 'bang', url: bang.url, query: bang.query, name: bang.name };

  if (SCHEME_RE.test(text)) {
    // A scheme with a space after it ("about: cats") is a search, not a URL.
    if (!/\s/.test(text)) return { type: 'url', url: text };
  }

  if (!/\s/.test(text)) {
    const host = hostOf(text);
    if (looksLikeHost(host)) {
      const bare = host.replace(/:\d{1,5}$/, '');
      const local = bare === 'localhost' || IPV4_RE.test(bare) || bare.endsWith('.local') || bare.endsWith('.lan') || bare.startsWith('[');
      return { type: 'url', url: `${local ? 'http' : 'https'}://${text}` };
    }
  }

  return { type: 'search', url: searchUrl(engineId, text), query: text };
}

/** Pretty version of a URL for display in the address bar. */
function displayUrl(url) {
  if (!url || url.startsWith('lions://newtab')) return '';
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || u.protocol === 'http:') {
      const host = u.host.replace(/^www\./, '');
      const rest = (u.pathname === '/' ? '' : u.pathname) + u.search + u.hash;
      return host + rest;
    }
  } catch {
    /* fall through */
  }
  return url;
}

// ---------------------------------------------------------------------------
// Calculator: a tiny recursive-descent parser so we never eval() user input.
// Supports + - * / % ^, parentheses, decimals, unary minus, and pi/e.
// ---------------------------------------------------------------------------

function calculate(input) {
  const src = (input || '').replace(/^=\s*/, '').replace(/,/g, '.').replace(/×/g, '*').replace(/÷/g, '/').trim();
  if (!src || !/[\d)]/.test(src) || !/[-+*/^%()]/.test(src)) return null;
  if (!/^[\d\s.+\-*/^%()piPIeE]+$/.test(src)) return null;

  let pos = 0;
  const peek = () => src[pos];
  const skip = () => {
    while (src[pos] === ' ') pos++;
  };

  function number() {
    skip();
    if (src.slice(pos, pos + 2).toLowerCase() === 'pi') {
      pos += 2;
      return Math.PI;
    }
    if (src[pos] === 'e' || src[pos] === 'E') {
      pos++;
      return Math.E;
    }
    const m = src.slice(pos).match(/^\d*\.?\d+|^\d+\./);
    if (!m) throw new Error('number expected');
    pos += m[0].length;
    return parseFloat(m[0]);
  }

  function primary() {
    skip();
    if (peek() === '(') {
      pos++;
      const v = expr();
      skip();
      if (peek() !== ')') throw new Error(') expected');
      pos++;
      return v;
    }
    if (peek() === '-') {
      pos++;
      return -primary();
    }
    if (peek() === '+') {
      pos++;
      return primary();
    }
    return number();
  }

  function power() {
    const base = primary();
    skip();
    if (peek() === '^') {
      pos++;
      return Math.pow(base, power()); // right-associative
    }
    return base;
  }

  function term() {
    let v = power();
    for (;;) {
      skip();
      const op = peek();
      if (op === '*' || op === '/' || op === '%') {
        pos++;
        const r = power();
        v = op === '*' ? v * r : op === '/' ? v / r : v % r;
      } else return v;
    }
  }

  function expr() {
    let v = term();
    for (;;) {
      skip();
      const op = peek();
      if (op === '+' || op === '-') {
        pos++;
        const r = term();
        v = op === '+' ? v + r : v - r;
      } else return v;
    }
  }

  try {
    const value = expr();
    skip();
    if (pos !== src.length || !Number.isFinite(value)) return null;
    return Math.round(value * 1e10) / 1e10;
  } catch {
    return null;
  }
}

module.exports = { classify, displayUrl, calculate, looksLikeHost };
