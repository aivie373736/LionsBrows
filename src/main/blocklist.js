'use strict';

const ALLOWED_OPTIONS = new Set(['all', 'doc', 'document', 'popup', 'important']);
const HOSTNAME = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

function hash(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function keyOf(line) {
  let rule = line.trim();
  if (!rule || /^[!#[]/.test(rule) || rule.startsWith('@@') || /#[@?$%]?#/.test(rule)) return null;
  const dollar = rule.lastIndexOf('$');
  if (dollar > 0) {
    const options = rule.slice(dollar + 1).split(',').map((o) => o.trim().toLowerCase());
    if (options.some((o) => !ALLOWED_OPTIONS.has(o))) return null;
    rule = rule.slice(0, dollar);
  }
  const anchored = rule.startsWith('||');
  if (anchored) rule = rule.slice(2);
  else if (/^[|/]/.test(rule)) return null;
  rule = rule.replace(/\^\|?$/, '').replace(/\|$/, '');
  if (!rule || /[*^|\s]/.test(rule)) return null;
  const slash = rule.indexOf('/');
  const host = (slash === -1 ? rule : rule.slice(0, slash)).toLowerCase().replace(/\.$/, '');
  if (!HOSTNAME.test(host) && !IPV4.test(host.replace(/:\d+$/, ''))) return null;
  const path = slash === -1 ? '' : rule.slice(slash);
  if (!path || path === '/') return host.includes(':') ? null : host;
  return host + path;
}

function build(text) {
  const hashes = new Set();
  for (const line of text.split('\n')) {
    const key = keyOf(line);
    if (key) hashes.add(hash(key));
  }
  return Float64Array.from(hashes).sort();
}

function candidates(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return [];
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return [];
  const hostname = u.hostname.toLowerCase().replace(/\.$/, '');
  const out = [];
  if (IPV4.test(hostname)) out.push(hostname);
  else {
    const labels = hostname.split('.');
    for (let i = 0; i < labels.length - 1; i++) out.push(labels.slice(i).join('.'));
  }
  const host = u.host.toLowerCase().replace(/\.(?=:|$)/, '');
  const path = u.pathname;
  for (let i = path.indexOf('/', 1); i !== -1; i = path.indexOf('/', i + 1)) {
    out.push(host + path.slice(0, i), host + path.slice(0, i + 1));
  }
  if (path.length > 1) out.push(host + path);
  if (u.search) out.push(host + path + u.search);
  return out;
}

function contains(sorted, value) {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = sorted[mid];
    if (v === value) return true;
    if (v < value) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

function matches(sorted, url) {
  if (!sorted || !sorted.length) return false;
  return candidates(url).some((c) => contains(sorted, hash(c)));
}

module.exports = { hash, keyOf, build, candidates, matches };
