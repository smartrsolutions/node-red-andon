'use strict';
// The upload, from @smartrsolutions/andon-client. Two of its hints are worded for
// the editor here: the fix for a rejected secret or an unknown view is the view's
// Import .env.
const core = require('@smartrsolutions/andon-client/runtime');

const HINTS = {
    401: 'the relay rejected the write secret (__code__): import the current .env into the view',
    404: 'the relay does not know this view (__code__): check the view ID, or import the current .env',
};

function put(options) {
    return core.put(Object.assign({}, options, { hints: HINTS }));
}

module.exports = {
    DEFAULT_RELAY: core.DEFAULT_RELAY,
    THROTTLE_SEC: core.THROTTLE_SEC,
    relayUrl: core.relayUrl,
    relayAliases: core.relayAliases,
    put,
};
