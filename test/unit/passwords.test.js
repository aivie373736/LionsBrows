'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Vault, parseCsv, originOf } = require('../../src/main/passwords');

const codec = {
  encrypt: (text) => Buffer.from(text).toString('base64').split('').reverse().join(''),
  decrypt: (data) => Buffer.from(data.split('').reverse().join(''), 'base64').toString(),
};

function vault() {
  return new Vault(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lb-pw-')), 'passwords.json'), codec);
}

test('parseCsv handles quotes, commas and line breaks', () => {
  assert.deepEqual(parseCsv('a,b\n"x, y","say ""hi"""\r\n\n'), [['a', 'b'], ['x, y', 'say "hi"']]);
  assert.equal(originOf('https://example.com/login?x=1'), 'https://example.com');
  assert.equal(originOf('ftp://example.com'), null);
});

test('vault saves, updates, hides passwords from listings and exports', () => {
  const v = vault();
  assert.equal(v.check('https://a.test', 'leo', 'roar'), 'new');
  const id = v.save('https://a.test', 'leo', 'roar');
  assert.equal(v.check('https://a.test', 'leo', 'roar'), 'same');
  assert.equal(v.check('https://a.test', 'leo', 'ROAR'), 'update');
  assert.ok(!JSON.stringify(v.list()).includes('roar'));
  v.flush();
  assert.ok(!fs.readFileSync(v.store.file, 'utf8').includes('roar'), 'passwords are stored encrypted');
  v.save('https://a.test', 'leo', 'ROAR');
  assert.equal(v.list().length, 1);
  assert.equal(v.password(id), 'ROAR');
  assert.deepEqual(v.forOrigin('https://b.test'), []);
  v.addNever('https://b.test');
  assert.equal(v.isNever('https://b.test'), true);
  assert.match(v.exportCsv(), /a\.test,https:\/\/a\.test,leo,ROAR/);
  v.remove(id);
  assert.equal(v.list().length, 0);
});

test('vault imports Chrome and Firefox CSV exports', () => {
  const v = vault();
  const chrome = 'name,url,username,password,note\nexample.com,https://example.com/login,leo,roar,\nbad,notaurl,x,y,\n';
  const firefox = '"url","username","password","httpRealm","formActionOrigin","guid"\n"https://mozilla.test","cub","purr",,"https://mozilla.test",""\n';
  assert.equal(v.importCsv(chrome), 1);
  assert.equal(v.importCsv(chrome), 0);
  assert.equal(v.importCsv(firefox), 1);
  assert.deepEqual(v.list().map((l) => [l.origin, l.username]), [['https://example.com', 'leo'], ['https://mozilla.test', 'cub']]);
  assert.throws(() => v.importCsv('a,b\n1,2\n'));
});
