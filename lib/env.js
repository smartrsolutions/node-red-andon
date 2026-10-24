'use strict';
// The view's values from the environment (From the environment in the view's
// dialog): @smartrsolutions/andon-client reads the same names.
const { env } = require('@smartrsolutions/andon-client/runtime');

module.exports = { PREFIX: env.PREFIX, SUFFIXES: env.SUFFIXES, name: env.name, pick: env.pick, checkPrefix: env.checkPrefix };
