'use strict';

const crypto = require('node:crypto');
const { JsonStore } = require('./store');

function originOf(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.origin : null;
  } catch {
    return null;
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const input = String(text).replace(/^﻿/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some((v) => v !== '')) rows.push(row);
  return rows;
}

function csvField(value) {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const COLUMNS = {
  url: ['url', 'login_uri', 'website', 'origin', 'hostname'],
  username: ['username', 'login_username', 'user', 'email', 'login'],
  password: ['password', 'login_password'],
};

class Vault {
  constructor(file, codec) {
    this.store = new JsonStore(file, { logins: [], never: [] });
    this.codec = codec;
  }

  #logins() {
    return this.store.get('logins');
  }

  #decrypt(data) {
    try {
      const text = this.codec.decrypt(data);
      return typeof text === 'string' ? text : null;
    } catch {
      return null;
    }
  }

  list() {
    return this.#logins()
      .map(({ password, ...rest }) => rest)
      .sort((a, b) => a.origin.localeCompare(b.origin) || a.username.localeCompare(b.username));
  }

  forOrigin(origin) {
    return this.#logins()
      .filter((l) => l.origin === origin)
      .sort((a, b) => (b.used || 0) - (a.used || 0))
      .map(({ password, ...rest }) => rest);
  }

  find(origin, username) {
    return this.#logins().find((l) => l.origin === origin && l.username === username) || null;
  }

  password(id) {
    const login = this.#logins().find((l) => l.id === id);
    return login ? this.#decrypt(login.password) : null;
  }

  credentials(id) {
    const login = this.#logins().find((l) => l.id === id);
    const password = login ? this.#decrypt(login.password) : null;
    return password === null ? null : { origin: login.origin, username: login.username, password };
  }

  check(origin, username, password) {
    const existing = this.find(origin, username);
    if (!existing) return 'new';
    return this.#decrypt(existing.password) === password ? 'same' : 'update';
  }

  save(origin, username, password) {
    const now = Date.now();
    const existing = this.find(origin, username);
    if (existing) {
      this.store.update(() => {
        existing.password = this.codec.encrypt(password);
        existing.updated = now;
      });
      return existing.id;
    }
    const login = { id: crypto.randomUUID(), origin, username, password: this.codec.encrypt(password), created: now, updated: now, used: 0 };
    this.store.update((d) => d.logins.push(login));
    return login.id;
  }

  markUsed(id) {
    const login = this.#logins().find((l) => l.id === id);
    if (login) this.store.update(() => (login.used = Date.now()));
  }

  remove(id) {
    this.store.update((d) => (d.logins = d.logins.filter((l) => l.id !== id)));
  }

  never() {
    return [...this.store.get('never')].sort();
  }

  isNever(origin) {
    return this.store.get('never').includes(origin);
  }

  addNever(origin) {
    if (!this.isNever(origin)) this.store.update((d) => d.never.push(origin));
  }

  removeNever(origin) {
    this.store.update((d) => (d.never = d.never.filter((o) => o !== origin)));
  }

  importCsv(text) {
    const rows = parseCsv(text);
    if (rows.length < 2) return 0;
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const col = (names) => header.findIndex((h) => names.includes(h));
    const [u, n, p] = [col(COLUMNS.url), col(COLUMNS.username), col(COLUMNS.password)];
    if (u === -1 || p === -1) throw new Error('Unknown file format');
    let added = 0;
    for (const row of rows.slice(1)) {
      const origin = originOf(row[u] || '');
      const password = row[p] || '';
      if (!origin || !password) continue;
      const username = n === -1 ? '' : (row[n] || '').trim();
      if (this.check(origin, username, password) === 'same') continue;
      this.save(origin, username, password);
      added++;
    }
    return added;
  }

  exportCsv() {
    const lines = ['name,url,username,password'];
    for (const l of this.#logins()) {
      const password = this.#decrypt(l.password);
      if (password !== null) lines.push([new URL(l.origin).host, l.origin, l.username, password].map(csvField).join(','));
    }
    return `${lines.join('\n')}\n`;
  }

  flush() {
    this.store.flush();
  }
}

module.exports = { Vault, parseCsv, originOf };
