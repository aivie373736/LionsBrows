'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { keyOf, build, matches, hash } = require('../../src/main/blocklist');

test('rules become hostname or URL keys, unsupported ones are skipped', () => {
  assert.equal(keyOf('phish.example.xyz'), 'phish.example.xyz');
  assert.equal(keyOf('||bad.example.com^'), 'bad.example.com');
  assert.equal(keyOf('||bad.example.com^$doc'), 'bad.example.com');
  assert.equal(keyOf('||Evil.Example.com/Login/Index.php^$all'), 'evil.example.com/Login/Index.php');
  assert.equal(keyOf('||1.2.3.4:8080/bins/x.sh^$all'), '1.2.3.4:8080/bins/x.sh');
  assert.equal(keyOf('||site.example/^'), 'site.example');
  assert.equal(keyOf('||cdn.example.com^$script,3p'), null);
  assert.equal(keyOf('||scam.example^$doc,to=~edu|~gov'), null);
  assert.equal(keyOf('! comment'), null);
  assert.equal(keyOf('example.com##.ad'), null);
  assert.equal(keyOf('@@||good.example^'), null);
  assert.equal(keyOf('||ads*.example^'), null);
  assert.equal(keyOf('/regex/'), null);
});

test('hosts, their subdomains and listed URLs match, other pages do not', () => {
  const list = build(['! Title: test', 'phish.example.xyz', '||bad.example.com^$doc', '||files.example.net/dl/malware.exe^$all', '||1.2.3.4:8080/bins/^$all', '||cdn.example.org^$script'].join('\n'));
  assert.equal(list.length, 4);
  assert.equal(matches(list, 'https://phish.example.xyz/login'), true);
  assert.equal(matches(list, 'https://www.bad.example.com/'), true);
  assert.equal(matches(list, 'http://files.example.net/dl/malware.exe?x=1'), true);
  assert.equal(matches(list, 'http://1.2.3.4:8080/bins/mozi.m'), true);
  assert.equal(matches(list, 'https://files.example.net/dl/other.exe'), false);
  assert.equal(matches(list, 'https://example.com/'), false);
  assert.equal(matches(list, 'https://notbad.example.com.other.org/'), false);
  assert.equal(matches(list, 'https://cdn.example.org/lib.js'), false);
  assert.equal(matches(list, 'lions://settings/'), false);
});

test('hashes are stable numbers', () => {
  assert.equal(hash('example.com'), hash('example.com'));
  assert.notEqual(hash('example.com'), hash('example.org'));
  assert.ok(Number.isSafeInteger(hash('a')));
});
