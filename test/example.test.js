'use strict';
/**
 * The example flow, run: the simulator's Function node code in a stand-in for the
 * Node-RED sandbox, its messages through the view runtime with the example's own
 * template. The example is the first thing a new user runs, so it must neither be
 * refused nor warn.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { ViewRuntime } = require('../lib/view');
const { apply } = require('../lib/tiles');

const flow = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'examples', 'Andon basics.json'), 'utf8'));
const viewNode = flow.find((n) => n.type === 'andon-view');
const simulator = flow.find((n) => n.type === 'function');

/** fakeDate is a Date whose "now" the test moves: the simulator and the runtime share it. */
function fakeDate(clock) {
    return class FakeDate extends Date {
        constructor(...args) { if (args.length) { super(...args); } else { super(clock.now); } }
        static now() { return clock.now; }
    };
}

/** makeSimulator returns a tick: the Function node once, the messages of its one output. */
function makeSimulator(random, clock) {
    const store = new Map();
    const context = { get: (k) => store.get(k), set: (k, v) => store.set(k, v) };
    const script = new vm.Script('(function () {\n' + simulator.func + '\n})()');
    const DateImpl = clock ? fakeDate(clock) : Date;
    return () => {
        const sandbox = { context, Math: Object.assign(Object.create(Math), { random }), Date: DateImpl };
        return script.runInNewContext(sandbox)[0];
    };
}

test('the example simulator feeds its template for an hour without a refusal or a warning', async () => {
    let seed = 1;
    const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    // Starting late on purpose: the template's timestamps then lie well in the past.
    const clock = { now: Date.parse('2026-10-01T09:17:42.318Z') };
    const tick = makeSimulator(random, clock);
    const runtime = new ViewRuntime({
        view: 'vw_totavbtprh6rdpgg2m2f6vrwny', kv: 1, key: Buffer.alloc(32),
        template: JSON.parse(viewNode.template), derive: new Set(viewNode.derive),
        window: { points: viewNode.windowPoints, ageSec: viewNode.windowAgeSec },
        put: async () => ({ outcome: 'ok', status: 204 }),
        clock: { now: () => clock.now, setTimeout: () => 0, clearTimeout: () => {} },
    });
    const warnings = new Set();
    for (let i = 0; i < 720; i++) { // one hour at the example's 5 s
        for (const msg of tick()) {
            runtime.receive(msg).warnings.forEach((w) => warnings.add(w.path + ': ' + w.message));
        }
        clock.now += 5000;
    }
    assert.deepEqual([...warnings], []);
    const doc = runtime.doc;
    assert.equal(doc.tiles.find((t) => t.id === 't_temp').series[0].samples.length, viewNode.windowPoints);
    assert.ok(doc.tiles.find((t) => t.id === 't_history').lanes[0].segments.length > 1, 'the line changed state at least once');
});

test('the simulator writes timestamps in whole seconds', () => {
    const msgs = makeSimulator(Math.random)();
    const history = msgs.find((m) => m.topic === 't_history' && typeof m.payload === 'object');
    assert.match(history.payload.from, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
});

test('a from with milliseconds trims a lane without starting a segment before it', () => {
    const doc = JSON.parse(viewNode.template);
    const t = doc.tiles.find((x) => x.id === 't_history');
    const from = new Date(Date.parse(t.lanes[0].segments[0][0]) + 1500).toISOString(); // .500Z
    const next = apply(doc, { topic: 't_history', payload: { from } }, { now: Date.now() }).doc;
    const seg = next.tiles.find((x) => x.id === 't_history').lanes[0].segments[0];
    assert.equal(seg[0], from);
});
