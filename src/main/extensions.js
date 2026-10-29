'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { app, dialog, ipcMain, nativeImage, net, session, webContents } = require('electron');
const { ctx } = require('./context');
const crx = require('./crx');
const i18n = require('./i18n');
const { tr } = i18n;

const STORE_ORIGIN = 'https://chromewebstore.google.com';
const UPDATE_URL = 'https://clients2.google.com/service/update2/crx';
const MAX_DOWNLOAD = 256 * 1024 * 1024;
const FIRST_UPDATE_CHECK = 60 * 1000;
const UPDATE_EVERY = 5 * 60 * 60 * 1000;
const ALL_SITES = new Set(['<all_urls>', '*://*/*', 'http://*/*', 'https://*/*']);
const ABILITIES = {
  tabs: 'Read your browsing history',
  history: 'Read and change your browsing history',
  bookmarks: 'Read and change your bookmarks',
  downloads: 'Manage your downloads',
  notifications: 'Display notifications',
  clipboardRead: 'Read data you copy and paste',
  clipboardWrite: 'Modify data you copy and paste',
  geolocation: 'Detect your physical location',
  nativeMessaging: 'Communicate with cooperating native applications',
  management: 'Manage your apps, extensions and themes',
  privacy: 'Change your privacy-related settings',
  declarativeNetRequest: 'Block content on any page',
};

let Library = null;
const known = new Set();
const instances = new Map();
const described = new Map();
const images = new Map();
const icons = new Map();
const lastIcon = new Map();
const loadingIcons = new Set();
const installing = new Set();
let quiet = false;
let refreshQueued = false;
let updateTimer = null;

function api(ses) {
  return ses.extensions || ses;
}

function storeRoot() {
  return path.join(app.getPath('userData'), 'Extensions');
}

function dirs() {
  return ctx.config.get('extensions');
}

function samePath(a, b) {
  return path.resolve(a) === path.resolve(b);
}

function storeIdOf(dir) {
  const rel = path.relative(storeRoot(), path.resolve(dir));
  const id = rel.split(path.sep)[0];
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) && crx.ID.test(id) ? id : null;
}

function message(dir, manifest, value) {
  const match = /^__MSG_(\w+)__$/.exec(String(value || ''));
  if (!match) return value || '';
  const key = match[1].toLowerCase();
  for (const tag of [i18n.locale().replace('-', '_'), i18n.lang(), manifest.default_locale, 'en']) {
    if (!tag || !/^[\w-]+$/.test(tag)) continue;
    try {
      const messages = JSON.parse(fs.readFileSync(path.join(dir, '_locales', tag, 'messages.json'), 'utf8').replace(/^﻿/, ''));
      const found = Object.entries(messages).find(([k]) => k.toLowerCase() === key);
      if (found && found[1] && found[1].message) return found[1].message;
    } catch {
      continue;
    }
  }
  return match[1];
}

function describe(dir) {
  if (described.has(dir)) return described.get(dir);
  let info = null;
  try {
    const manifest = crx.readManifest(dir);
    info = {
      manifest,
      name: message(dir, manifest, manifest.name) || path.basename(dir),
      description: message(dir, manifest, manifest.description),
      version: String(manifest.version || ''),
    };
  } catch {
    info = null;
  }
  described.set(dir, info);
  return info;
}

function nameOf(ext) {
  return describe(ext.path)?.name || ext.name;
}

function imageFor(dir, manifest, size) {
  const key = `${dir}|${size}`;
  if (images.has(key)) return images.get(key);
  let data = '';
  const set = manifest && manifest.icons;
  if (set && typeof set === 'object') {
    const sizes = Object.keys(set)
      .map(Number)
      .filter((n) => n > 0)
      .sort((a, b) => a - b);
    const pick = sizes.find((n) => n >= size) || sizes[sizes.length - 1];
    const file = pick && path.resolve(dir, String(set[pick]).replace(/^\/+/, ''));
    if (file && file.startsWith(path.resolve(dir) + path.sep)) {
      const image = nativeImage.createFromPath(file);
      if (!image.isEmpty()) data = image.resize({ width: size, height: size, quality: 'best' }).toDataURL();
    }
  }
  images.set(key, data);
  return data;
}

