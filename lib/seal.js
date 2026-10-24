'use strict';
// Envelope v1: @smartrsolutions/andon-client does the sealing.
const core = require('@smartrsolutions/andon-client/runtime');

module.exports = {
    MAX_ENVELOPE: core.MAX_ENVELOPE,
    VIEW_ID: core.VIEW_ID,
    WRITE_SECRET: core.WRITE_SECRET,
    parseKey: core.parseKey,
    parseKeyVersion: core.parseKeyVersion,
    fingerprint: core.fingerprint,
    seal: core.seal,
};
