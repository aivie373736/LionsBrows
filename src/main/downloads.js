'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, shell } = require('electron');
const { ctx } = require('./context');
const { JsonStore } = require('./store');

let nextId = 1;
const live = new Map();
let store = null;
let notifyTimer = null;

function init() {
  store = new JsonStore(path.join(app.getPath('userData'), 'downloads.json'), { items: [] });
  for (const r of store.get('items')) if (r.state === 'progressing') r.state = 'interrupted';
  nextId = Math.max(0, ...store.get('items').map((r) => r.id)) + 1;
}

function downloadsDir() {
  const custom = ctx.settings().downloadsPath;
  return custom && fs.existsSync(custom) ? custom : app.getPath('downloads');
}

function uniquePath(dir, filename) {
  const safe = filename.replace(/[\\/:*?"<>|]/g, '_') || 'download';
  const ext = path.extname(safe);
  const base = safe.slice(0, safe.length - ext.length);
  let candidate = path.join(dir, safe);
  for (let i = 1; fs.existsSync(candidate); i++) candidate = path.join(dir, `${base} (${i})${ext}`);
  return candidate;
}

function attach(ses, { isPrivate }) {
  ses.on('will-download', (_event, item) => {
    if (!ctx.settings().askWhereToSave) item.setSavePath(uniquePath(downloadsDir(), item.getFilename()));
    const record = {
      id: nextId++,
      filename: item.getFilename(),
      url: item.getURL(),
      path: item.getSavePath(),
      state: 'progressing',
      paused: false,
      received: 0,
      total: item.getTotalBytes(),
      startTime: Date.now(),
      isPrivate,
    };
    live.set(record.id, { item, record });
    if (!isPrivate) store.update((d) => d.items.unshift(record));

    item.on('updated', (_e, state) => {
      record.path = item.getSavePath();
      record.filename = path.basename(record.path) || record.filename;
      record.received = item.getReceivedBytes();
      record.total = item.getTotalBytes();
      record.paused = item.isPaused();
      record.stalled = state === 'interrupted';
      notify();
    });
    item.once('done', (_e, state) => {
      record.state = state;
      record.received = item.getReceivedBytes();
      record.path = item.getSavePath();
      live.delete(record.id);
      if (!isPrivate) store.save();
      notify();
    });
    ctx.events.emit('download-started', record);
    notify();
  });
}

function notify() {
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    if (store) store.save();
    ctx.events.emit('downloads-changed');
  }, 200);
}

function list() {
  const privateLive = [...live.values()].map((l) => l.record).filter((r) => r.isPrivate);
  return [...privateLive, ...store.get('items')].slice(0, 100);
}

function summary() {
  const active = [...live.values()].map((l) => l.record);
  const total = active.reduce((s, r) => s + (r.total || 0), 0);
  const received = active.reduce((s, r) => s + (r.received || 0), 0);
  return { active: active.length, progress: total ? received / total : active.length ? -1 : 0 };
}

function find(id) {
  return list().find((r) => r.id === id);
}

function action(id, what) {
  if (what === 'clear') {
    store.update((d) => (d.items = d.items.filter((r) => r.state === 'progressing')));
    return notify();
  }
  const entry = live.get(id);
  const record = entry ? entry.record : find(id);
  if (!record) return;
  switch (what) {
    case 'open':
      if (record.state === 'completed') shell.openPath(record.path);
      break;
    case 'show':
      shell.showItemInFolder(record.path);
      break;
    case 'pause':
      entry?.item.pause();
      break;
    case 'resume':
      if (entry?.item.canResume()) entry.item.resume();
      break;
    case 'cancel':
      entry?.item.cancel();
      break;
    case 'remove':
      store.update((d) => (d.items = d.items.filter((r) => r.id !== id)));
      break;
  }
  notify();
}

function flush() {
  store?.flush();
}

module.exports = { init, attach, list, summary, action, flush, uniquePath, downloadsDir };