function find(wc) {
  for (const w of ctx.windows) for (const t of w.allTabs()) if (t.wc === wc) return { w, t };
  return null;
}

function sessionFor(w, workspaceId) {
  return session.fromPartition(ctx.partitionFor(workspaceId, w.isPrivate, w.privateId));
}

function workspaceFor(w, ses) {
  const ids = [w.activeWorkspaceId, ...ctx.workspaces().map((x) => x.id)];
  return ids.find((id) => sessionFor(w, id) === ses) || w.activeWorkspaceId;
}

function refresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  setImmediate(() => {
    refreshQueued = false;
    for (const w of ctx.windows) w.scheduleState();
  });
}

function changed() {
  refresh();
  require('./internal-api').broadcast('extensions-changed');
}

function createTab(ses, details = {}) {
  const { BrowserWin } = require('./window');
  const { NEWTAB } = require('./tab');
  const normal = [...ctx.windows].filter((w) => !w.isPrivate && !w.win.isDestroyed());
  const focused = ctx.lastFocusedWindow();
  const w = normal.find((x) => x.win.id === details.windowId) || (focused && !focused.isPrivate ? focused : normal[0]) || new BrowserWin();
  const background = details.active === false;
  const tab = w.newTab({ url: details.url || NEWTAB, workspaceId: workspaceFor(w, ses), background });
  if (!background && w.activeTab() !== tab) w.activate(tab.id);
  tab.ensureView();
  return [tab.wc, w.win];
}

function selectTab(wc) {
  if (quiet) return;
  const found = find(wc);
  if (found && found.w.activeTab() !== found.t) found.w.activate(found.t.id);
}

function removeTab(wc) {
  const found = find(wc);
  if (found) found.w.closeTab(found.t.id);
}

function createWindow(details = {}) {
  const { BrowserWin } = require('./window');
  const urls = [].concat(details.url || []).filter((u) => typeof u === 'string' && u);
  return new BrowserWin({ urls }).win;
}

function removeWindow(win) {
  if (!win.isDestroyed()) win.close();
}

function assignTabDetails(details, wc) {
  const found = find(wc);
  if (!found) return;
  const { w, t } = found;
  details.index = w.space(t.workspaceId).tabs.indexOf(t);
  details.pinned = t.pinned;
  details.active = w.activeTab() === t;
}

function popupCreated(popup) {
  const win = popup.browserWindow;
  if (!win || win.isDestroyed()) return;
  const owner = [...ctx.windows].find((w) => w.win === popup.parent);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (owner && /^(https?|chrome-extension):/.test(url)) owner.newTab({ url });
    return { action: 'deny' };
  });
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      event.preventDefault();
      popup.destroy();
    }
  });
  win.webContents.once('did-finish-load', () => setTimeout(() => showPopup(popup), 300));
}

async function showPopup(popup) {
  if (popup.isDestroyed() || !popup.hidden) return;
  popup.setSize({ width: 800, height: 600 });
  await new Promise((resolve) => setTimeout(resolve, 60));
  const size = await popup.browserWindow?.webContents
    .executeJavaScript(
      `(() => {
        const d = document.documentElement;
        const b = document.body;
        const prev = d.style.width;
        d.style.width = 'max-content';
        const style = getComputedStyle(b);
        const bottom = Math.max(0, ...[...b.children].map((c) => c.getBoundingClientRect().bottom)) + parseFloat(style.paddingBottom) + parseFloat(style.marginBottom);
        const out = { width: Math.ceil(d.getBoundingClientRect().width), height: Math.ceil(bottom || d.getBoundingClientRect().height) };
        d.style.width = prev;
        return out;
      })()`,
    )
    .catch(() => null);
  if (!size || popup.isDestroyed() || !popup.hidden) return;
  popup.setSize(size);
  popup.updatePosition();
  popup.show();
}

