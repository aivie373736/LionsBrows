'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { zipSync, strToU8 } = require('fflate');
const crx = require('../../src/main/crx');

function varint(n) {
  const out = [];
  while (n > 127) {
    out.push((n & 127) | 128);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return Buffer.from(out);
}

function field(num, bytes) {
  return Buffer.concat([varint(num * 8 + 2), varint(bytes.length), bytes]);
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}

const developer = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const publisher = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

function build(files, { swapArchive = null } = {}) {
  const key = developer.publicKey.export({ type: 'spki', format: 'der' });
  const signedData = field(1, crypto.createHash('sha256').update(key).digest().subarray(0, 16));
  const archive = Buffer.from(zipSync(files));
  const signed = Buffer.concat([Buffer.from('CRX3 SignedData\x00', 'latin1'), u32(signedData.length), signedData, archive]);
  const proof = (pair, num) => field(num, Buffer.concat([field(1, pair.publicKey.export({ type: 'spki', format: 'der' })), field(2, crypto.sign('sha256', signed, pair.privateKey))]));
  const header = Buffer.concat([proof(developer, 2), proof(publisher, 3), field(10000, signedData)]);
  const body = swapArchive ? Buffer.from(zipSync(swapArchive)) : archive;
  return { id: crx.idFromKey(key), key: key.toString('base64'), buf: Buffer.concat([Buffer.from('Cr24'), u32(3), u32(header.length), header, body]) };
}

const FILES = {
  'manifest.json': strToU8(JSON.stringify({ manifest_version: 3, name: 'Roar', version: '1.2.3' })),
  'icons/': new Uint8Array(0),
  'icons/16.png': new Uint8Array([1, 2, 3]),
  'popup.html': strToU8('<p>roar</p>'),
};

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lb-crx-'));
}

test('installs a signed package with its store ID and key', () => {
  const { id, key, buf } = build(FILES);
  const root = tempRoot();
  const info = crx.install(buf, root, id);
  assert.equal(info.id, id);
  assert.match(id, crx.ID);
  assert.equal(info.version, '1.2.3');
  assert.equal(info.dir, path.join(root, id, '1.2.3'));
  const manifest = crx.readManifest(info.dir);
  assert.equal(manifest.key, key);
  assert.equal(manifest.name, 'Roar');
  assert.deepEqual([...fs.readFileSync(path.join(info.dir, 'icons/16.png'))], [1, 2, 3]);
  assert.deepEqual(fs.readdirSync(path.join(root, id)), ['1.2.3']);
});

test('rejects a package for a different extension', () => {
  const { buf } = build(FILES);
  assert.throws(() => crx.install(buf, tempRoot(), 'a'.repeat(32)), /does not match/);
});

test('rejects a package whose contents were changed after signing', () => {
  const { id, buf } = build(FILES, { swapArchive: { ...FILES, 'evil.js': strToU8('alert(1)') } });
  const root = tempRoot();
  assert.throws(() => crx.install(buf, root, id), /signature/);
  assert.deepEqual(fs.readdirSync(root), []);
});

test('refuses file names that escape the extension folder', () => {
  const { id, buf } = build({ ...FILES, '../escape.txt': strToU8('nope') });
  const root = tempRoot();
  assert.throws(() => crx.install(buf, root, id), /unsafe/);
  assert.ok(!fs.existsSync(path.join(root, id, 'escape.txt')));
  assert.ok(!fs.existsSync(path.join(root, 'escape.txt')));
  assert.deepEqual(fs.readdirSync(path.join(root, id)), []);
});

test('rejects files that are not extension packages', () => {
  assert.throws(() => crx.parse(Buffer.from('PK\x03\x04 not a crx')), /not a Chrome extension/);
  const v2 = Buffer.concat([Buffer.from('Cr24'), u32(2), u32(0), u32(0)]);
  assert.throws(() => crx.parse(v2), /not supported/);
});

test('compares versions', () => {
  assert.equal(crx.newer('1.10.0', '1.9.9'), true);
  assert.equal(crx.newer('2026.1026.1812', '2026.1026.1812'), false);
  assert.equal(crx.newer('1.2', '1.2.1'), false);
});
