'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { History } = require('../../src/main/history');

const DAY = 86_400_000;

test('records visits and ranks by frecency', () => {
  const h = new History(':memory:');
  const now = Date.now();
  h.add('https://example.com/', 'Example', { now: now - 30 * DAY });
  for (let i = 0; i < 5; i++) h.add('https://example.org/', 'Example Org', { now: now - i * 1000 });
  h.add('lions://settings', 'Settings');
  h.add('https://other.net/', '');
  h.setTitle('https://other.net/', 'Other example');

  const results = h.search('example', 10, now);
  assert.equal(results[0].url, 'https://example.org/');
  assert.equal(results[0].visits, 5);
  assert.ok(results.some((r) => r.title === 'Other example'));
  assert.ok(!results.some((r) => r.url.startsWith('lions:')));
  assert.equal(h.count(), 3);
});

test('multi-word search and LIKE escaping', () => {
  const h = new History(':memory:');
  h.add('https://a.com/100%_real', 'Totally real deal');
  h.add('https://b.com/', 'Real estate');
  assert.equal(h.search('real deal').length, 1);
  assert.equal(h.search('100%').length, 1);
  assert.equal(h.search('_').length, 1);
});

test('topSites returns one tile per host', () => {
  const h = new History(':memory:');
  h.add('https://www.youtube.com/', 'YouTube');
  h.add('https://www.youtube.com/watch?v=1', 'Video');
  h.add('https://github.com/', 'GitHub');
  const top = h.topSites(8);
  assert.equal(top.length, 2);
});

test('visits listing, delete and clear', () => {
  const h = new History(':memory:');
  const now = Date.now();
  h.add('https://old.com/', 'Old', { now: now - 3 * DAY });
  h.add('https://new.com/', 'New', { now });
  assert.equal(h.visits().length, 2);
  assert.equal(h.visits({ query: 'new' })[0].url, 'https://new.com/');
  h.clear(now - DAY);
  assert.deepEqual(h.visits().map((v) => v.url), ['https://old.com/']);
  h.deleteUrl('https://old.com/');
  assert.equal(h.count(), 0);
  h.add('https://x.com/', 'X');
  h.clear(0);
  assert.equal(h.count(), 0);
});
