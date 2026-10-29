'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { unzipSync } = require('fflate');

const MAX_FILES = 20000;
const MAX_BYTES = 512 * 1024 * 1024;
const SIGNATURE_CONTEXT = Buffer.from('CRX3 SignedData\x00', 'latin1');
const ID = /^[a-p]{32}$/;

function toId(hex) {
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

function idFromKey(key) {
  return toId(crypto.createHash('sha256').update(key).digest('hex').slice(0, 32));
}

function fields(buf) {
  const out = [];
  let pos = 0;
  const varint = () => {
    let value = 0;
    let shift = 0;
    let byte;
    do {
      if (pos >= buf.length || shift > 49) throw new Error('Damaged extension package');
      byte = buf[pos++];
      value += (byte & 0x7f) * 2 ** shift;
      shift += 7;
    } while (byte & 0x80);
    return value;
  };
  while (pos < buf.length) {
    const tag = varint();
    const type = tag % 8;
    const field = Math.floor(tag / 8);
    if (type === 0) varint();
    else if (type === 1) pos += 8;
    else if (type === 5) pos += 4;
    else if (type === 2) {
      const length = varint();
      if (pos + length > buf.length) throw new Error('Damaged extension package');
      out.push([field, buf.subarray(pos, pos + length)]);
      pos += length;
    } else throw new Error('Damaged extension package');
  }
  return out;
}

function verify(proof, signedData, archive) {
  const size = Buffer.alloc(4);
  size.writeUInt32LE(signedData.length);
  const verifier = crypto.createVerify('sha256');
  verifier.update(SIGNATURE_CONTEXT);
  verifier.update(size);
  verifier.update(signedData);
  verifier.update(archive);
  try {
    return verifier.verify(crypto.createPublicKey({ key: proof.key, format: 'der', type: 'spki' }), proof.signature);
  } catch {
    return false;
  }
}

function parse(buf, expectedId) {
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'Cr24') throw new Error('This is not a Chrome extension package');
  if (buf.readUInt32LE(4) !== 3) throw new Error('This extension package format is not supported');
  const headerSize = buf.readUInt32LE(8);
  if (12 + headerSize > buf.length) throw new Error('Damaged extension package');
  const header = buf.subarray(12, 12 + headerSize);
  const archive = buf.subarray(12 + headerSize);

  const proofs = [];
  let signedData = null;
  for (const [field, value] of fields(header)) {
    if (field === 2 || field === 3) {
      const proof = {};
      for (const [f, v] of fields(value)) {
        if (f === 1) proof.key = v;
        else if (f === 2) proof.signature = v;
      }
      if (proof.key && proof.signature) proofs.push(proof);
    } else if (field === 10000) {
      signedData = value;
    }
  }
  const crxId = signedData && fields(signedData).find(([f]) => f === 1)?.[1];
  if (!crxId || crxId.length !== 16) throw new Error('Damaged extension package');
  const id = toId(crxId.toString('hex'));
  if (expectedId && id !== expectedId) throw new Error('The downloaded extension does not match the one you asked for');

  let developerKey = null;
  for (const proof of proofs) {
    if (!verify(proof, signedData, archive)) throw new Error('The extension signature is not valid');
    if (idFromKey(proof.key) === id) developerKey = proof.key;
  }
  if (!developerKey) throw new Error('The extension is not signed by its developer');
  return { id, key: developerKey.toString('base64'), archive };
}

function safeTarget(root, name) {
  const clean = name.replace(/\\/g, '/');
  if (!clean || clean.includes('\0') || clean.startsWith('/') || /^[a-zA-Z]:/.test(clean) || clean.split('/').includes('..')) {
    throw new Error('The extension package contains an unsafe file name');
  }
  const target = path.resolve(root, clean);
  if (!target.startsWith(root + path.sep)) throw new Error('The extension package contains an unsafe file name');
  return target;
}

function unpack(archive, dest) {
  let count = 0;
  let total = 0;
  const files = unzipSync(new Uint8Array(archive.buffer, archive.byteOffset, archive.length), {
    filter: (file) => {
      count += 1;
      total += file.originalSize;
      if (count > MAX_FILES || total > MAX_BYTES) throw new Error('The extension package is too large');
      return true;
    },
  });
  const root = path.resolve(dest);
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('/')) continue;
    const target = safeTarget(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  }
}

function readManifest(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8').replace(/^﻿/, ''));
}

function install(buf, root, expectedId) {
  const { id, key, archive } = parse(buf, expectedId);
  const base = path.join(root, id);
  const temp = path.join(base, `.partial-${crypto.randomUUID()}`);
  fs.mkdirSync(temp, { recursive: true });
  try {
    unpack(archive, temp);
    const manifest = readManifest(temp);
    if (typeof manifest.version !== 'string' || !/^\d+(\.\d+){0,3}$/.test(manifest.version)) throw new Error('The extension has no valid version');
    manifest.key = key;
    fs.writeFileSync(path.join(temp, 'manifest.json'), JSON.stringify(manifest, null, 2));
    const dir = path.join(base, manifest.version);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(temp, dir);
    return { id, version: manifest.version, dir, manifest };
  } catch (err) {
    fs.rmSync(temp, { recursive: true, force: true });
    throw err;
  }
}

function newer(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0;
  }
  return false;
}

module.exports = { parse, install, unpack, readManifest, idFromKey, newer, ID };
