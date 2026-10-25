'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classify, displayUrl, calculate } = require('../../src/main/omnibox');
const { parseBang } = require('../../src/main/search-engines');

test('domains become https URLs', () => {
  assert.deepEqual(classify('example.com'), { type: 'url', url: 'https://example.com' });
  assert.deepEqual(classify('github.com/aivie373736/LionsBrows'), { type: 'url', url: 'https://github.com/aivie373736/LionsBrows' });
  assert.deepEqual(classify('www.spiegel.de?x=1'), { type: 'url', url: 'https://www.spiegel.de?x=1' });
  assert.equal(classify('sub.domain.co.uk').url, 'https://sub.domain.co.uk');
  assert.equal(classify('aivie373736.github.io').url, 'https://aivie373736.github.io');
});

test('local hosts become http URLs', () => {
  assert.equal(classify('localhost:3000').url, 'http://localhost:3000');
  assert.equal(classify('192.168.0.1').url, 'http://192.168.0.1');
  assert.equal(classify('printer.local/status').url, 'http://printer.local/status');
});

test('explicit schemes are kept', () => {
  assert.equal(classify('http://neverssl.com').url, 'http://neverssl.com');
  assert.equal(classify('lions://settings').url, 'lions://settings');
  assert.equal(classify('file:///tmp/a.html').url, 'file:///tmp/a.html');
});

test('everything else is a search', () => {
  for (const q of ['what is node.js', 'node.js', 'hello', 'about: cats', '999.999.1.1', 'how to tie a tie']) {
    const r = classify(q);
    assert.equal(r.type, 'search', q);
    assert.ok(r.url.startsWith('https://duckduckgo.com/?q='), q);
  }
  assert.equal(classify('cats', 'google').url, 'https://www.google.com/search?q=cats');
  assert.equal(classify('   '), null);
});

test('bangs at either end', () => {
  assert.equal(classify('!yt lofi beats').url, 'https://www.youtube.com/results?search_query=lofi%20beats');
  assert.equal(classify('lofi beats !yt').url, 'https://www.youtube.com/results?search_query=lofi%20beats');
  assert.equal(parseBang('!nope hello'), null);
});

test('displayUrl strips noise', () => {
  assert.equal(displayUrl('https://www.example.com/'), 'example.com');
  assert.equal(displayUrl('https://example.com/a/b?c=1#d'), 'example.com/a/b?c=1#d');
  assert.equal(displayUrl('lions://newtab/'), '');
  assert.equal(displayUrl('lions://settings/'), 'lions://settings/');
});

test('calculator', () => {
  assert.equal(calculate('2+2'), 4);
  assert.equal(calculate('2 + 3 * 4'), 14);
  assert.equal(calculate('(2+3)*4'), 20);
  assert.equal(calculate('2^3^2'), 512);
  assert.equal(calculate('-5 + 2'), -3);
  assert.equal(calculate('10 / 4'), 2.5);
  assert.equal(calculate('1,5 * 2'), 3);
  assert.equal(calculate('= 7 % 3'), 1);
  assert.equal(calculate('0.1 + 0.2'), 0.3);
  assert.equal(calculate('2 * pi'), 6.2831853072);
  assert.equal(calculate('hello'), null);
  assert.equal(calculate('42'), null);
  assert.equal(calculate('1/0'), null);
  assert.equal(calculate('2 +'), null);
  assert.equal(calculate('alert(1)'), null);
});
