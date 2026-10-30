'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { proxyUrl, originalUrl, offer, translatable } = require('../../src/main/translate');

test('pages go through the translation proxy and back', () => {
  const url = 'https://en.wikipedia.org/wiki/Lion?action=view#Behaviour';
  const proxied = proxyUrl(url, 'de');
  assert.equal(proxied, 'https://en-wikipedia-org.translate.goog/wiki/Lion?action=view&_x_tr_sl=auto&_x_tr_tl=de&_x_tr_hl=de#Behaviour');
  assert.equal(originalUrl(proxied), url);
  const dashed = proxyUrl('http://my-site.example.com/a', 'en');
  assert.equal(dashed, 'https://my--site-example-com.translate.goog/a?_x_tr_sl=auto&_x_tr_tl=en&_x_tr_hl=en&_x_tr_sch=http');
  assert.equal(originalUrl(dashed), 'http://my-site.example.com/a');
});

test('only public web pages can be translated', () => {
  assert.equal(translatable('https://example.com/'), true);
  assert.equal(translatable('http://127.0.0.1:8080/'), false);
  assert.equal(translatable('https://localhost/'), false);
  assert.equal(translatable('lions://settings/'), false);
  assert.equal(proxyUrl('https://example.com:8443/', 'de'), null);
});

test('translation is offered when the page language differs', () => {
  assert.equal(offer('https://example.com/', 'en-US', 'de'), 'translate');
  assert.equal(offer('https://example.com/', 'de-DE', 'de'), null);
  assert.equal(offer('https://example.com/', '', 'de'), null);
  assert.equal(offer('https://example-com.translate.goog/?_x_tr_tl=de', 'de', 'de'), 'original');
});
