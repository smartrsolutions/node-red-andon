'use strict';
/**
 * The runtime of one view: holds the document, takes values, decides when to
 * upload, and uploads. The andon-view config node owns one of these; every
 * andon out node that points at the view feeds the same one, so two nodes never
 * race each other for the relay.
 *
 * When an upload happens:
 *
 *   - a change is sent at most every intervalSec (never below the relay's 10 s);
 *     the first change after a quiet spell goes out at once;
 *   - without a change, a heartbeat goes out every staleAfterSec / 2, but only
 *     when values kept arriving since the last upload. A source whose sensors went
 *     quiet must turn stale in the app, so the package never vouches for values it
 *     has not seen again;
 *   - 429 waits for Retry-After, a network error or 5xx backs off, and 401, 404,
 *     400 or 413 stop until the next message: repeating them changes nothing.
 *
 * Clock, timers and the upload are injected, so the tests run without waiting and
 * without a relay.
 */

const { apply, finish, InputError } = require('./tiles');
const { validate, summary } = require('./validate');
const { seal, fingerprint } = require('./seal');
const { THROTTLE_SEC } = require('./relay');

const MAX_BACKOFF_SEC = 300;

class ValidationError extends Error {}

class ViewRuntime {
    /**
     * options: view, kv, key (32-byte Buffer), writeSecret, notify ('auto' |
     * 'always' | 'never'), intervalSec, staleAfterSec, window, derive (Set of tile
     * IDs), template (a view document or null), put (async upload), onEvent,
     * clock ({ now, setTimeout, clearTimeout }), restored ({ doc, fingerprint }).
     */
    constructor(options) {
        this.o = options;
        this.clock = options.clock || { now: Date.now, setTimeout, clearTimeout };
        this.intervalSec = Math.max(THROTTLE_SEC, Number(options.intervalSec) || 30);
        this.staleAfterSec = Number(options.staleAfterSec) > 0 ? Number(options.staleAfterSec) : this.intervalSec * 3;
        this.doc = options.restored && options.restored.doc ? options.restored.doc : options.template || null;
        this.lastFingerprint = options.restored ? options.restored.fingerprint : undefined;
        // Series and lanes that already hold real data (lib/tiles.js, fromTemplate).
        // null: the whole document came from the source, nothing is template.
        this.live = options.restored && Array.isArray(options.restored.live) ? new Set(options.restored.live)
            : options.restored && options.restored.live === null ? null : new Set();
        this.dirty = false;      // the document changed since the last upload
        this.seen = false;       // a value arrived since the last upload, changed or not
        this.blocked = null;     // a fatal answer: wait for the next message
        this.lastUpload = null;  // ms of the last 204
        this.notBefore = 0;      // Retry-After or backoff
        this.failures = 0;
        this.sources = new Set();
        this.timer = null;
        this.inFlight = null;
        this.closed = false;
    }

    emit(event) {
        if (this.o.onEvent) { this.o.onEvent(event); }
    }

    /**
     * receive applies one message. It throws InputError or ValidationError and then
     * leaves the document exactly as it was, so one bad value never blocks the
     * others. Returns the warnings of the new document and the changed tile IDs.
     */
    receive(msg, sourceId) {
        const now = this.clock.now();
        const result = apply(this.doc, msg, { now, window: this.o.window, derive: this.o.derive, live: this.live || undefined });
        let warnings = [];
        if (result.changed.length) {
            const check = validate(finish(result.doc, { now, staleAfterSec: this.staleAfterSec }));
            if (check.errors.length) { throw new ValidationError(summary(result.doc, check.errors)); }
            warnings = check.warnings;
            this.doc = result.doc;
            this.dirty = true;
            if (result.replaced) { this.live = null; } else if (this.live) { result.touched.forEach((k) => this.live.add(k)); }
        }
        this.seen = true;
        this.blocked = null;
        if (sourceId !== undefined) { this.sources.add(sourceId); }
        this.schedule();
        return { changed: result.changed, warnings };
    }

