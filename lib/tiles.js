'use strict';
// What a message does to the view document, from @smartrsolutions/andon-client,
// in the words of a Node-RED message: a refusal names msg.topic, msg.payload,
// msg.timestamp, msg.series and msg.lane.
const core = require('@smartrsolutions/andon-client/runtime');

function apply(doc, msg, options) {
    return core.apply(doc, msg, Object.assign({}, options, { words: core.NODE_RED_WORDS }));
}

module.exports = {
    InputError: core.InputError,
    apply,
    finish: core.finish,
    iso: core.iso,
    statusFromBands: core.statusFromBands,
    DEFAULT_WINDOW: core.DEFAULT_WINDOW,
    MAX_SEGMENTS: core.MAX_SEGMENTS,
};
