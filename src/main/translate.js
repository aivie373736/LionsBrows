'use strict';

const PROXY = '.translate.goog';
const NAMES = { en: 'English', de: 'Deutsch' };

function translatable(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return (u.protocol === 'https:' || u.protocol === 'http:') && !u.port && /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(u.hostname) && !u.hostname.endsWith(PROXY);
}

function proxyUrl(url, target) {
  if (!translatable(url)) return null;
  const u = new URL(url);
  const proxied = new URL(`https://${u.hostname.replace(/-/g, '--').replace(/\./g, '-')}${PROXY}${u.pathname}`);
  for (const [k, v] of u.searchParams) proxied.searchParams.append(k, v);
  proxied.searchParams.set('_x_tr_sl', 'auto');
  proxied.searchParams.set('_x_tr_tl', target);
  proxied.searchParams.set('_x_tr_hl', target);
  if (u.protocol === 'http:') proxied.searchParams.set('_x_tr_sch', 'http');
  proxied.hash = u.hash;
  return proxied.toString();
}

function originalUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || !u.hostname.endsWith(PROXY)) return null;
  const host = u.hostname.slice(0, -PROXY.length).replace(/--/g, '\0').replace(/-/g, '.').replace(/\0/g, '-');
  const original = new URL(`${u.searchParams.get('_x_tr_sch') === 'http' ? 'http' : 'https'}://${host}${u.pathname}`);
  for (const [k, v] of u.searchParams) if (!k.startsWith('_x_tr_')) original.searchParams.append(k, v);
  original.hash = u.hash;
  return original.toString();
}

function primary(language) {
  return String(language || '')
    .trim()
    .toLowerCase()
    .split(/[-_]/)[0];
}

function offer(url, pageLanguage, uiLanguage) {
  if (originalUrl(url)) return 'original';
  const page = primary(pageLanguage);
  return page && /^[a-z]{2,3}$/.test(page) && page !== primary(uiLanguage) && translatable(url) ? 'translate' : null;
}

function detect(wc) {
  return wc.executeJavaScriptInIsolatedWorld(1013, [{ code: 'document.documentElement.lang || document.querySelector("meta[http-equiv=content-language i]")?.content || ""' }]).catch(() => '');
}

module.exports = { translatable, proxyUrl, originalUrl, offer, primary, detect, NAMES };
