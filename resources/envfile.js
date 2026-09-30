/**
 * Reads the .env the Andon configurator downloads: KEY=VALUE, # comments, optional
 * `export` and quotes, one view per prefix (<P>VIEW, <P>WRITE_SECRET, <P>CONTENT_KEY,
 * <P>KEY_VERSION, <P>URL, <P>INVITE_SECRET). The same rules as the configurator's
 * useViewSession.ts, so a file it accepts is accepted here.
 *
 * One file for both sides: the runtime requires it, and Node-RED serves it to the
 * editor from resources/, where the config dialog parses the file in the browser.
 *
 * The invite secret is read only to be dropped: a source does not pair devices,
 * so it should not hold the secret that does.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.AndonEnvFile = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var MAX_BYTES = 16384;
    var PREFIX = /^[A-Z][A-Z0-9_]*_$/;
    var VIEW_ID = /^vw_[a-z2-7]{26}$/;
    var KEY = /^[A-Za-z0-9_-]{43}$/;
    var WRITE_SECRET = /^ws_[A-Za-z0-9_-]{43}$/;

    function parse(text) {
        var out = {};
        String(text).split(/\r?\n/).forEach(function (raw) {
            var line = raw.trim();
            if (!line || line.charAt(0) === '#') { return; }
            if (line.indexOf('export ') === 0) { line = line.slice(7).trim(); }
            var eq = line.indexOf('=');
            if (eq <= 0) { return; }
            var name = line.slice(0, eq).trim();
            var value = line.slice(eq + 1).trim();
            var q = value.charAt(0);
            if (value.length >= 2 && (q === '"' || q === "'") && value.charAt(value.length - 1) === q) {
                value = value.slice(1, -1);
            }
            out[name] = value;
        });
        return out;
    }

    /**
     * views returns every view in the file: a prefix counts when <P>VIEW and
     * <P>CONTENT_KEY are both set. A view with a malformed value is reported in
     * problems, never half imported.
     */
    function views(text) {
        if (String(text).length > MAX_BYTES) { return { views: [], problems: ['the file is larger than 16 KiB'] }; }
        var env = parse(text);
        var found = [];
        var problems = [];
        Object.keys(env)
            .filter(function (n) {
                var p = n.slice(0, -4);
                return n.slice(-4) === 'VIEW' && PREFIX.test(p) && env[p + 'CONTENT_KEY'];
            })
            .map(function (n) { return n.slice(0, -4); })
            .sort()
            .forEach(function (p) {
                var v = {
                    prefix: p,
                    url: (env[p + 'URL'] || '').replace(/\/+$/, ''),
                    view: env[p + 'VIEW'] || '',
                    writeSecret: env[p + 'WRITE_SECRET'] || '',
                    contentKey: env[p + 'CONTENT_KEY'] || '',
                    kv: Number(env[p + 'KEY_VERSION'] || '1'),
                };
                var bad = [];
                if (!VIEW_ID.test(v.view)) { bad.push('VIEW'); }
                if (!KEY.test(v.contentKey)) { bad.push('CONTENT_KEY'); }
                if (!WRITE_SECRET.test(v.writeSecret)) { bad.push('WRITE_SECRET'); }
                if (!(v.kv >= 1 && Math.floor(v.kv) === v.kv)) { bad.push('KEY_VERSION'); }
                if (bad.length) {
                    problems.push(bad.map(function (b) { return p + b; }).join(', '));
                } else {
                    found.push(v);
                }
            });
        return { views: found, problems: problems };
    }

    return { parse: parse, views: views };
});
