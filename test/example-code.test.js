'use strict';
/**
 * The function node "Insert example flow" writes, and the example "All tile kinds"
 * that ships one: run as Node-RED would run them, every message they send - as
 * written and with every commented-out form switched on - goes through the view
 * runtime, which checks the document against the schema. Nothing may be refused,
 * and nothing may warn.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { forms, exampleCode } = require('../resources/accepts');
const { ViewRuntime } = require('../lib/view');
const { validate } = require('../lib/validate');
const { template } = require('../testdata/fixtures');

const EXAMPLES = path.join(__dirname, '..', 'examples');
const kinds = JSON.parse(fs.readFileSync(path.join(EXAMPLES, 'All tile kinds.json'), 'utf8'));
const kindsView = kinds.find((n) => n.type === 'andon-view');
const kindsFunction = kinds.find((n) => n.type === 'function');

function run(code) {
    const sent = [];
    // eslint-disable-next-line no-new-func
    new Function('node', code)({ send: (msg) => sent.push(msg) });
    return sent;
}

function everyForm(code) {
    return code.replace(/^\/\/ node\.send/gm, 'node.send');
}

/** returned switches the code to its commented-out single message, as the comment says, and runs it. */
function returned(code) {
    const lines = code.split('\n');
    const start = lines.indexOf('// return { payload: {');
    const end = lines.indexOf('// } };');
    assert.ok(start > 0 && end > start, 'the single message is in the code');
    const switched = lines.map((line, i) => {
        if (/^node\.send/.test(line)) { return '// ' + line; }
        return i >= start && i <= end ? line.replace(/^\/\/ /, '') : line;
    }).join('\n');
    const sent = [];
    // eslint-disable-next-line no-new-func
    const msg = new Function('node', switched)({ send: (m) => sent.push(m) });
    assert.deepEqual(sent, []);
    return msg;
}

function runtime(doc) {
    return new ViewRuntime({
        view: 'vw_totavbtprh6rdpgg2m2f6vrwny', kv: 1, key: Buffer.alloc(32), template: doc,
        window: { points: 60, ageSec: 0 }, put: async () => ({ outcome: 'ok', status: 204 }),
        clock: { now: Date.now, setTimeout: () => 0, clearTimeout: () => {} },
    });
}

/** taken sends each message to a fresh runtime, or all to one, and collects warnings. */
function taken(doc, messages, oneByOne) {
    const warnings = [];
    let rt = runtime(doc);
    for (const msg of messages) {
        if (oneByOne) { rt = runtime(doc); }
        rt.receive(msg).warnings.forEach((w) => warnings.push(msg.topic + ' ' + w.path + ': ' + w.message));
    }
    return warnings;
}

for (const [name, doc] of [['the sample document', template()], ['the example "All tile kinds"', JSON.parse(kindsView.template)]]) {
    test(name + ': the example sends one message per tile, and each is taken without a warning', () => {
        const sent = run(exampleCode(doc));
        assert.deepEqual(sent.map((m) => m.topic), doc.tiles.map((t) => t.id));
        assert.deepEqual(taken(doc, sent, false), []);
    });

    test(name + ': the commented-out single message holds the same values and is taken', () => {
        const code = exampleCode(doc);
        const sent = run(code);
        const msg = returned(code);
        assert.equal(msg.topic, undefined);
        assert.deepEqual(Object.keys(msg.payload), sent.map((m) => m.topic));
        const rt = runtime(doc);
        const { changed, warnings } = rt.receive(msg);
        assert.deepEqual(warnings, []);
        // Taken as one message, it changes what the node.send lines change.
        const one = runtime(doc);
        const each = sent.flatMap((m) => one.receive(m).changed);
        assert.deepEqual(changed.sort(), each.sort());
    });

    test(name + ': a whole view document, as the comment names it, is taken too', () => {
        const { id, schemaVersion, name: title, tiles } = doc;
        const { warnings } = runtime(null).receive({ payload: { id, schemaVersion, name: title, tiles } });
        assert.deepEqual(warnings, []);
    });

    test(name + ': every commented-out form is taken too', () => {
        const sent = run(everyForm(exampleCode(doc)));
        assert.equal(sent.length, doc.tiles.reduce((n, t) => n + forms(t).length, 0));
        // One by one, from the template: each form on its own is what a user tries.
        taken(doc, sent, true);
    });
}

test('the example "All tile kinds" has every kind and every form a kind can have', () => {
    const doc = JSON.parse(kindsView.template);
    assert.deepEqual(validate(doc), { errors: [], warnings: [] });
    const kindsSeen = new Set(doc.tiles.map((t) => t.view));
    assert.deepEqual([...kindsSeen].sort(), ['bar', 'donut', 'gauge', 'label', 'line', 'pie', 'progress', 'table', 'timeline']);
    const keys = new Set(doc.tiles.flatMap((t) => forms(t).map((f) => f.key)));
    const { TEXT } = require('../resources/accepts');
    assert.deepEqual([...keys].sort(), Object.keys(TEXT).sort(), 'a form no tile of the example shows');
});

test('the example "All tile kinds" is wired as the button would wire it', () => {
    const byId = new Map(kinds.map((n) => [n.id, n]));
    const out = kinds.find((n) => n.type === 'andon-out');
    assert.equal(out.view, kindsView.id);
    assert.deepEqual(kindsFunction.wires, [[out.id]]);
    assert.equal(kindsFunction.name, 'Andon example');
    const inject = kinds.find((n) => n.type === 'inject');
    assert.deepEqual(inject.wires, [[kindsFunction.id]]);
    assert.ok(byId.get(kinds.find((n) => n.type === 'catch').scope[0]), 'the catch node watches a node of the example');
});

test('the example code is English and names no view, whatever the template is called', () => {
    const code = exampleCode(Object.assign(template(), { name: 'Toiletten' }));
    assert.doesNotMatch(code, /Toiletten/);
    assert.match(code, /^\/\/ An example message for every tile of this view/);
    const html = fs.readFileSync(path.join(__dirname, '..', 'nodes', 'andon-out.html'), 'utf8');
    assert.match(html, /name: 'Andon example',\s+func: window\.AndonAccepts\.exampleCode\(doc\)/);
});
