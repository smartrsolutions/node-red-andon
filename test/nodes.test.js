'use strict';
/**
 * The two nodes inside a real Node-RED (node-red-node-test-helper), uploading to a
 * stand-in relay on localhost. ANDON_RELAY_URL points them there - the switch a
 * developer uses to try the package against a relay of their own.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const helper = require('node-red-node-test-helper');

const viewNode = require('../nodes/andon-view.js');
const outNode = require('../nodes/andon-out.js');
const { template } = require('../testdata/fixtures');

helper.init(require.resolve('node-red'));

const VIEW = 'vw_totavbtprh6rdpgg2m2f6vrwny';
const WRITE_SECRET = 'ws_' + 'A'.repeat(43);
const KEY = crypto.randomBytes(32);

let server;
let requests = [];
let answer = { status: 204, body: '' };

test.before(async () => {
    server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
            requests.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
            res.writeHead(answer.status, { 'content-type': 'application/json' });
            res.end(answer.body);
        });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    process.env.ANDON_RELAY_URL = 'http://127.0.0.1:' + server.address().port;
});

test.after(async () => {
    delete process.env.ANDON_RELAY_URL;
    await new Promise((r) => server.close(r));
});

test.beforeEach(() => {
    requests = [];
    answer = { status: 204, body: '' };
    return new Promise((r) => helper.startServer(r));
});

test.afterEach(async () => {
    await helper.unload();
    await new Promise((r) => helper.stopServer(r));
});

function flow(viewExtra = {}) {
    return [
        Object.assign({ id: 'v1', type: 'andon-view', name: 'Linie 1', viewId: VIEW, kv: 2, template: JSON.stringify(template()),
            intervalSec: 30, staleAfterSec: '', notify: 'auto', windowPoints: 60, windowAgeSec: 0, derive: [] }, viewExtra),
        { id: 'o1', type: 'andon-out', view: 'v1', wires: [['h1']] },
        { id: 'h1', type: 'helper' },
    ];
}
const credentials = { v1: { writeSecret: WRITE_SECRET, contentKey: KEY.toString('base64url') } };

function open(text) {
    const env = JSON.parse(text);
    const raw = Buffer.from(env.ct, 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(env.nonce, 'base64'), { authTagLength: 16 });
    d.setAAD(Buffer.from('andon-v1|' + env.view + '|' + env.kv, 'utf8'));
    d.setAuthTag(raw.subarray(raw.length - 16));
    return JSON.parse(Buffer.concat([d.update(raw.subarray(0, raw.length - 16)), d.final()]).toString('utf8'));
}

function nextMessage(node) {
    return new Promise((resolve) => node.once('input', resolve));
}

function nextCall(node, name) {
    return new Promise((resolve) => node.once('call:' + name, (call) => resolve(call)));
}

test('a value becomes a sealed PUT with the write secret in the header only', async () => {
    await helper.load([viewNode, outNode], flow(), credentials);
    const out = helper.getNode('o1');
    const report = nextMessage(helper.getNode('h1'));
    out.receive({ topic: 't_oee', payload: 81.4 });
    const msg = await report;

    assert.equal(requests.length, 1);
    const r = requests[0];
    assert.equal(r.method, 'PUT');
    assert.equal(r.url, '/v1/views/' + VIEW + '/envelope');
    assert.equal(r.auth, 'Bearer ' + WRITE_SECRET);
    assert.doesNotMatch(r.body, /ws_/);
    const env = JSON.parse(r.body);
    assert.deepEqual(Object.keys(env), ['v', 'view', 'kv', 'nonce', 'ct', 'notify']);
    assert.equal(env.kv, 2);
    const doc = open(r.body);
    assert.equal(doc.tiles.find((t) => t.id === 't_oee').value, 81.4);
    assert.equal(doc.staleAfterSec, 90);

    assert.equal(msg.payload.ok, true);
    assert.equal(msg.payload.status, 204);
    assert.doesNotMatch(JSON.stringify(msg), /ws_A|"ct"|nonce/);
});

test('a value that does not fit its tile goes to done(err) and nothing is sent', async () => {
    await helper.load([viewNode, outNode], flow(), credentials);
    const out = helper.getNode('o1');
    const error = nextCall(out, 'error');
    out.receive({ topic: 't_nope', payload: 1 });
    const call = await error;
    assert.match(String(call.firstArg && call.firstArg.message || call.firstArg), /no tile "t_nope"/);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(requests.length, 0);
});

test('a view without credentials says so on every node and sends nothing', async () => {
    await helper.load([viewNode, outNode], flow(), {});
    const out = helper.getNode('o1');
    const error = nextCall(out, 'error');
    out.receive({ topic: 't_oee', payload: 1 });
    const call = await error;
    assert.match(String(call.firstArg && call.firstArg.message || call.firstArg), /write secret missing/);
    assert.equal(requests.length, 0);
});

test('401 is reported to the node whose value was in the upload, with a hint', async () => {
    answer = { status: 401, body: '{"error":"unauthorized","message":"bad secret"}' };
    await helper.load([viewNode, outNode], flow(), credentials);
    const out = helper.getNode('o1');
    const error = nextCall(out, 'error');
    out.receive({ topic: 't_oee', payload: 81 });
    const call = await error;
    assert.match(String(call.firstArg), /write secret/);
    assert.equal(call.args[1].payload.status, 401);
    assert.doesNotMatch(JSON.stringify(call.args), /ws_A/);
});

test('the dialog learns which relay this runtime talks to', async () => {
    await helper.load([viewNode, outNode], flow(), credentials);
    const res = await helper.request().get('/andon-view/relay').expect(200);
    assert.equal(res.body.url, process.env.ANDON_RELAY_URL);
    assert.deepEqual(res.body.aliases, []);
});

test('ANDON_RELAY_ALIASES names the other addresses of the same relay', async () => {
    process.env.ANDON_RELAY_ALIASES = ' http://127.0.0.1:8080/ , http://127.0.0.1:8081,';
    try {
        await helper.load([viewNode, outNode], flow(), credentials);
        const res = await helper.request().get('/andon-view/relay').expect(200);
        assert.deepEqual(res.body.aliases, ['http://127.0.0.1:8080', 'http://127.0.0.1:8081']);
    } finally {
        delete process.env.ANDON_RELAY_ALIASES;
    }
});

test('the dialog can check a template before deploying it', async () => {
    await helper.load([viewNode, outNode], flow(), credentials);
    const good = await helper.request().post('/andon-view/check').send({ template: JSON.stringify(template()) }).expect(200);
    assert.equal(good.body.ok, true);
    assert.equal(good.body.tiles.length, 14);
    assert.ok(good.body.tiles.find((t) => t.id === 't_oee').bands);

    // A gauge without a range: picked by ID, so reordering the template's tiles
    // cannot turn this into a document that happens to be valid.
    const broken = template();
    delete broken.tiles.find((tile) => tile.id === 't_oee').range;
    const bad = await helper.request().post('/andon-view/check').send({ template: JSON.stringify(broken) }).expect(200);
    assert.equal(bad.body.ok, false);
    assert.ok(bad.body.errors.length > 0);

    const junk = await helper.request().post('/andon-view/check').send({ template: 'nope' }).expect(200);
    assert.equal(junk.body.ok, false);
});