    /** due is when the next upload may happen, or null when none is needed. */
    due() {
        if (!this.doc || this.blocked || this.closed) { return null; }
        let at;
        if (this.dirty) {
            at = this.lastUpload === null ? 0 : this.lastUpload + this.intervalSec * 1000;
        } else if (this.seen && this.lastUpload !== null) {
            at = this.lastUpload + Math.max(this.intervalSec, this.staleAfterSec / 2) * 1000;
        } else {
            return null;
        }
        return Math.max(at, this.notBefore);
    }

    schedule() {
        if (this.inFlight || this.closed) { return; }
        if (this.timer) { this.clock.clearTimeout(this.timer); this.timer = null; }
        const at = this.due();
        if (at === null) { return; }
        const wait = Math.max(0, at - this.clock.now());
        if (wait > 0) { this.emit({ type: 'queued', inSec: Math.ceil(wait / 1000) }); }
        this.timer = this.clock.setTimeout(() => {
            this.timer = null;
            this.flush();
        }, wait);
    }

    /** flush builds, seals and uploads the current document once. */
    async flush() {
        if (this.inFlight || this.closed || !this.doc) { return this.inFlight; }
        const now = this.clock.now();
        const sources = Array.from(this.sources);
        const doc = finish(this.doc, { now, staleAfterSec: this.staleAfterSec });
        const wasDirty = this.dirty;
        this.dirty = false;
        this.seen = false;
        this.sources.clear();

        const fp = fingerprint(doc);
        const notify = this.o.notify === 'always' ? true : this.o.notify === 'never' ? false : fp !== this.lastFingerprint;
        let sealed;
        try {
            sealed = seal(doc, { view: this.o.view, kv: this.o.kv, key: this.o.key, notify });
        } catch (err) {
            this.blocked = 'too_large';
            this.dirty = wasDirty;
            this.emit({ type: 'error', message: err.message, sources });
            return;
        }

        this.inFlight = (async () => {
            const res = await this.o.put(sealed.text);
            this.inFlight = null;
            if (this.closed) { return res; }
            const report = {
                view: this.o.view, kv: this.o.kv, notify, status: res.status,
                tiles: doc.tiles.length, documentBytes: sealed.documentBytes, envelopeBytes: sealed.bytes,
                generatedAt: doc.generatedAt, heartbeat: !wasDirty,
            };
            if (res.outcome === 'ok') {
                this.lastUpload = now;
                // Stored only after a 204: a status change whose
                // upload failed must still wake the devices on the next try.
                this.lastFingerprint = fp;
                this.failures = 0;
                this.notBefore = 0;
                this.emit({ type: 'sent', report, sources, doc: this.doc, fingerprint: fp, live: this.live ? Array.from(this.live) : null });
            } else {
                this.dirty = this.dirty || wasDirty;
                this.seen = this.seen || !wasDirty;
                sources.forEach((s) => this.sources.add(s));
                if (res.outcome === 'throttled') {
                    this.notBefore = this.clock.now() + res.retryAfterSec * 1000;
                    this.emit({ type: 'throttled', message: res.message, report, sources });
                } else if (res.outcome === 'retry') {
                    this.failures += 1;
                    const backoff = Math.min(MAX_BACKOFF_SEC, this.intervalSec * Math.pow(2, this.failures - 1));
                    this.notBefore = this.clock.now() + backoff * 1000;
                    this.emit({ type: 'error', message: res.message, retryInSec: backoff, report, sources });
                } else {
                    this.blocked = res.code || String(res.status);
                    this.emit({ type: 'error', message: res.message, report, sources });
                }
            }
            this.schedule();
            return res;
        })();
        return this.inFlight;
    }

    close() {
        this.closed = true;
        if (this.timer) { this.clock.clearTimeout(this.timer); this.timer = null; }
    }
}

module.exports = { ViewRuntime, ValidationError, InputError };
