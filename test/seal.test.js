'use strict';
/**
 * The status fingerprint. It decides whether an upload wakes the paired devices,
 * so its shape is fixed: every producer of a view has to compute the same one.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { fingerprint } = require('../lib/seal');

test('the fingerprint is ID=status of every tile, sorted, SHA-256', () => {
    const doc = { tiles: [{ id: 'b', status: 'ok' }, { id: 'a' }] };
    const expected = crypto.createHash('sha256').update('a=-\nb=ok', 'utf8').digest('hex');
    assert.equal(fingerprint(doc), expected);
});
