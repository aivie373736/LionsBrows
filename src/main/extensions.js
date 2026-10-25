'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ctx } = require('./context');

function api(ses) {
  return ses.extensions || ses;
}

async function loadInto(ses) {
  for (const dir of ctx.config.get('extensions')) {
    try {
      await api(ses).loadExtension(dir, { allowFileAccess: false });
    } catch (err) {
      console.warn('[extensions] failed to load', dir, err.message);
    }
  }
}

function readManifest(dir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  return { name: manifest.name || path.basename(dir), version: manifest.version || '', dir };
}

function list() {
  return ctx.config.get('extensions').map((dir) => {
    try {
      return readManifest(dir);
    } catch {
      return { name: path.basename(dir), version: '', dir, missing: true };
    }
  });
}

function add(dir, sessions) {
  readManifest(dir);
  ctx.config.update((d) => {
    if (!d.extensions.includes(dir)) d.extensions.push(dir);
  });
  return Promise.all(sessions.map((s) => api(s).loadExtension(dir).catch(() => null)));
}

function remove(dir, sessions) {
  ctx.config.update((d) => (d.extensions = d.extensions.filter((e) => e !== dir)));
  for (const s of sessions) {
    const ext = api(s)
      .getAllExtensions()
      .find((e) => e.path === dir);
    if (ext) api(s).removeExtension(ext.id);
  }
}

module.exports = { loadInto, list, add, remove };
