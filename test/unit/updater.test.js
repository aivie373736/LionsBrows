'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { newer } = require('../../src/main/updater');

test('newer compares release versions', () => {
  assert.equal(newer('0.2.0', '0.1.0'), true);
  assert.equal(newer('v0.1.1', '0.1.0'), true);
  assert.equal(newer('0.1.0', '0.1.0'), false);
  assert.equal(newer('0.1.0', '0.2.0'), false);
  assert.equal(newer('1.0.0', '0.9.9'), true);
  assert.equal(newer('0.10.0', '0.9.0'), true);
});