function attach(ses) {
  if (instances.has(ses)) return instances.get(ses);
  Library ||= require('electron-chrome-extensions').ElectronChromeExtensions;
  const ext = new Library({
    session: ses,
    createTab: (details) => createTab(ses, details),
    selectTab,
    removeTab,
    createWindow,
    removeWindow,
    assignTabDetails,
  });
  ext.api.browserAction.observers.add({ isDestroyed: () => false, send: refresh });
  ext.on('browser-action-popup-created', popupCreated);
  api(ses).on('extension-loaded', refresh);
  api(ses).on('extension-unloaded', refresh);
  instances.set(ses, ext);
  return ext;
}

function ensureAttached() {
  for (const ses of known) attach(ses);
  for (const w of ctx.windows) for (const t of w.allTabs()) track(t);
}

async function loadInto(ses) {
  known.add(ses);
  if (!dirs().length) return;
  attach(ses);
  for (const dir of dirs()) {
    if (api(ses).getAllExtensions().some((e) => samePath(e.path, dir))) continue;
    try {
      await api(ses).loadExtension(dir, { allowFileAccess: false });
    } catch (err) {
      console.warn('[extensions] failed to load', dir, err.message);
    }
  }
}

function track(tab) {
  const w = tab.owner;
  const wc = tab.wc;
  const ext = wc && !w.isPrivate && instances.get(wc.session);
  if (!ext || w.win.isDestroyed()) return;
  quiet = true;
  try {
    ext.addTab(wc, w.win);
    if (w.activeTab() === tab) ext.selectTab(wc);
  } finally {
    quiet = false;
  }
}

function selected(tab) {
  if (tab?.wc) track(tab);
}

function color(value) {
  if (Array.isArray(value) && value.length >= 3) {
    const [r, g, b, a = 255] = value.map((n) => Math.max(0, Math.min(255, Number(n) || 0)));
    return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(2)})`;
  }
  if (typeof value === 'string' && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{3,20})$/i.test(value)) return value;
  return '';
}

function iconFor(ext, e, tabId, stamp) {
  const key = `${e.id}|${tabId || 0}|${stamp || 0}`;
  if (icons.has(key)) return icons.get(key) || lastIcon.get(e.id) || '';
  if (!loadingIcons.has(key)) {
    loadingIcons.add(key);
    Promise.resolve()
      .then(() => ext.api.browserAction.handleCRXRequest({ url: `crx://extension-icon/${e.id}/32/2${tabId ? `?tabId=${tabId}` : ''}` }))
      .then((res) => (res && res.ok ? res.arrayBuffer() : null))
      .then((buf) => {
        const image = buf && nativeImage.createFromBuffer(Buffer.from(buf));
        const data = image && !image.isEmpty() ? image.resize({ width: 32, height: 32, quality: 'best' }).toDataURL() : imageFor(e.path, e.manifest, 32);
        if (icons.size > 400) icons.clear();
        icons.set(key, data);
        if (data) lastIcon.set(e.id, data);
        refresh();
      })
      .catch(() => icons.set(key, ''))
      .finally(() => loadingIcons.delete(key));
  }
  return lastIcon.get(e.id) || '';
}

