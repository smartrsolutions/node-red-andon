'use strict';
/**
 * Envelope v1: the one place this package touches the content key.
 *
 * AES-256-GCM, a fresh 12-byte nonce per envelope, AAD "andon-v1|<view>|<kv>", the
 * 16-byte tag appended to the ciphertext, nonce and ct as standard base64 with
 * padding. The format is described at https://andon.app/en/developers.
 */

const crypto = require('crypto');

/** The relay refuses larger envelopes. */
const MAX_ENVELOPE = 262144;

const VIEW_ID = /^vw_[a-z2-7]{26}$/;
const WRITE_SECRET = /^ws_[A-Za-z0-9_-]{43}$/;

/**
 * parseKey accepts base64url and standard base64, with or without padding: the
 * configurator writes base64url, older notes may carry the other spelling.
 */
function parseKey(text) {
    const normalised = String(text || '').trim().replace(/-/g, '+').replace(/_/g, '/');
    const raw = Buffer.from(normalised, 'base64');
    if (raw.length !== 32) {
        throw new Error('content key decodes to ' + raw.length + ' bytes, expected 32');
    }
    return raw;
}

function parseKeyVersion(value) {
    const kv = Number(value);
    if (!Number.isInteger(kv) || kv < 1) {
        throw new Error('key version must be an integer >= 1, got ' + value);
    }
    return kv;
}

/**
 * fingerprint is the status fingerprint of a document: tile ID and status of
 * every tile, sorted, SHA-256. Only a change of it wakes devices under notify=auto,
 * because a wake-up costs battery on every paired device.
 */
function fingerprint(doc) {
    const parts = doc.tiles
        .map((tile) => tile.id + '=' + (tile.status === undefined || tile.status === null ? '-' : tile.status))
        .sort();
    return crypto.createHash('sha256').update(parts.join('\n'), 'utf8').digest('hex');
}

/**
 * seal turns a view document into the envelope JSON text. The text is assembled
 * here rather than by whoever sends it, because the field order v, view, kv, nonce,
 * ct, notify is part of the format. `nonce` is for test vectors only.
 */
function seal(doc, { view, kv, key, notify, nonce }) {
    const plaintext = Buffer.isBuffer(doc) ? doc : Buffer.from(JSON.stringify(doc), 'utf8');
    const iv = nonce || crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    cipher.setAAD(Buffer.from('andon-v1|' + view + '|' + kv, 'utf8'));
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
    const text = JSON.stringify({
        v: 1,
        view: view,
        kv: kv,
        nonce: iv.toString('base64'),
        ct: ct.toString('base64'),
        notify: !!notify,
    });
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > MAX_ENVELOPE) {
        throw new Error('the sealed document is ' + Math.ceil(bytes / 1024) + ' KiB, the relay takes at most ' +
            MAX_ENVELOPE / 1024 + ' KiB: fewer tiles, shorter series or a smaller window');
    }
    return { text, bytes, documentBytes: plaintext.length };
}

module.exports = { MAX_ENVELOPE, VIEW_ID, WRITE_SECRET, parseKey, parseKeyVersion, fingerprint, seal };
