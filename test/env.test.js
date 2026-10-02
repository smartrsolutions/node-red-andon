'use strict';
/**
 * The view's values from the environment (lib/env.js), inside a real Node-RED.
 *
 * What is being checked is the property that makes this worth having: with a
 * prefix set, a flow file carries variable names and no secret, and the view still
 * uploads. Plus the two ways it can go wrong - a variable nobody set, and a prefix
 * that is not one - both of which have to say which it was.
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
const OTHER_VIEW = 'vw_aaaavbtprh6rdpgg2m2f6vrwny';
const WRITE_SECRET = 'ws_' + 'B'.repeat(43);
const KEY = crypto.randomBytes(32);
const PREFIX = 'ANDON_CLOUD_';

let server;
let requests = [];

test.before(async () => {
    server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
            requests.push({ url: req.url, auth: req.headers.authorization, body });
            res.writeHead(204);
            res.end();
        });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    process.env[PREFIX + 'URL'] = 'http://127.0.0.1:' + server.address().port;
});

test.after(async () => {
    for (const suffix of ['URL', 'VIEW', 'WRITE_SECRET', 'CONTENT_KEY', 'KEY_VERSION']) {
        delete process.env[PREFIX + suffix];
    }
    await new Promise((r) => server.close(r));
});

test.beforeEach(() => {
    requests = [];
    process.env[PREFIX + 'VIEW'] = VIEW;
    process.env[PREFIX + 'WRITE_SECRET'] = WRITE_SECRET;
    process.env[PREFIX + 'CONTENT_KEY'] = KEY.toString('base64url');
    process.env[PREFIX + 'KEY_VERSION'] = '3';
    return new Promise((r) => helper.startServer(r));
});

test.afterEach(async () => {
    await helper.unload();
    await new Promise((r) => helper.stopServer(r));
});

/** flow is a view with nothing but a prefix, as a container would configure it. */
function flow(viewExtra = {}) {
    return [
        Object.assign({
            id: 'v1', type: 'andon-view', name: 'Demo Cloud', envPrefix: PREFIX,
            template: JSON.stringify(template()), intervalSec: 10, notify: 'auto',
        }, viewExtra),
        { id: 'o1', type: 'andon-out', view: 'v1', wires: [['h1']] },
        { id: 'h1', type: 'helper' },
    ];
}

function nextCall(node, method) {
    return new Promise((resolve) => {
        const original = node[method].bind(node);
        node[method] = function (...args) {
            original(...args);
            resolve({ firstArg: args[0], args });
        };
    });
}

test('a view configured by nothing but a prefix uploads, and the flow holds no secret', async () => {
    const config = flow();
    assert.doesNotMatch(JSON.stringify(config), /ws_B|[A-Za-z0-9+/_-]{43}/,
        'the flow of this test must carry variable names only');

    await helper.load([viewNode, outNode], config, {});
    const view = helper.getNode('v1');
    assert.equal(view.problem, null);
    assert.equal(view.viewId, VIEW, 'the view ID comes from ' + PREFIX + 'VIEW');
    assert.equal(view.kv, 3, 'the key version comes from ' + PREFIX + 'KEY_VERSION');

    const sent = new Promise((resolve) => helper.getNode('h1').on('input', resolve));
    helper.getNode('o1').receive({ topic: 't_oee', payload: 81 });
    await sent;

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/v1/views/' + VIEW + '/envelope');
    assert.equal(requests[0].auth, 'Bearer ' + WRITE_SECRET);
    assert.equal(JSON.parse(requests[0].body).kv, 3);
});

test('what the view holds wins over the environment', async () => {
    await helper.load([viewNode, outNode], flow({ viewId: OTHER_VIEW, kv: 1 }), {});
    const view = helper.getNode('v1');
    assert.equal(view.problem, null);
    assert.equal(view.viewId, OTHER_VIEW);
    assert.equal(view.kv, 1);
});

test('a credential in the view wins, and the environment fills in the rest', async () => {
    delete process.env[PREFIX + 'WRITE_SECRET'];
    const own = 'ws_' + 'C'.repeat(43);
    await helper.load([viewNode, outNode], flow(), { v1: { writeSecret: own } });
    assert.equal(helper.getNode('v1').problem, null);

    const sent = new Promise((resolve) => helper.getNode('h1').on('input', resolve));
    helper.getNode('o1').receive({ topic: 't_oee', payload: 77 });
    await sent;
    assert.equal(requests[0].auth, 'Bearer ' + own);
});

test('a variable nobody set names itself', async () => {
    delete process.env[PREFIX + 'WRITE_SECRET'];
    await helper.load([viewNode, outNode], flow(), {});
    const view = helper.getNode('v1');
    assert.match(view.problem, /write secret missing or malformed/);
    assert.match(view.problem, new RegExp(PREFIX + 'WRITE_SECRET'));

    const out = helper.getNode('o1');
    const error = nextCall(out, 'error');
    out.receive({ topic: 't_oee', payload: 1 });
    await error;
    assert.equal(requests.length, 0, 'nothing goes out while the view is incomplete');
});

test('a missing content key names its variable rather than a byte count', async () => {
    delete process.env[PREFIX + 'CONTENT_KEY'];
    await helper.load([viewNode, outNode], flow(), {});
    const problem = helper.getNode('v1').problem;
    assert.match(problem, /content key missing/);
    assert.match(problem, new RegExp(PREFIX + 'CONTENT_KEY'));
    assert.doesNotMatch(problem, /0 bytes/);
});

test('a content key of the wrong length is still refused', async () => {
    process.env[PREFIX + 'CONTENT_KEY'] = crypto.randomBytes(16).toString('base64');
    await helper.load([viewNode, outNode], flow(), {});
    assert.match(helper.getNode('v1').problem, /16 bytes, expected 32/);
});

test('a prefix that is not one is refused, and says what one looks like', async () => {
    await helper.load([viewNode, outNode], flow({ envPrefix: 'andon_cloud' }), {});
    const problem = helper.getNode('v1').problem;
    assert.match(problem, /upper case and end in an underscore/);
    assert.match(problem, /ANDON_CLOUD_/);
});

test('without a prefix the environment is not consulted at all', async () => {
    await helper.load([viewNode, outNode], flow({ envPrefix: '' }), {});
    const problem = helper.getNode('v1').problem;
    assert.match(problem, /view ID missing or malformed/);
    assert.match(problem, /import the \.env from the configurator/);
});
