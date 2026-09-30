'use strict';
/**
 * Checks a view document before it is sealed: the schema (schema/view-v1.schema.json)
 * plus the rules the schema cannot express. The rules are those of the Andon
 * configurator, so a document the configurator rejects is rejected here, and the
 * other way round - except for the size limit, which is stricter here (see
 * semanticIssues).
 *
 * The configurator precompiles its validator because a CSP forbids new Function();
 * a Node-RED runtime has no CSP, so this one compiles at load time and needs no
 * build step.
 */

const Ajv2020 = require('ajv/dist/2020').default;
const addFormats = require('ajv-formats').default;
const schema = require('../schema/view-v1.schema.json');
const { MAX_ENVELOPE } = require('./seal');

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateSchema = ajv.compile(schema);

function describe(e) {
    switch (e.keyword) {
        case 'additionalProperties': return 'unknown field ' + JSON.stringify(e.params.additionalProperty);
        case 'required': return 'missing required field ' + e.params.missingProperty;
        case 'false schema': return 'field is not allowed for this tile kind';
        case 'enum': return 'must be one of ' + e.params.allowedValues.join(', ');
        case 'const': return 'must be exactly ' + JSON.stringify(e.params.allowedValue);
        case 'format': return 'invalid ' + e.params.format;
        case 'pattern': return e.params.pattern === 'Z$' ? 'timestamp must end in Z (UTC), no offset' : 'does not match ' + e.params.pattern;
        default: return e.message || e.keyword;
    }
}

function schemaErrors(doc) {
    if (validateSchema(doc)) { return []; }
    const seen = new Set();
    const out = [];
    for (const e of validateSchema.errors || []) {
        // Ajv reports every branch of the if/then tree; the leaves are the useful part.
        if (e.keyword === 'if' || e.keyword === 'allOf' || e.keyword === 'oneOf' || e.keyword === 'anyOf') { continue; }
        const issue = { level: 'error', path: e.instancePath || '/', message: describe(e) };
        const key = issue.path + '|' + issue.message;
        if (!seen.has(key)) { seen.add(key); out.push(issue); }
    }
    return out;
}

/**
 * semanticIssues follows the configurator's validator rule for rule and in the
 * same order. Three deliberate differences:
 *
 *   - size: an error from 72 % of 256 KiB of plaintext, not 95 %. Sealing adds a
 *     third (base64), so from about 192 KiB the envelope no longer fits and the
 *     relay refuses it; 95 % is too late for a document that is about to be sealed.
 *   - generatedAt in the future or older than staleAfterSec: not checked. The
 *     package sets generatedAt itself, just before sealing.
 *   - "fewer than 3 points": not checked. The first real value replaces the
 *     template's points (lib/tiles.js), so a fresh series starts at one point on
 *     every deploy; warning about that would be noise, not advice.
 */
