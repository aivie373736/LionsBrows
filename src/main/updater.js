'use strict';

const { app, net, shell } = require('electron');
const { ctx } = require('./context');

const REPO = 'aivie373736/LionsBrows';
const RELEASES = `https://github.com/${REPO}/releases/latest`;
const SIX_HOURS = 6 * 60 * 60 * 1000;

const state = { status: 'idle', version: null, progress: 0, manual: false, url: RELEASES, checkedAt: 0 };
let updater = null;
let timer = null;

function canSelfUpdate() {
  if (!app.isPackaged) return false;
  if (process.platform === 'win32') return true;
  return process.platform === 'linux' && Boolean(process.env.APPIMAGE);
}

function set(patch) {
  Object.assign(state, patch);
  ctx.events.emit('update-changed', { ...state });
}

function newer(a, b) {
  const pa = String(a).replace(/^v/, '').split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

function load() {
  if (updater) return updater;
  updater = require('electron-updater').autoUpdater;
  updater.logger = null;
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on('checking-for-update', () => set({ status: 'checking' }));
  updater.on('update-available', (info) => set({ status: 'downloading', version: info.version, progress: 0 }));
  updater.on('update-not-available', () => set({ status: 'current', checkedAt: Date.now() }));
  updater.on('download-progress', (p) => set({ progress: Math.round(p.percent || 0) }));
  updater.on('update-downloaded', (info) => set({ status: 'ready', version: info.version, progress: 100, checkedAt: Date.now() }));
  updater.on('error', () => set({ status: 'error', checkedAt: Date.now() }));
  return updater;
}

async function checkManually() {
  set({ status: 'checking', manual: true });
  try {
    const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(String(res.status));
    const release = await res.json();
    const version = String(release.tag_name || '').replace(/^v/, '');
    if (version && newer(version, app.getVersion())) set({ status: 'available', version, url: release.html_url || RELEASES, checkedAt: Date.now() });
    else set({ status: 'current', checkedAt: Date.now() });
  } catch {
    set({ status: 'error', checkedAt: Date.now() });
  }
}

async function check() {
  if (!app.isPackaged) return void set({ status: 'unsupported' });
  if (state.status === 'checking' || state.status === 'downloading' || state.status === 'ready') return;
  if (!canSelfUpdate()) return checkManually();
  try {
    await load().checkForUpdates();
  } catch {
    set({ status: 'error', checkedAt: Date.now() });
  }
}

function install() {
  if (state.status === 'ready' && updater) {
    ctx.quitting = true;
    setImmediate(() => updater.quitAndInstall(true, true));
  } else if (state.status === 'available') {
    shell.openExternal(state.url);
  }
}

function start() {
  if (!app.isPackaged || process.env.LIONSBROWS_TEST === '1') return void set({ status: 'unsupported' });
  if (!canSelfUpdate()) set({ manual: true });
  const tick = () => ctx.settings().autoUpdate && check();
  setTimeout(tick, 20_000);
  timer = setInterval(tick, SIX_HOURS);
  timer.unref?.();
}

module.exports = { start, check, install, state: () => ({ ...state, current: app.getVersion() }), newer };
