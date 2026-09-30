#!/usr/bin/env node
'use strict';
/**
 * Copies what this package needs from spec/: the schema into schema/, which the
 * published package validates with, and the sample document into testdata/, which
 * the tests start from. Neither the published package nor the public mirror can
 * reach ../../spec, so they carry copies; test/spec.test.js fails when a copy falls
 * behind, as long as the repository is there to compare with.
 *
 *   npm run sync-spec
 */

const fs = require('fs');
const path = require('path');

const spec = path.join(__dirname, '..', '..', '..', 'spec');
const pkg = path.join(__dirname, '..');

/** COPIES lists every file taken from spec/, as [file in spec/, path in the package]. */
const COPIES = [
    ['view-v1.schema.json', 'schema/view-v1.schema.json'],
    ['view-v1.sample.json', 'testdata/view-v1.sample.json'],
];

module.exports = { COPIES };

if (require.main === module) {
    for (const [from, to] of COPIES) {
        fs.copyFileSync(path.join(spec, from), path.join(pkg, to));
        console.log(to + ' <- spec/' + from);
    }
}
