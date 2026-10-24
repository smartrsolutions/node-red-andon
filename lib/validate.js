'use strict';
// The view schema plus the configurator's rules, from @smartrsolutions/andon-client.
const core = require('@smartrsolutions/andon-client/runtime');

module.exports = { validate: core.validate, summary: core.summary, tileOf: core.tileOf };
