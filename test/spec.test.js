'use strict';
/**
 * The package against the repository's ground truth: the envelope test vectors,
 * the view test vectors and the copies taken from spec/. Skipped when ../../spec
 * is not there (the published package and the public mirror carry no spec).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { seal, fingerprint, parseKey } = require('../lib/seal');
const { validate } = require('../lib/validate');
const { COPIES } = require('../scripts/sync-spec');

const SPEC = path.join(__dirname, '..', '..', '..', 'spec');
const haveSpec = fs.existsSync(path.join(SPEC, 'testvectors', 'envelope-v1.json'));
const opts = { skip: haveSpec ? false : 'spec/ is not next to this package' };

function readJSON(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('every copy taken from spec/ is current', opts, () => {
    for (const [from, to] of COPIES) {
        const spec = fs.readFileSync(path.join(SPEC, from), 'utf8');
        const copy = fs.readFileSync(path.join(__dirname, '..', to), 'utf8');
        assert.equal(copy, spec, to + ': run npm run sync-spec');
    }
});

test('seal reproduces every envelope test vector byte for byte', opts, () => {
    const vectors = readJSON(path.join(SPEC, 'testvectors', 'envelope-v1.json'));
    assert.ok(vectors.seal.length > 0);
    for (const v of vectors.seal) {
        const plaintext = Buffer.from(v.plaintext_base64, 'base64');
        const out = seal(plaintext, {
            view: v.view,
            kv: v.kv,
            key: parseKey(v.key_base64),
            notify: v.notify,
            nonce: Buffer.from(v.nonce_base64, 'base64'),
        });
        assert.equal(out.text, v.envelope_json, v.name);
        assert.equal(JSON.parse(out.text).ct, v.ct_base64, v.name);
    }
});

function documentsOf(cases) {
    return cases.map((c) => ({
        name: c.name,
        doc: c.document_file ? readJSON(path.join(SPEC, 'testvectors', c.document_file)) : c.document,
    }));
}

test('every valid view vector passes', opts, () => {
    const vectors = readJSON(path.join(SPEC, 'testvectors', 'view-v1.json'));
    for (const { name, doc } of documentsOf(vectors.valid)) {
        assert.deepEqual(validate(doc).errors, [], name);
    }
});

test('every invalid view vector is rejected', opts, () => {
    const vectors = readJSON(path.join(SPEC, 'testvectors', 'view-v1.json'));
    for (const { name, doc } of documentsOf(vectors.invalid)) {
        assert.ok(validate(doc).errors.length > 0, name);
    }
});

test('the fingerprint is the one andon push computes: ID=status, sorted, SHA-256', () => {
    const doc = { tiles: [{ id: 'b', status: 'ok' }, { id: 'a' }] };
    const expected = require('crypto').createHash('sha256').update('a=-\nb=ok', 'utf8').digest('hex');
    assert.equal(fingerprint(doc), expected);
});