function semanticIssues(doc) {
    const out = [];
    const tiles = Array.isArray(doc.tiles) ? doc.tiles : [];
    const error = (path, message) => out.push({ level: 'error', path, message });
    const warning = (path, message) => out.push({ level: 'warning', path, message });

    const bytes = Buffer.byteLength(JSON.stringify(doc), 'utf8');
    if (bytes > MAX_ENVELOPE * 0.72) {
        error('/', 'the document is ' + Math.round(bytes / 1024) + ' KiB; sealed it would pass the 256 KiB limit');
    } else if (bytes > 64 * 1024) {
        warning('/', 'the document is ' + Math.round(bytes / 1024) + ' KiB; fewer points per series save radio and battery');
    }
    if (typeof doc.staleAfterSec === 'number' && doc.staleAfterSec < 30) {
        warning('/staleAfterSec', 'very small; rule of thumb: two to three times the upload interval');
    }

    const ids = new Map();
    tiles.forEach((tile, i) => {
        const p = '/tiles/' + i;
        if (tile && typeof tile.id === 'string') {
            if (ids.has(tile.id)) { error(p + '/id', 'duplicate tile id "' + tile.id + '" (also at /tiles/' + ids.get(tile.id) + ')'); } else { ids.set(tile.id, i); }
        }
        if (!tile || typeof tile !== 'object') { return; }
        if (typeof tile.titleShort === 'string' && tile.titleShort.length > 12) { error(p + '/titleShort', 'longer than 12 characters'); }
        if (typeof tile.title === 'string' && tile.title.length > 12 && !tile.titleShort) { warning(p + '/titleShort', 'missing: the title is cut in small widgets'); }

        const r = tile.range;
        const hasRange = r && typeof r.min === 'number' && typeof r.max === 'number';
        if (hasRange && r.max <= r.min) { error(p + '/range', 'max must be greater than min'); }
        if (hasRange && typeof tile.value === 'number' && (tile.value < r.min || tile.value > r.max)) { warning(p + '/value', 'lies outside range'); }
        if (hasRange && typeof tile.target === 'number' && (tile.target < r.min || tile.target > r.max)) { warning(p + '/target', 'lies outside range'); }
        if (Array.isArray(tile.bands) && tile.bands.length) {
            let prev = hasRange ? r.min : -Infinity;
            tile.bands.forEach((b, bi) => {
                if (b && typeof b.to === 'number' && b.to < prev) { error(p + '/bands/' + bi + '/to', 'bands must be ascending'); }
                if (b && typeof b.to === 'number') { prev = b.to; }
            });
            if (hasRange && prev < r.max) { warning(p + '/bands', 'last band ends before range.max; the rest of the scale stays uncoloured'); }
            if (tile.status && hasRange && typeof tile.value === 'number') {
                let from = r.min;
                for (const b of tile.bands) {
                    if (tile.value >= from && tile.value <= b.to) {
                        if (b.status !== tile.status) { warning(p + '/status', '"' + tile.status + '", but the value sits in the "' + b.status + '" band'); }
                        break;
                    }
                    from = b.to;
                }
            }
        }

        if (Array.isArray(tile.categories)) {
            if ((tile.view === 'pie' || tile.view === 'donut') && tile.categories.length > 8) { warning(p + '/categories', 'more than 8 categories: the palette starts over'); }
            if (Array.isArray(tile.series)) {
                tile.series.forEach((s, si) => {
                    if (s && Array.isArray(s.values) && s.values.length !== tile.categories.length) {
                        error(p + '/series/' + si + '/values', s.values.length + ' values but ' + tile.categories.length + ' categories');
                    }
                    if (s && Array.isArray(s.statuses) && Array.isArray(s.values)) {
                        if (s.statuses.length !== s.values.length) {
                            warning(p + '/series/' + si + '/statuses', s.statuses.length + ' statuses but ' + s.values.length + ' values; the app reads missing ones as null and ignores surplus ones');
                        }
                        if (s.statuses.length > 1 && s.statuses.every((x) => x === 'ok')) {
                            warning(p + '/series/' + si + '/statuses', 'every bar ok: traffic lights only for bars that carry a verdict, the rest stays null');
                        }
                    }
                });
            }
        }
        if (tile.view === 'line' && Array.isArray(tile.series)) {
            tile.series.forEach((s, si) => {
                const n = s && Array.isArray(s.samples) ? s.samples.length : s && Array.isArray(s.points) ? s.points.length : 0;
                if (n > 500) { warning(p + '/series/' + si, n + ' points; 30 to 60 are enough for one screen'); }
                if (s && Array.isArray(s.samples)) {
                    let last = -Infinity;
                    for (let k = 0; k < s.samples.length; k++) {
                        const ts = Date.parse(s.samples[k] && s.samples[k][0]);
                        if (Number.isFinite(ts) && ts < last) { warning(p + '/series/' + si + '/samples/' + k, 'timestamps not ascending'); break; }
                        if (Number.isFinite(ts)) { last = ts; }
                    }
                }
            });
        }

        if (tile.view === 'table' && Array.isArray(tile.columns) && Array.isArray(tile.rows)) {
            tile.rows.forEach((row, ri) => {
                if (row && Array.isArray(row.cells) && row.cells.length !== tile.columns.length) {
                    warning(p + '/rows/' + ri + '/cells', row.cells.length + ' cells but ' + tile.columns.length + ' columns');
                }
            });
            if (tile.rows.length > 10) { warning(p + '/rows', tile.rows.length + ' rows; in a widget ten is a lot'); }
        }

        if (tile.view === 'timeline') {
            const from = Date.parse(tile.from);
            const to = Date.parse(tile.to);
            if (Number.isFinite(from) && Number.isFinite(to) && to <= from) { error(p + '/to', 'to must be after from'); }
            const stateIds = new Set((Array.isArray(tile.states) ? tile.states : []).map((s) => s && s.id));
            (Array.isArray(tile.lanes) ? tile.lanes : []).forEach((l, li) => {
                let last = -Infinity;
                (l && Array.isArray(l.segments) ? l.segments : []).forEach((seg, si) => {
                    const at = p + '/lanes/' + li + '/segments/' + si;
                    if (!stateIds.has(seg && seg[1])) { error(at, 'unknown state "' + (seg && seg[1]) + '"'); }
                    const ts = Date.parse(seg && seg[0]);
                    if (Number.isFinite(ts) && ts < last) { error(at, 'segments must be ascending'); }
                    if (Number.isFinite(ts)) { last = ts; }
                    if (Number.isFinite(ts) && Number.isFinite(from) && ts < from) { warning(at, 'starts before from'); }
                });
            });
        }

        if (typeof tile.subtext === 'string' && /\b(vor \d|ago)\b/i.test(tile.subtext)) {
            warning(p + '/subtext', 'time of day rather than duration: "3 minutes ago" is already wrong when read');
        }
    });
    return out;
}

/**
 * validate returns the errors (the document must not be sent) and the warnings
 * (it may be sent, but something looks off). Semantic checks run only on a
 * document that passed the schema: on a broken one they would mostly repeat it.
 */
function validate(doc) {
    const schemaIssues = schemaErrors(doc);
    const issues = schemaIssues.length ? schemaIssues : semanticIssues(doc);
    return {
        errors: issues.filter((i) => i.level === 'error'),
        warnings: issues.filter((i) => i.level === 'warning'),
    };
}

/** tileOf names the tile an issue path points into, for messages a person reads. */
function tileOf(doc, path) {
    const m = /^\/tiles\/(\d+)/.exec(path || '');
    const tile = m && doc && Array.isArray(doc.tiles) ? doc.tiles[Number(m[1])] : null;
    return tile && typeof tile.id === 'string' ? tile.id : null;
}

function summary(doc, issues) {
    return issues.slice(0, 3).map((i) => {
        const id = tileOf(doc, i.path);
        const rest = id ? i.path.replace(/^\/tiles\/\d+/, '') : i.path;
        return (id ? 'tile "' + id + '"' : 'document') + (rest && rest !== '/' ? ' ' + rest : '') + ': ' + i.message;
    }).join('; ') + (issues.length > 3 ? ' (+' + (issues.length - 3) + ' more)' : '');
}

module.exports = { validate, summary, tileOf };
