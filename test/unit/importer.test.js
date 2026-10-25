'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const importer = require('../../src/main/importer');
const { History } = require('../../src/main/history');

const now = Date.now();

function fakeHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-import-'));
  const chrome = path.join(dir, '.config', 'google-chrome');
  fs.mkdirSync(path.join(chrome, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(chrome, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Person 1' } } } }));
  fs.writeFileSync(
    path.join(chrome, 'Default', 'Bookmarks'),
    JSON.stringify({
      roots: {
        bookmark_bar: { type: 'folder', children: [{ type: 'url', name: 'Lions', url: 'https://lions.example/', date_added: String(importer.msToWebkit(now)) }, { type: 'folder', name: 'Work', children: [{ type: 'url', name: 'Docs', url: 'https://docs.example/' }] }] },
        other: { type: 'folder', children: [{ type: 'url', name: 'Local', url: 'file:///tmp/x' }] },
      },
    }),
  );
  const ch = new DatabaseSync(path.join(chrome, 'Default', 'History'));
  ch.exec('CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, typed_count INTEGER, last_visit_time INTEGER, hidden INTEGER DEFAULT 0); CREATE TABLE visits (id INTEGER PRIMARY KEY, url INTEGER, visit_time INTEGER, transition INTEGER);');
  ch.prepare('INSERT INTO urls VALUES (1, ?, ?, 2, 1, 0, 0)').run('https://lions.example/', 'Lions');
  ch.prepare('INSERT INTO urls VALUES (2, ?, ?, 1, 0, 0, 0)').run('https://ads.example/frame', 'Frame');
  ch.prepare('INSERT INTO visits VALUES (1, 1, ?, 1)').run(importer.msToWebkit(now - 60_000));
  ch.prepare('INSERT INTO visits VALUES (2, 1, ?, 805306368)').run(importer.msToWebkit(now - 30_000));
  ch.prepare('INSERT INTO visits VALUES (3, 2, ?, 3)').run(importer.msToWebkit(now - 20_000));
  ch.close();

  const ff = path.join(dir, '.mozilla', 'firefox');
  fs.mkdirSync(path.join(ff, 'abc.default-release'), { recursive: true });
  fs.writeFileSync(path.join(ff, 'profiles.ini'), '[Profile0]\nName=default-release\nIsRelative=1\nPath=abc.default-release\n\n[Install4F96D1932A9F858E]\nDefault=abc.default-release\n');
  const fx = new DatabaseSync(path.join(ff, 'abc.default-release', 'places.sqlite'));
  fx.exec(`CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT, typed INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0);
    CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER, parent INTEGER, position INTEGER, title TEXT, guid TEXT, dateAdded INTEGER);
    CREATE TABLE moz_historyvisits (id INTEGER PRIMARY KEY, place_id INTEGER, visit_date INTEGER, visit_type INTEGER);
    INSERT INTO moz_places VALUES (1, 'https://firefox.example/', 'Firefox page', 1, 0), (2, 'place:sort=8', 'Recent', 0, 0);
    INSERT INTO moz_bookmarks VALUES (1, 2, NULL, 0, 0, '', 'root________', 0), (2, 2, NULL, 1, 0, 'toolbar', 'toolbar_____', 0), (3, 2, NULL, 1, 1, 'menu', 'menu________', 0),
      (4, 2, NULL, 3, 0, 'Reading', 'folderguid01', 0), (5, 1, 1, 4, 0, 'Firefox page', 'bmguid000001', ${now * 1000}), (6, 1, 2, 2, 0, 'Recent', 'bmguid000002', 0);`);
  fx.prepare('INSERT INTO moz_historyvisits VALUES (1, 1, ?, 1), (2, 1, ?, 9)').run((now - 10_000) * 1000, (now - 5_000) * 1000);
  fx.close();
  return dir;
}

test('finds Chrome and Firefox profiles and imports bookmarks and history', async () => {
  const oldHome = process.env.HOME;
  process.env.HOME = fakeHome();
  try {
    const found = importer.sources();
    const chrome = found.find((s) => s.browser === 'Google Chrome');
    const firefox = found.find((s) => s.browser === 'Firefox');
    assert.ok(chrome && firefox, JSON.stringify(found));

    const history = new History(path.join(process.env.HOME, 'lb-history.sqlite'));
    const marks = [];
    const sinks = { addBookmarks: (list) => (marks.push(...list), list.length), addHistory: (rows) => history.importVisits(rows) };

    const fromChrome = await importer.run(chrome.id, {}, sinks);
    assert.equal(fromChrome.bookmarks, 2);
    assert.equal(fromChrome.history, 2);
    assert.deepEqual(marks.map((b) => [b.url, b.folder]), [['https://lions.example/', ''], ['https://docs.example/', 'Work']]);
    assert.equal(history.search('lions')[0].visits, 2);

    const again = await importer.run(chrome.id, { bookmarks: false }, sinks);
    assert.equal(again.history, 0, 'importing twice does not duplicate visits');

    const fromFirefox = await importer.run(firefox.id, {}, sinks);
    assert.equal(fromFirefox.bookmarks, 1);
    assert.equal(fromFirefox.history, 1);
    assert.equal(marks.at(-1).folder, 'Bookmarks menu / Reading');
    history.close();
  } finally {
    process.env.HOME = oldHome;
  }
});
