'use strict';
// The hint a refused value gets comes from @smartrsolutions/andon-client; the
// dialog's list and the example function node come from resources/accepts.js,
// which the editor loads. Both have to say the same.

const test = require('node:test');
const assert = require('node:assert/strict');

const core = require('@smartrsolutions/andon-client/runtime');
const editor = require('../resources/accepts');
const { template } = require('../testdata/fixtures');

const NOW = Date.parse('2026-09-22T18:40:00Z');

function documents() {
    const steps = template();
    const takt = steps.tiles.find((t) => t.id === 't_takt');
    takt.series = [{ name: 'Ist', start: '2026-09-22T00:00:00Z', stepSec: 3600, points: [31, 32, 30] }];
    return [template(), steps];
}

test('the runtime hint is word for word the one resources/accepts.js gives', () => {
    for (const doc of documents()) {
        for (const tile of doc.tiles) {
            assert.equal(core.hint(tile, core.NODE_RED_WORDS), editor.hint(tile), tile.id);
        }
    }
});

test('every form has the same key and wording on both sides', () => {
    for (const doc of documents()) {
        for (const tile of doc.tiles) {
            const ours = core.forms(tile, NOW);
            const theirs = editor.forms(tile, NOW);
            assert.deepEqual(ours.map((f) => f.key), theirs.map((f) => f.key), tile.id);
            ours.forEach((f, i) => {
                assert.equal(core.describe(f, core.NODE_RED_WORDS), editor.describe(theirs[i]), tile.id + ' ' + f.key);
                assert.deepEqual(f.example, theirs[i].example, tile.id + ' ' + f.key);
                assert.deepEqual(Object.keys(f.extra), Object.keys(theirs[i].msg), tile.id + ' ' + f.key);
            });
        }
    }
});
