'use strict';
/**
 * The texts a user reads, word for word: in a Catch node, in the debug sidebar,
 * under a node. They name msg properties and the editor's buttons, and a flow may
 * match on them. When the package moves onto @smartrsolutions/andon-client, whose
 * own API words them differently, these must not change.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { apply } = require('../lib/tiles');
const { ViewRuntime, ValidationError } = require('../lib/view');
const relay = require('../lib/relay');
const { template } = require('../testdata/fixtures');

const NOW = Date.parse('2026-09-22T18:40:00Z');
const opts = { now: NOW, window: { points: 60, ageSec: 0 } };

function refusal(fn) {
    try { fn(); } catch (e) { return e.message; }
    assert.fail('nothing was refused');
}

test('refusals name the msg property that was wrong', () => {
    assert.equal(refusal(() => apply(template(), { topic: 't_takt', payload: 1, timestamp: 'gestern' }, opts)),
        'msg.timestamp is neither milliseconds nor an ISO timestamp: gestern. A line takes a number (is appended to the series, ' +
        'at the time it arrives) or an array of [timestamp, value] pairs (replaces the series; msg.series picks which)');
    assert.match(refusal(() => apply(template(), { topic: 't_oee', payload: null }, opts)), /^tile "t_oee": msg\.payload is empty\. /);
    assert.equal(refusal(() => apply(template(), { payload: {} }, opts)), 'msg.payload names no tile');
    assert.equal(refusal(() => apply(template(), { payload: 5 }, opts)),
        'msg.topic is missing: set it to the ID of the tile this value belongs to');
    assert.equal(refusal(() => apply(null, { topic: 't_oee', payload: 5 }, opts)),
        'there is no template yet: import one in the view, or send a whole view document first');
});

test('a value that breaks a tile says what the tile takes, in msg words', () => {
    const rt = new ViewRuntime({
        view: 'vw_totavbtprh6rdpgg2m2f6vrwny', kv: 1, key: Buffer.alloc(32), template: template(),
        put: async () => ({ outcome: 'ok', status: 204 }),
        clock: { now: () => NOW, setTimeout: () => 0, clearTimeout: () => {} },
    });
    const e = (() => { try { rt.receive({ topic: 't_takt', payload: { series: [{ name: 'Ist', start: 'x', stepSec: 60, points: [1] }] } }); } catch (err) { return err; } })();
    assert.ok(e instanceof ValidationError);
    assert.match(e.message, /msg\.series picks which\)$/);
});

test('the relay hints point at the view\'s Import .env', async () => {
    const answer = (status) => async () => ({ status, text: async () => '{"error":"x"}', headers: { get: () => null } });
    const base = { base: 'http://relay.test', view: 'vw_totavbtprh6rdpgg2m2f6vrwny', writeSecret: 'ws_x', envelope: '{}' };
    assert.equal((await relay.put(Object.assign({ fetchImpl: answer(401) }, base))).message,
        'the relay rejected the write secret (x): import the current .env into the view');
    assert.equal((await relay.put(Object.assign({ fetchImpl: answer(404) }, base))).message,
        'the relay does not know this view (x): check the view ID, or import the current .env');
    assert.equal((await relay.put(Object.assign({ fetchImpl: answer(413) }, base))).message,
        'the envelope is larger than 256 KiB (x): fewer tiles or shorter series');
});
