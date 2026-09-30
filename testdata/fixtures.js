'use strict';
// The template the tests start from: the spec's sample document, the same 14
// tiles in all nine kinds that the factory simulator sends. A copy of
// spec/view-v1.sample.json (npm run sync-spec), so the tests also run where the
// spec is not next to the package.
const fs = require('fs');
const path = require('path');

const SAMPLE = path.join(__dirname, 'view-v1.sample.json');
const text = fs.readFileSync(SAMPLE, 'utf8');

function template() {
    return JSON.parse(text);
}

module.exports = { template, SAMPLE };
