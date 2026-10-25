'use strict';

const { DatabaseSync } = require('node:sqlite');

const DAY = 86_400_000;

class History {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS urls (
        id INTEGER PRIMARY KEY,
        url TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL DEFAULT '',
        favicon TEXT NOT NULL DEFAULT '',
        visit_count INTEGER NOT NULL DEFAULT 0,
        typed_count INTEGER NOT NULL DEFAULT 0,
        last_visit INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS visits (
        id INTEGER PRIMARY KEY,
        url_id INTEGER NOT NULL REFERENCES urls(id) ON DELETE CASCADE,
        time INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS visits_time ON visits(time);
      CREATE INDEX IF NOT EXISTS visits_url ON visits(url_id);
    `);
    this.q = {
      upsert: this.db.prepare(`
        INSERT INTO urls (url, title, visit_count, typed_count, last_visit)
        VALUES (:url, :title, 1, :typed, :now)
        ON CONFLICT(url) DO UPDATE SET
          visit_count = visit_count + 1,
          typed_count = typed_count + :typed,
          last_visit = :now,
          title = CASE WHEN :title <> '' THEN :title ELSE title END
        RETURNING id`),
      visit: this.db.prepare('INSERT INTO visits (url_id, time) VALUES (?, ?)'),
      title: this.db.prepare('UPDATE urls SET title = ? WHERE url = ?'),
      favicon: this.db.prepare('UPDATE urls SET favicon = ? WHERE url = ?'),
      deleteUrl: this.db.prepare('DELETE FROM urls WHERE url = ?'),
    };
  }

  add(url, title = '', { typed = false, now = Date.now() } = {}) {
    if (this.closed || !isRecordable(url)) return;
    const row = this.q.upsert.get({ url, title: title || '', typed: typed ? 1 : 0, now });
    this.q.visit.run(row.id, now);
  }

  setTitle(url, title) {
    if (title && !this.closed) this.q.title.run(title, url);
  }

  setFavicon(url, favicon) {
    if (favicon && !this.closed) this.q.favicon.run(favicon, url);
  }

  search(text, limit = 8, now = Date.now()) {
    const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
    if (!words.length || this.closed) return [];
    const where = words.map((_, i) => `(lower(url) LIKE :w${i} ESCAPE '\\' OR lower(title) LIKE :w${i} ESCAPE '\\')`).join(' AND ');
    const params = { now, limit, day: DAY };
    words.forEach((w, i) => (params[`w${i}`] = `%${escapeLike(w)}%`));
    return this.db
      .prepare(
        `SELECT url, title, favicon, visit_count AS visits, last_visit AS lastVisit
         FROM urls WHERE ${where}
         ORDER BY (visit_count + typed_count * 2.0) / (1.0 + (:now - last_visit) / (:day * 7.0)) DESC
         LIMIT :limit`,
      )
      .all(params)
      .map(plain);
  }

  topSites(limit = 8, now = Date.now()) {
    if (this.closed) return [];
    return this.db
      .prepare(
        `SELECT url, title, favicon, visit_count AS visits FROM urls
         WHERE url LIKE 'http%'
         ORDER BY (visit_count + typed_count * 2.0) / (1.0 + (? - last_visit) / (? * 14.0)) DESC
         LIMIT ?`,
      )
      .all(now, DAY, limit * 3)
      .map(plain)
      .filter(uniqueBy((r) => safeHost(r.url)))
      .slice(0, limit);
  }

  visits({ query = '', limit = 100, offset = 0 } = {}) {
    if (this.closed) return [];
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
    const params = { limit, offset };
    let where = '';
    if (words.length) {
      where = 'WHERE ' + words.map((_, i) => `(lower(u.url) LIKE :w${i} ESCAPE '\\' OR lower(u.title) LIKE :w${i} ESCAPE '\\')`).join(' AND ');
      words.forEach((w, i) => (params[`w${i}`] = `%${escapeLike(w)}%`));
    }
    return this.db
      .prepare(
        `SELECT v.id, v.time, u.url, u.title, u.favicon FROM visits v JOIN urls u ON u.id = v.url_id
         ${where} ORDER BY v.time DESC LIMIT :limit OFFSET :offset`,
      )
      .all(params)
      .map(plain);
  }

  deleteUrl(url) {
    if (!this.closed) this.q.deleteUrl.run(url);
  }

  clear(since = 0) {
    if (this.closed) return;
    if (!since) {
      this.db.exec('DELETE FROM visits; DELETE FROM urls;');
      return;
    }
    this.db.prepare('DELETE FROM visits WHERE time >= ?').run(since);
    this.db.exec(`
      DELETE FROM urls WHERE id NOT IN (SELECT DISTINCT url_id FROM visits);
      UPDATE urls SET
        visit_count = (SELECT COUNT(*) FROM visits WHERE url_id = urls.id),
        last_visit = (SELECT MAX(time) FROM visits WHERE url_id = urls.id);
    `);
  }

  count() {
    return this.db.prepare('SELECT COUNT(*) AS n FROM urls').get().n;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}

function isRecordable(url) {
  return /^https?:\/\//i.test(url || '');
}

function escapeLike(s) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function plain(row) {
  return { ...row };
}

function safeHost(url) {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function uniqueBy(key) {
  const seen = new Set();
  return (item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  };
}

module.exports = { History, isRecordable };
