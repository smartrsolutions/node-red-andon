'use strict';
// The runtime of one view, from @smartrsolutions/andon-client: the andon-view
// config node owns one, and every andon out naming the view feeds it. Refusals in
// the words of a Node-RED message.
const core = require('@smartrsolutions/andon-client/runtime');

class ViewRuntime extends core.ViewRuntime {
    constructor(options) {
        super(Object.assign({ words: core.NODE_RED_WORDS }, options));
    }
}

module.exports = { ViewRuntime, ValidationError: core.ValidationError, InputError: core.InputError };
