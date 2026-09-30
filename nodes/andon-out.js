'use strict';
/**
 * andon out: takes values for the tiles of a view and hands them to the view's
 * runtime (nodes/andon-view.js), which bundles, seals and uploads them.
 *
 * msg.topic is the tile ID, msg.payload the value (see README, "Messages").
 * A value that does not fit its tile is refused with done(err), so a Catch node
 * sees it, and the document stays as it was.
 *
 * The one output carries a summary of every upload this node contributed to:
 * view, kv, notify, sizes, status code. Never the envelope, never the write secret.
 */

const { InputError, ValidationError } = require('../lib/view');

const MAX_REMEMBERED_WARNINGS = 50;

module.exports = function (RED) {
    function AndonOut(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const view = RED.nodes.getNode(config.view);
        const warned = new Set();

        function clock() {
            const d = new Date();
            return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
        }
        function short(text) {
            const s = String(text || '');
            return s.length > 60 ? s.slice(0, 57) + '...' : s;
        }

        if (!view) {
            node.status({ fill: 'red', shape: 'ring', text: RED._('andon-out.status.noView') });
        } else if (view.problem) {
            node.status({ fill: 'red', shape: 'ring', text: short(view.problem) });
        } else {
            node.status({});
            // The time of the last 204, while the uploads succeed. With values arriving
            // every few seconds the view is nearly always "queued"; the dot stays green
            // then, because the last upload went through, and says when it did.
            let lastSent = null;
            view.register(node, function (event) {
                const mine = Array.isArray(event.sources) && event.sources.includes(node.id);
                switch (event.type) {
                    case 'queued':
                        node.status(lastSent
                            ? { fill: 'green', shape: 'dot', text: RED._('andon-out.status.sentNext', { time: lastSent, sec: event.inSec }) }
                            : { fill: 'blue', shape: 'ring', text: RED._('andon-out.status.queued', { sec: event.inSec }) });
                        break;
                    case 'sent':
                        lastSent = clock();
                        node.status({ fill: 'green', shape: 'dot', text: RED._(event.report.heartbeat ? 'andon-out.status.heartbeat' : 'andon-out.status.sent', { time: lastSent }) });
                        if (mine) { node.send({ topic: 'andon/sent', payload: Object.assign({ ok: true }, event.report) }); }
                        break;
                    case 'throttled':
                        lastSent = null;
                        node.status({ fill: 'yellow', shape: 'ring', text: RED._('andon-out.status.throttled', { time: clock() }) });
                        break;
                    case 'error':
                        lastSent = null;
                        node.status({ fill: 'red', shape: 'ring', text: clock() + ' ' + short(event.message) });
                        // Reported by the nodes whose values were in the upload, so one
                        // failure is one log line per contributing node, not per node.
                        if (mine) {
                            node.error(event.message, { topic: 'andon/error', payload: Object.assign({ ok: false, error: event.message }, event.report || {}) });
                        }
                        break;
                }
            });
        }

        node.on('input', function (msg, send, done) {
            if (!view || view.problem || !view.runtime) {
                done(new Error(view && view.problem ? view.problem : RED._('andon-out.status.noView')));
                return;
            }
            try {
                const { warnings } = view.runtime.receive(msg, node.id);
                for (const w of warnings) {
                    const key = w.path + '|' + w.message;
                    if (warned.has(key) || warned.size >= MAX_REMEMBERED_WARNINGS) { continue; }
                    warned.add(key);
                    node.warn(w.path + ': ' + w.message);
                }
                done();
            } catch (err) {
                if (err instanceof InputError || err instanceof ValidationError) {
                    node.status({ fill: 'red', shape: 'ring', text: short(err.message) });
                }
                done(err);
            }
        });

        node.on('close', function () {
            if (view && view.deregister) { view.deregister(node); }
        });
    }

    RED.nodes.registerType('andon-out', AndonOut);
};
