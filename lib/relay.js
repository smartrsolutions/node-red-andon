'use strict';
/**
 * The one request this package makes: PUT /v1/views/{id}/envelope.
 *
 * The write secret travels in the Authorization header and nowhere else; it is
 * never part of a URL, a result or an error text. The relay is fixed: users talk
 * to relay.andon.app, and ANDON_RELAY_URL exists for development against a local
 * relay only. It is deliberately not a field in the editor.
 */

const DEFAULT_RELAY = 'https://relay.andon.app';
const TIMEOUT_MS = 15000;

/** The relay accepts at most one upload per view per ten seconds (429 otherwise). */
const THROTTLE_SEC = 10;

function relayUrl(env) {
    const value = String((env || process.env).ANDON_RELAY_URL || '').trim().replace(/\/+$/, '');
    return value || DEFAULT_RELAY;
}

/**
 * relayAliases are the other addresses under which a .env may name this same
 * relay; the import dialog refuses any other. Development only: in a container
 * Node-RED reaches a local relay as host.docker.internal:8080, while the .env
 * names it as 127.0.0.1:8080 or by the machine's LAN address.
 * ANDON_RELAY_ALIASES is a comma-separated list, empty by default.
 */
function relayAliases(env) {
    return String((env || process.env).ANDON_RELAY_ALIASES || '')
        .split(',')
        .map((s) => s.trim().replace(/\/+$/, ''))
        .filter(Boolean);
}

function errorCode(text) {
    if (!text || text[0] !== '{') { return ''; }
    try {
        const parsed = JSON.parse(text);
        return typeof parsed.error === 'string' ? parsed.error : '';
    } catch (e) {
        return '';
    }
}

/** hint says what to change, per the relay's answers. */
function hint(status, code) {
    switch (status) {
        case 401: return 'the relay rejected the write secret (' + code + '): import the current .env into the view';
        case 404: return 'the relay does not know this view (' + code + '): check the view ID, or import the current .env';
        case 413: return 'the envelope is larger than 256 KiB (' + code + '): fewer tiles or shorter series';
        case 400: return 'the relay refused the envelope (' + code + ')';
        case 429: return 'throttled (' + code + '): the next upload carries the latest state';
        default: return 'upload failed with HTTP ' + status + (code ? ' (' + code + ')' : '');
    }
}

/**
 * put uploads one envelope and classifies the answer. It never throws: a
 * connection error is a result too, with status 0, so the caller has one path.
 *
 *   ok        204, stored
 *   throttled 429, try again after retryAfterSec
 *   retry     network error or 5xx, worth trying again later
 *   fatal     401, 404, 400, 413: trying again changes nothing until a person does
 */
async function put({ base, view, writeSecret, envelope, fetchImpl }) {
    const doFetch = fetchImpl || fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await doFetch(base + '/v1/views/' + encodeURIComponent(view) + '/envelope', {
            method: 'PUT',
            headers: { 'content-type': 'application/json', authorization: 'Bearer ' + writeSecret },
            body: envelope,
            signal: controller.signal,
        });
        const text = res.status === 204 ? '' : (await res.text().catch(() => '')).slice(0, 300);
        const code = errorCode(text);
        const retryAfter = Number(res.headers && res.headers.get ? res.headers.get('retry-after') : NaN);
        if (res.status === 204) { return { outcome: 'ok', status: 204 }; }
        if (res.status === 429) {
            return { outcome: 'throttled', status: 429, code, message: hint(429, code || 'throttled'), retryAfterSec: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : THROTTLE_SEC };
        }
        if (res.status >= 500) { return { outcome: 'retry', status: res.status, code, message: hint(res.status, code) }; }
        return { outcome: 'fatal', status: res.status, code, message: hint(res.status, code) };
    } catch (err) {
        const message = err && err.name === 'AbortError' ? 'the relay did not answer within ' + TIMEOUT_MS / 1000 + ' s'
            : 'the relay could not be reached: ' + (err && err.cause && err.cause.code ? err.cause.code : err && err.message ? err.message : String(err));
        return { outcome: 'retry', status: 0, code: 'network', message };
    } finally {
        clearTimeout(timer);
    }
}

module.exports = { DEFAULT_RELAY, THROTTLE_SEC, relayUrl, relayAliases, put };
