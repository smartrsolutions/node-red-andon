'use strict';
/**
 * What resources/accepts.js offers has to be what lib/tiles.js takes: every form
 * of every tile, as shown and as the generated function node writes it, goes
 * through apply and the validator.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { forms, hint, TEXT } = require('../resources/accepts');
const { apply, InputError } = require('../lib/tiles');
const { validate } = require('../lib/validate');
const { template } = require('../testdata/fixtures');

const NOW = Date.parse('2026-09-22T18:40:00Z');
const opts = { now: NOW, window: { points: 60, ageSec: 0 } };

// The sample has every kind; a line in the step form it does not have.
function documents() {
    const steps = template();
    const takt = steps.tiles.find((t) => t.id === 't_takt');
    takt.series = [{ name: 'Ist', start: '2026-09-22T00:00:00Z', stepSec: 3600, points: [31, 32, 30] }];
    return [template(), steps];
}

test('every form offered for a tile is taken by it, as example and as code', () => {
    for (const doc of documents()) {
        for (const tile of doc.tiles) {
            const offered = forms(tile, NOW);
            assert.ok(offered.length > 1, tile.id + ' offers nothing but fields');
            for (const f of offered) {
                // eslint-disable-next-line no-new-func
                const fromCode = new Function('return ' + f.code)();
                // The further message properties a form needs, as shown and as code.
                const extra = (pick) => Object.fromEntries(Object.entries(f.msg).map(([k, v]) => [k, pick(v)]));
                // eslint-disable-next-line no-new-func
                const extraFromCode = extra((v) => new Function('return ' + v.code)());
                for (const [payload, more] of [[f.example, extra((v) => v.example)], [fromCode, extraFromCode]]) {
                    const what = tile.id + ' ' + f.key + ' ' + JSON.stringify(payload) + ' ' + JSON.stringify(more);
                    const { doc: next, changed } = apply(doc, Object.assign({ topic: tile.id, payload }, more), opts);
                    assert.ok(changed.length <= 1, what);
                    assert.deepEqual(validate(next).errors, [], what);
                }
            }
        }
    }
});

test('a line in the step form is not offered a single number: there is no timestamp to append it at', () => {
    const tile = documents()[1].tiles.find((t) => t.id === 't_takt');
    assert.deepEqual(forms(tile, NOW).map((f) => f.key), ['pairs', 'samples', 'steps', 'fields']);
    assert.throws(() => apply(documents()[1], { topic: 't_takt', payload: 5 }, opts), InputError);
});

test('every kind offers all its forms, and the forms that need a property only where it can pick something', () => {
    const keys = (id, doc = template()) => forms(doc.tiles.find((t) => t.id === id), NOW).map((f) => f.key);
    assert.deepEqual(keys('t_line'), ['text', 'fields']);
    assert.deepEqual(keys('t_oee'), ['number', 'fields']);
    assert.deepEqual(keys('t_takt'), ['append', 'appendAt', 'pairs', 'samples', 'steps', 'fields']);
    assert.deepEqual(keys('t_pieces_hour'), ['pairs', 'samples', 'steps', 'fields'], 'two step series');
    assert.deepEqual(keys('t_defects'), ['number', 'values', 'categories', 'fields']);
    assert.deepEqual(keys('t_causes'), ['values', 'categories', 'fields']);
    assert.deepEqual(keys('t_scrap_station'), ['values', 'categories', 'statuses', 'fields']);
    assert.deepEqual(keys('t_stations'), ['rows', 'rowStatus', 'fields']);
    assert.deepEqual(keys('t_history'), ['state', 'stateAt', 'stateLane', 'window', 'fields']);
    const two = template();
    two.tiles.find((t) => t.id === 't_takt').series.push({ name: 'Soll', samples: [['2026-09-22T18:00:00Z', 30]] });
    assert.deepEqual(keys('t_takt', two), ['append', 'appendAt', 'appendTo', 'pairs', 'samples', 'steps', 'fields']);
});

test('a refused value is told what the tile takes, in English', () => {
    const cases = [
        ['t_takt', 'hoch', /needs a number, got "hoch"\. A line takes a number \(is appended to the series, at the time it arrives\) or an array of \[timestamp, value\] pairs/],
        ['t_causes', 5, /takes no single value\. A pie with categories takes an array of numbers, one per category \(replaces the values; categories: 4\)/],
        ['t_line', [1], /takes no array\. A label takes a text or a number/],
        ['t_history', 'kaputt', /no state "kaputt".*A timeline takes a state ID \(run, setup, starved, fault, maint\)/],
    ];
    for (const [id, payload, expected] of cases) {
        assert.throws(() => apply(template(), { topic: id, payload }, opts), (e) => e instanceof InputError && expected.test(e.message), id);
    }
});

test('an unknown tile gets no hint, and a kind the package does not know gets none either', () => {
    assert.throws(() => apply(template(), { topic: 't_nope', payload: 1 }, opts), (e) => !/ takes /.test(e.message));
    assert.equal(hint({ id: 't_x', view: 'sparkle' }), '');
});

test('the editor shows the same English as the errors, and every form in German too', () => {
    for (const [locale, same] of [['en-US', true], ['de', false]]) {
        const words = require('../nodes/locales/' + locale + '/andon-out.json')['andon-out'].accepts;
        assert.deepEqual(Object.keys(words).sort(), Object.keys(TEXT).sort(), locale);
        if (same) { assert.deepEqual(words, TEXT); }
    }
});
