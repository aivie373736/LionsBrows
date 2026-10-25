'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonStore, mergeDefaults } = require('../../src/main/store');

test('mergeDefaults fills new keys without losing saved ones', () => {
  const out = mergeDefaults({ a: 1, nested: { x: 1, y: 2 }, list: [1] }, { a: 5, nested: { y: 9 }, list: [], extra: true });
  assert.deepEqual(out, { a: 5, nested: { x: 1, y: 9 }, list: [], extra: true });
});

test('JsonStore round-trips through disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-store-'));
  const file = path.join(dir, 'cfg.json');
  const s = new JsonStore(file, { theme: 'system', list: [] });
  s.set('theme', 'dark');
  s.update((d) => d.list.push('x'));
  s.flush();
  const again = new JsonStore(file, { theme: 'system', list: [], added: 1 });
  assert.equal(again.get('theme'), 'dark');
  assert.deepEqual(again.get('list'), ['x']);
  assert.equal(again.get('added'), 1);
  fs.writeFileSync(file, '{broken');
  assert.equal(new JsonStore(file, { theme: 'system' }).get('theme'), 'system');
});
