'use strict';
/**
 * andon-view: one Andon view. A config node, so it has no place in a flow; every
 * andon out node that names it feeds the one ViewRuntime it owns (lib/view.js).
 *
 * The write secret and the content key are credentials: Node-RED stores them in
 * flows_cred.json, encrypted with credentialSecret, and leaves them out of every
 * flow export. The content key never leaves this process; the write secret only
 * goes into the Authorization header to the relay.
 *
 * They may also come from the environment instead, under a prefix of this view's
 * own (lib/env.js) - for a Node-RED in a container, which has no editor to type
 * them into and no credential store worth writing to. What the dialog holds always
 * wins; the environment fills in what it left empty.
 */

const crypto = require('crypto');
const { ViewRuntime } = require('../lib/view');
const { parseKey, VIEW_ID, WRITE_SECRET } = require('../lib/seal');
const { validate, summary } = require('../lib/validate');
const relay = require('../lib/relay');
const envFile = require('../lib/env');

const STATE_KEY = 'andonState';
const MAX_BODY = 1024 * 1024;

module.exports = function (RED) {
    function AndonView(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.name = config.name;
        node.viewId = String(config.viewId || '').trim();
        node.kv = Number(config.kv) || 1;
        node.listeners = new Map();
        node.problem = null;
        node.runtime = null;

        const creds = node.credentials || {};
        let template = null;
        let key = null;
        // With an environment prefix set, anything the dialog leaves empty is read
        // from the environment instead (lib/env.js). What is configured here always
        // wins, so a prefix is a fallback and never a surprise.
        const prefix = String(config.envPrefix || '').trim();
        const fromEnv = (suffix) => (prefix ? envFile.pick(prefix, suffix) : '');
        const orEnv = (value, suffix) => (value || fromEnv(suffix));
        // "set it in the view, or in ANDON_CLOUD_VIEW" - a message about a missing
        // value has to name the variable that is actually read, not a generic one.
        const says = (suffix) => (prefix
            ? 'set it in the view, or in ' + envFile.name(prefix, suffix)
            : 'import the .env from the configurator');
        let writeSecret = '';
        try {
            envFile.checkPrefix(prefix);
            node.viewId = orEnv(node.viewId, 'VIEW');
            node.kv = Number(config.kv || fromEnv('KEY_VERSION')) || 1;
            writeSecret = String(orEnv(String(creds.writeSecret || '').trim(), 'WRITE_SECRET'));
            if (!VIEW_ID.test(node.viewId)) { throw new Error('view ID missing or malformed: ' + says('VIEW')); }
            if (!WRITE_SECRET.test(writeSecret)) { throw new Error('write secret missing or malformed: ' + says('WRITE_SECRET')); }
            const contentKey = orEnv(String(creds.contentKey || '').trim(), 'CONTENT_KEY');
            if (!contentKey) { throw new Error('content key missing: ' + says('CONTENT_KEY')); }
            key = parseKey(contentKey);
            if (!Number.isInteger(node.kv) || node.kv < 1) { throw new Error('key version must be an integer of 1 or more'); }
            if (config.template && String(config.template).trim()) {
                template = JSON.parse(config.template);
                const check = validate(template);
                if (check.errors.length) { throw new Error('template invalid: ' + summary(template, check.errors)); }
            }
        } catch (err) {
            node.problem = err instanceof SyntaxError ? 'template is not a JSON document' : err.message;
        }

        // The state survives a restart when a persistent context store is set up,
        // and only while view and template are the ones it was built from.
        const stamp = crypto.createHash('sha256').update(node.viewId + '\n' + (config.template || '')).digest('hex');
        let restored = null;
        if (!node.problem) {
            try {
                const saved = node.context().get(STATE_KEY);
                if (saved && saved.stamp === stamp && saved.doc) { restored = saved; }
            } catch (e) { /* no context store: start from the template */ }
        }

        if (!node.problem) {
            // <PREFIX>URL is this view's own address and wins over the global
            // ANDON_RELAY_URL: one environment can then hold several views on
            // several relays, which is what the CLI's .env files look like.
            const own = prefix ? envFile.pick(prefix, 'URL').replace(/\/+$/, '') : '';
            const base = own || relay.relayUrl();
            if (base !== relay.DEFAULT_RELAY) {
                node.log((own ? envFile.name(prefix, 'URL') : 'ANDON_RELAY_URL') + ' is set: uploads go to ' + base);
            }
            node.runtime = new ViewRuntime({
                view: node.viewId,
                kv: node.kv,
                key,
                notify: config.notify || 'auto',
                intervalSec: Number(config.intervalSec) || 30,
                staleAfterSec: Number(config.staleAfterSec) || 0,
                window: { points: Number(config.windowPoints) || 0, ageSec: Number(config.windowAgeSec) || 0 },
                derive: new Set(Array.isArray(config.derive) ? config.derive : []),
                template,
                restored,
                put: (envelope) => relay.put({ base, view: node.viewId, writeSecret, envelope }),
                onEvent: (event) => {
                    if (event.type === 'sent') {
                        try { node.context().set(STATE_KEY, { stamp, doc: event.doc, fingerprint: event.fingerprint, live: event.live }); } catch (e) { /* ignore */ }
                    }
                    node.listeners.forEach((listener) => listener(event));
                },
            });
        }

        node.register = function (outNode, listener) { node.listeners.set(outNode.id, listener); };
        node.deregister = function (outNode) { node.listeners.delete(outNode.id); };

        node.on('close', function () {
            if (node.runtime) { node.runtime.close(); }
            node.listeners.clear();
        });
    }

    RED.nodes.registerType('andon-view', AndonView, {
        credentials: {
            writeSecret: { type: 'password' },
            contentKey: { type: 'password' },
        },
    });

    // Which relay this runtime talks to, so the dialog can refuse a .env that names
    // another one - the same rule as the configurator.
    RED.httpAdmin.get('/andon-view/relay', RED.auth.needsPermission('andon-view.read'), function (req, res) {
        res.json({ url: relay.relayUrl(), aliases: relay.relayAliases() });
    });

    // The full check of a template, so the dialog can show what is wrong before
    // the flow is deployed. A template holds no secret.
    RED.httpAdmin.post('/andon-view/check', RED.auth.needsPermission('andon-view.write'), function (req, res) {
        readBody(req).then((body) => {
            let doc;
            try { doc = JSON.parse(body); } catch (e) { return res.json({ ok: false, errors: [{ path: '/', message: 'not a JSON document' }], warnings: [] }); }
            const check = validate(doc);
            res.json({
                ok: check.errors.length === 0,
                errors: check.errors.slice(0, 20),
                warnings: check.warnings.slice(0, 20),
                tiles: Array.isArray(doc.tiles) ? doc.tiles.map((t) => ({ id: t && t.id, view: t && t.view, title: t && t.title, bands: !!(t && Array.isArray(t.bands) && t.bands.length) })) : [],
            });
        }, () => res.status(413).end());
    });
};

/**
 * readBody returns the template text of {"template": "<text>"}. The admin app's
 * JSON parser may or may not have run, so both cases are handled.
 */
function readBody(req) {
    if (req.body && typeof req.body === 'object') { return Promise.resolve(String(req.body.template || '')); }
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); } else { chunks.push(c); } });
        req.on('end', () => {
            try { resolve(String(JSON.parse(Buffer.concat(chunks).toString('utf8')).template || '')); } catch (e) { resolve(''); }
        });
        req.on('error', reject);
    });
}