function toolbar(w) {
  if (w.isPrivate) return [];
  const ses = sessionFor(w, w.activeWorkspaceId);
  const ext = instances.get(ses);
  if (!ext) return [];
  const tabId = w.activeTab()?.wc?.id;
  const actions = new Map(ext.api.browserAction.getState().actions.map((a) => [a.id, a]));
  const unpinned = ctx.config.get('unpinnedExtensions');
  return api(ses)
    .getAllExtensions()
    .map((e) => {
      const action = actions.get(e.id);
      const perTab = (action && tabId && action.tabs[tabId]) || {};
      const pick = (k) => (perTab[k] !== undefined ? perTab[k] : action?.[k]);
      const name = nameOf(e);
      return {
        id: e.id,
        name,
        title: String(pick('title') || name).slice(0, 200),
        badge: String(pick('text') ?? '').slice(0, 4),
        badgeColor: color(pick('color')),
        icon: iconFor(ext, e, tabId, pick('iconModified')),
        pinned: !unpinned.includes(e.id),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function activate(w, id, rect = {}) {
  const tab = w.activeTab();
  const wc = tab?.wc;
  const ext = wc && !w.isPrivate && instances.get(wc.session);
  if (!ext || !api(wc.session).getExtension(id)) return false;
  track(tab);
  const num = (n) => Math.round(Number(n) || 0);
  try {
    ext.api.browserAction.activateClick({
      eventType: 'click',
      extensionId: id,
      tabId: wc.id,
      anchorRect: { x: num(rect.x), y: num(rect.y), width: num(rect.width), height: num(rect.height) },
    });
    return true;
  } catch (err) {
    console.warn('[extensions]', err.message);
    return false;
  }
}

function contextMenuItems(tab, params) {
  const wc = tab?.wc;
  const ext = wc && !tab.owner.isPrivate && instances.get(wc.session);
  if (!ext) return [];
  try {
    return ext.getContextMenuItems(wc, params);
  } catch {
    return [];
  }
}

function idOf(dir) {
  const storeId = storeIdOf(dir);
  if (storeId) return storeId;
  for (const ses of instances.keys()) {
    const e = api(ses)
      .getAllExtensions()
      .find((x) => samePath(x.path, dir));
    if (e) return e.id;
  }
  return null;
}

function isLoaded(id) {
  return Boolean(id) && [...instances.keys()].some((ses) => api(ses).getExtension(id));
}

function optionsPage(manifest) {
  return manifest?.options_ui?.page || manifest?.options_page || '';
}

function list() {
  const unpinned = ctx.config.get('unpinnedExtensions');
  return dirs().map((dir) => {
    const info = describe(dir);
    const id = idOf(dir);
    const store = Boolean(storeIdOf(dir));
    return {
      key: id || dir,
      id,
      name: info?.name || path.basename(dir),
      description: info?.description || '',
      version: info?.version || '',
      icon: info ? imageFor(dir, info.manifest, 48) : '',
      source: store ? 'store' : 'unpacked',
      dir: store ? null : dir,
      pinned: Boolean(id) && !unpinned.includes(id),
      options: Boolean(optionsPage(info?.manifest) && isLoaded(id)),
      missing: !info,
    };
  });
}

function dirFor(key) {
  return dirs().find((d) => d === key || idOf(d) === key) || null;
}

async function loadEverywhere(dir, id) {
  ensureAttached();
  let first = null;
  for (const ses of instances.keys()) {
    if (id && api(ses).getExtension(id)) api(ses).removeExtension(id);
    try {
      await api(ses).loadExtension(dir, { allowFileAccess: false });
    } catch (err) {
      first ||= err;
    }
  }
  if (first && !isLoaded(id || idOf(dir))) throw first;
}

async function addUnpacked(dir) {
  if (!describe(dir)) {
    described.delete(dir);
    throw new Error(tr('This folder does not contain an extension'));
  }
  if (!dirs().includes(dir)) ctx.config.update((d) => d.extensions.push(dir));
  await loadEverywhere(dir).catch((err) => console.warn('[extensions] failed to load', dir, err.message));
  changed();
}

function remove(key) {
  const dir = dirFor(key);
  if (!dir) return;
  const id = idOf(dir);
  for (const ses of instances.keys()) if (id && api(ses).getExtension(id)) api(ses).removeExtension(id);
  ctx.config.update((d) => {
    d.extensions = d.extensions.filter((x) => x !== dir);
    d.unpinnedExtensions = d.unpinnedExtensions.filter((x) => x !== id);
  });
  const storeId = storeIdOf(dir);
  if (storeId) setTimeout(() => fs.rm(path.join(storeRoot(), storeId), { recursive: true, force: true }, () => {}), 1500);
  if (id) notifyStore('onUninstalled', id);
  changed();
}

function setPinned(id, pinned) {
  ctx.config.update((d) => {
    d.unpinnedExtensions = d.unpinnedExtensions.filter((x) => x !== id);
    if (!pinned) d.unpinnedExtensions.push(id);
  });
  changed();
}

function openOptions(w, id) {
  const dir = dirFor(id);
  const page = dir && optionsPage(describe(dir)?.manifest);
  if (page && w) w.newTab({ url: `chrome-extension://${id}/${String(page).replace(/^\/+/, '')}` });
}

function crxUrl(id) {
  const url = new URL(UPDATE_URL);
  url.searchParams.set('response', 'redirect');
  url.searchParams.set('acceptformat', 'crx3');
  url.searchParams.set('prodversion', process.versions.chrome);
  url.searchParams.set('x', new URLSearchParams({ id, installsource: 'ondemand', uc: '' }).toString());
  return url.toString();
}

async function download(url, hash) {
  const res = await net.fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(tr('The download failed ({status})', { status: res.status }));
  if (Number(res.headers.get('content-length')) > MAX_DOWNLOAD) throw new Error(tr('The extension is too large'));
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_DOWNLOAD) throw new Error(tr('The extension is too large'));
  if (hash && crypto.createHash('sha256').update(buf).digest('hex') !== hash.toLowerCase()) throw new Error(tr('The download was damaged'));
  return buf;
}

function prune(id, keep) {
  const base = path.join(storeRoot(), id);
  for (const name of fs.existsSync(base) ? fs.readdirSync(base) : []) {
    const dir = path.join(base, name);
    if (!samePath(dir, keep)) fs.rm(dir, { recursive: true, force: true }, () => {});
  }
}

async function fetchPackage(id, url = crxUrl(id), hash = null) {
  if (!crx.ID.test(id)) throw new Error(tr('This is not a valid extension'));
  return crx.install(await download(url, hash), storeRoot(), id);
}

async function activatePackage(id, result) {
  const previous = dirs().find((d) => storeIdOf(d) === id);
  try {
    await loadEverywhere(result.dir, id);
  } catch (err) {
    if (previous) await loadEverywhere(previous, id).catch(() => {});
    fs.rm(result.dir, { recursive: true, force: true }, () => {});
    throw err;
  }
  ctx.config.update((d) => {
    d.extensions = d.extensions.filter((x) => storeIdOf(x) !== id);
    d.extensions.push(result.dir);
  });
  lastIcon.delete(id);
  icons.clear();
  prune(id, result.dir);
  changed();
  const ext = loadedExtensions().find((e) => e.id === id);
  if (ext && !previous) setImmediate(() => notifyStore('onInstalled', managementInfo(ext)));
}

async function guarded(id, work) {
  if (installing.has(id)) throw new Error(tr('This extension is already being added'));
  installing.add(id);
  refresh();
  try {
    return await work();
  } finally {
    installing.delete(id);
    refresh();
  }
}

function installFromStore(id, url, hash) {
  return guarded(id, async () => {
    const result = await fetchPackage(id, url, hash);
    await activatePackage(id, result);
    return result;
  });
}

function storeItemOf(url) {
  const match = /^https:\/\/chromewebstore\.google\.com\/detail\/(?:[^/?#]+\/)?([a-p]{32})(?:[/?#]|$)/.exec(url || '');
  return match ? match[1] : null;
}

function storeOffer(w) {
  const id = storeItemOf(w.activeTab()?.displayUrl);
  if (!id || isLoaded(id)) return null;
  return { id, busy: installing.has(id) };
}

async function installFromPage(w) {
  const id = storeItemOf(w.activeTab()?.displayUrl);
  if (!id || isLoaded(id) || installing.has(id)) return;
  let name = id;
  try {
    await guarded(id, async () => {
      const result = await fetchPackage(id);
      const info = describe(result.dir);
      name = info?.name || id;
      const image = imageFor(result.dir, result.manifest, 64);
      const can = abilities(result.manifest);
      const { response } = await confirmBox(w, {
        type: image ? 'none' : 'question',
        icon: image ? nativeImage.createFromDataURL(image) : undefined,
        title: tr('Add extension'),
        message: tr('Add “{name}”?', { name }),
        detail: can.length ? `${tr('It can:')}\n${can.map((a) => `• ${a}`).join('\n')}` : tr('It needs no special permissions.'),
        buttons: [tr('Add extension'), tr('Cancel')],
      });
      if (response !== 0) {
        fs.rm(result.dir, { recursive: true, force: true }, () => {});
        return;
      }
      await activatePackage(id, result);
    });
  } catch (err) {
    confirmBox(w, { type: 'warning', message: tr('“{name}” could not be added', { name }), detail: tr(err.message), buttons: [tr('OK')] });
  }
}

function abilities(manifest) {
  const permissions = [...(manifest.permissions || []), ...(manifest.optional_permissions || [])].filter((p) => typeof p === 'string');
  const hosts = new Set([...(manifest.host_permissions || []), ...permissions.filter((p) => p.includes('://') || p === '<all_urls>')]);
  for (const script of manifest.content_scripts || []) for (const m of script.matches || []) hosts.add(m);
  const out = [];
  if ([...hosts].some((h) => ALL_SITES.has(h))) out.push(tr('Read and change all your data on all websites'));
  else if (hosts.size) {
    const names = [...new Set([...hosts].map((h) => h.replace(/^[^:]+:\/\//, '').replace(/\/.*$/, '').replace(/^\*\./, '')))];
    out.push(tr('Read and change your data on {sites}', { sites: names.slice(0, 3).join(', ') + (names.length > 3 ? ' …' : '') }));
  }
  for (const p of manifest.permissions || []) if (ABILITIES[p]) out.push(tr(ABILITIES[p]));
  return [...new Set(out)];
}

async function storeIcon(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !/(^|\.)(googleusercontent\.com|gstatic\.com|google\.com)$/.test(u.hostname)) return undefined;
    const res = await net.fetch(u.href, { signal: AbortSignal.timeout(5000) });
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok || buf.length > 2 * 1024 * 1024) return undefined;
    const image = nativeImage.createFromBuffer(buf);
    return image.isEmpty() ? undefined : image.resize({ width: 64, height: 64, quality: 'best' });
  } catch {
    return undefined;
  }
}

function managementInfo(e) {
  const m = e.manifest || {};
  const name = nameOf(e);
  return {
    description: describe(e.path)?.description || '',
    enabled: true,
    homepageUrl: m.homepage_url || '',
    hostPermissions: m.host_permissions || [],
    icons: Object.keys(m.icons || {}).map((size) => ({ size: Number(size), url: `chrome://extension-icon/${e.id}/${size}/0` })),
    id: e.id,
    installType: 'normal',
    isApp: false,
    mayDisable: true,
    name,
    offlineEnabled: Boolean(m.offline_enabled),
    optionsUrl: optionsPage(m) ? `chrome-extension://${e.id}/${optionsPage(m)}` : '',
    permissions: m.permissions || [],
    shortName: m.short_name ? message(e.path, m, m.short_name) : name,
    type: 'extension',
    updateUrl: m.update_url || '',
    version: e.version || m.version || '',
  };
}

function loadedExtensions() {
  const seen = new Map();
  for (const ses of instances.keys()) for (const e of api(ses).getAllExtensions()) if (!seen.has(e.id)) seen.set(e.id, e);
  return [...seen.values()];
}

function notifyStore(name, data) {
  for (const wc of webContents.getAllWebContents()) {
    if (!wc.isDestroyed() && wc.getURL().startsWith(`${STORE_ORIGIN}/`)) wc.send('lions:webstore-event', name, data);
  }
}

function confirmBox(w, options) {
  return dialog.showMessageBox(w && !w.win.isDestroyed() ? w.win : undefined, { noLink: true, defaultId: 0, cancelId: 1, ...options });
}

async function beginInstall(event, details = {}) {
  const id = String(details.id || '');
  if (!crx.ID.test(id)) return { result: 'invalid_id' };
  if (installing.has(id)) return { result: 'install_in_progress' };
  if (isLoaded(id)) return { result: 'already_installed' };
  let manifest;
  try {
    manifest = JSON.parse(details.manifest);
  } catch {
    return { result: 'manifest_error' };
  }
  const w = find(event.sender)?.w;
  const name = String(details.localizedName || manifest.name || id).slice(0, 80);
  const icon = await storeIcon(details.iconUrl);
  const can = abilities(manifest);
  const { response } = await confirmBox(w, {
    type: icon ? 'none' : 'question',
    icon,
    title: tr('Add extension'),
    message: tr('Add “{name}”?', { name }),
    detail: can.length ? `${tr('It can:')}\n${can.map((a) => `• ${a}`).join('\n')}` : tr('It needs no special permissions.'),
    buttons: [tr('Add extension'), tr('Cancel')],
  });
  if (response !== 0) return { result: 'user_cancelled', message: 'User cancelled install' };
  try {
    await guarded(id, async () => {
      const result = await fetchPackage(id);
      if (abilities(result.manifest).some((a) => !can.includes(a))) {
        fs.rm(result.dir, { recursive: true, force: true }, () => {});
        throw new Error(tr('The extension asks for more permissions than shown'));
      }
      await activatePackage(id, result);
    });
  } catch (err) {
    confirmBox(w, { type: 'warning', message: tr('“{name}” could not be added', { name }), detail: tr(err.message), buttons: [tr('OK')] });
    return { result: 'install_error', message: err.message };
  }
  return { result: 'success' };
}

async function uninstallFromStore(event, id) {
  const dir = dirFor(String(id));
  if (!dir) return;
  const w = find(event.sender)?.w;
  const name = describe(dir)?.name || id;
  const { response } = await confirmBox(w, { type: 'question', message: tr('Remove “{name}”?', { name }), buttons: [tr('Remove'), tr('Cancel')] });
  if (response === 0) remove(id);
}

const WEBSTORE = {
  beginInstallWithManifest3: beginInstall,
  completeInstall: () => 'success',
  enableAppLauncher: () => true,
  getBrowserLogin: () => '',
  getExtensionStatus: (_e, id) => (isLoaded(String(id)) ? 'enabled' : 'installable'),
  getFullChromeVersion: () => ({ version_number: process.versions.chrome }),
  getIsLauncherEnabled: () => true,
  getMV2DeprecationStatus: () => 'inactive',
  getReferrerChain: () => 'EgIIAA==',
  getStoreLogin: () => '',
  getWebGLStatus: () => 'webgl_allowed',
  install: () => 'success',
  isInIncognitoMode: () => false,
  isPendingCustodianApproval: () => false,
  setStoreLogin: () => true,
  'management.getAll': () => loadedExtensions().map(managementInfo),
  'management.get': (_e, id) => {
    const ext = loadedExtensions().find((e) => e.id === id);
    return ext ? managementInfo(ext) : null;
  },
  'management.setEnabled': () => undefined,
  'management.uninstall': uninstallFromStore,
};

function fromStore(event) {
  const frame = event.senderFrame;
  if (!frame || frame.parent) return false;
  try {
    return new URL(frame.url).origin === STORE_ORIGIN && Boolean(find(event.sender));
  } catch {
    return false;
  }
}

function trustedDownload(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /(^|\.)(googleusercontent\.com|google\.com|gvt1\.com)$/.test(u.hostname);
  } catch {
    return false;
  }
}

function xmlAttr(text, name) {
  const match = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(text);
  return match ? match[1].replace(/&amp;/g, '&') : '';
}

async function checkUpdates() {
  const items = dirs()
    .map((dir) => ({ id: storeIdOf(dir), version: describe(dir)?.version, manifest: describe(dir)?.manifest }))
    .filter((x) => x.id && x.version);
  if (!items.length) return [];
  const url = new URL(UPDATE_URL);
  url.searchParams.set('response', 'updatecheck');
  url.searchParams.set('acceptformat', 'crx3');
  url.searchParams.set('prodversion', process.versions.chrome);
  for (const item of items) url.searchParams.append('x', new URLSearchParams({ id: item.id, v: item.version, uc: '' }).toString());
  const res = await net.fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) throw new Error(`update check failed (${res.status})`);
  const xml = await res.text();
  const updated = [];
  for (const [, appId, body] of xml.matchAll(/<app\s[^>]*?appid="([a-p]{32})"[^>]*>([\s\S]*?)<\/app>/g)) {
    const check = /<updatecheck\s([^>]*?)\/?>/.exec(body)?.[1] || '';
    const item = items.find((x) => x.id === appId);
    const version = xmlAttr(check, 'version');
    const codebase = xmlAttr(check, 'codebase');
    if (!item || xmlAttr(check, 'status') !== 'ok' || !crx.newer(version, item.version) || !trustedDownload(codebase)) continue;
    try {
      await guarded(appId, async () => {
        const result = await fetchPackage(appId, codebase, xmlAttr(check, 'hash_sha256') || null);
        const before = abilities(item.manifest);
        if (abilities(result.manifest).some((a) => !before.includes(a))) {
          fs.rm(result.dir, { recursive: true, force: true }, () => {});
          throw new Error('the update asks for new permissions');
        }
        await activatePackage(appId, result);
      });
      updated.push(appId);
    } catch (err) {
      console.warn('[extensions] update skipped', appId, err.message);
    }
  }
  return updated;
}

function scheduleUpdates(delay) {
  clearTimeout(updateTimer);
  updateTimer = setTimeout(async () => {
    if (dirs().some(storeIdOf)) await checkUpdates().catch((err) => console.warn('[extensions]', err.message));
    scheduleUpdates(UPDATE_EVERY);
  }, delay);
  updateTimer.unref?.();
}

function cleanup() {
  const root = storeRoot();
  if (!fs.existsSync(root)) return;
  const keep = new Set(dirs().filter(storeIdOf).map((d) => path.resolve(d)));
  for (const id of fs.readdirSync(root)) {
    const base = path.join(root, id);
    if (installing.has(id)) continue;
    if (![...keep].some((dir) => dir.startsWith(path.resolve(base) + path.sep))) {
      fs.rm(base, { recursive: true, force: true }, () => {});
      continue;
    }
    for (const name of fs.readdirSync(base)) {
      const dir = path.join(base, name);
      if (!keep.has(path.resolve(dir))) fs.rm(dir, { recursive: true, force: true }, () => {});
    }
  }
}

function init() {
  ipcMain.handle('lions:webstore', (event, method, ...args) => {
    const fn = Object.hasOwn(WEBSTORE, method) ? WEBSTORE[method] : null;
    if (!fn || !fromStore(event)) throw new Error('Not allowed');
    return fn(event, ...args);
  });
  scheduleUpdates(FIRST_UPDATE_CHECK);
  setTimeout(() => {
    try {
      cleanup();
    } catch (err) {
      console.warn('[extensions] cleanup failed', err.message);
    }
  }, 15000).unref?.();
}

module.exports = {
  init,
  loadInto,
  track,
  selected,
  toolbar,
  activate,
  contextMenuItems,
  list,
  addUnpacked,
  remove,
  setPinned,
  openOptions,
  installFromStore,
  installFromPage,
  storeOffer,
  checkUpdates,
  STORE_ORIGIN,
};
