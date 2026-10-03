/**
 * What a tile takes as a message, read off the tile itself: its kind, whether it
 * has categories, how many series or lanes it has, and which form its first series
 * uses - a series in the step form (start, stepSec, points) takes no single number,
 * because there is no timestamp to append it at.
 *
 * One file for both sides: lib/tiles.js appends hint() to a value it refuses, and
 * Node-RED serves it to the editor from resources/, where the andon out dialog
 * lists the forms of every tile and writes the example function node from them.
 * The rules themselves live in lib/tiles.js; a test there sends every form this
 * file offers and expects it to be taken.
 *
 * forms(tile, now) returns every form the tile takes, the most common first:
 *   key      names the wording: TEXT[key] here, andon-out.accepts.<key> in the editor
 *   params   what the wording needs (count, states)
 *   example  a payload to show
 *   code     the same payload as a JavaScript expression, for the function node
 *   msg      further message properties the form needs: { name: { example, code } }
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.AndonAccepts = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var TEXT = {
        text: { payload: 'a text or a number', effect: 'replaces the value' },
        number: { payload: 'a number', effect: 'replaces the value' },
        append: { payload: 'a number', effect: 'is appended to the series, at the time it arrives' },
        appendAt: { payload: 'a number with msg.timestamp', effect: 'is appended at that time, in milliseconds or ISO 8601' },
        appendTo: { payload: 'a number with msg.series', effect: 'is appended to the series of that name' },
        pairs: { payload: 'an array of [timestamp, value] pairs', effect: 'replaces the series; msg.series picks which' },
        samples: { payload: 'an object {series: [{name, samples}]}', effect: 'replaces every series' },
        steps: { payload: 'an object {series: [{name, start, stepSec, points}]}', effect: 'replaces every series: a point every stepSec from start, in UTC' },
        values: { payload: 'an array of numbers, one per category', effect: 'replaces the values; categories: __count__' },
        valuesTo: { payload: 'an array of numbers with msg.series', effect: 'replaces the values of the series of that name' },
        categories: { payload: 'an object {categories, series}', effect: 'replaces the categories and their values together' },
        statuses: { payload: 'an object {series: [{name, values, statuses}]}', effect: 'a verdict per bar: ok, warning, critical or null' },
        rows: { payload: 'an array of rows, each an array of cells', effect: 'replaces the rows; columns: __count__' },
        rowStatus: { payload: 'an array of {cells, status}', effect: 'replaces the rows, with a status per row' },
        state: { payload: 'a state ID (__states__)', effect: 'starts a new segment, at the time it arrives' },
        stateAt: { payload: 'a state ID with msg.timestamp', effect: 'starts the segment at that time' },
        stateLane: { payload: 'a state ID with msg.lane', effect: 'starts a segment in the lane of that name' },
        window: { payload: 'an object {from, to}', effect: 'moves the time axis; what lies before from is trimmed' },
        fields: { payload: 'an object of fields, e.g. {"status": "warning"}', effect: 'sets them; null removes one' },
    };

    // The forms an error message names: what a value alone can be. Objects and
    // forms that need a further message property are in the dialog and the example.
    var IN_HINT = { text: 1, number: 1, append: 1, pairs: 1, values: 1, rows: 1, state: 1 };

    var MINUTE = 60 * 1000;
    var HOUR = 60 * MINUTE;

    function iso(ms) {
        return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
    }

    function json(value) {
        return JSON.stringify(value);
    }

    // A timestamp `back` milliseconds before now, as code that stays current.
    function agoCode(back) {
        return back ? 'new Date(Date.now() - ' + back + ').toISOString()' : 'new Date().toISOString()';
    }

    function form(key, example, code, params, msg) {
        return { key: key, params: params || {}, example: example, code: code === undefined ? json(example) : code, msg: msg || {} };
    }

    function numberOf(tile, fallback) {
        return typeof tile.value === 'number' ? tile.value : fallback;
    }

    function seriesOf(tile) {
        return Array.isArray(tile.series) ? tile.series.filter(function (s) { return s && typeof s.name === 'string'; }) : [];
    }

    // The last few values a series holds, whatever its form: what the examples are made of.
    function valuesOf(series, fallback) {
        var v = Array.isArray(series.samples) ? series.samples.map(function (p) { return p && p[1]; })
            : Array.isArray(series.points) ? series.points : [];
        v = v.filter(function (x) { return typeof x === 'number'; }).slice(-4);
        return v.length ? v : [fallback, fallback + 1, fallback - 1];
    }

    // [timestamp, value] pairs one minute apart, the last one now: as data and as code.
    function pairsOf(values, now) {
        var n = values.length - 1;
        return {
            example: values.map(function (v, i) { return [iso(now - (n - i) * MINUTE), v]; }),
            code: '[' + values.map(function (v, i) { return '[' + agoCode((n - i) * MINUTE) + ', ' + json(v) + ']'; }).join(', ') + ']',
        };
    }

    function timeSeriesForms(tile, now) {
        var all = seriesOf(tile);
        if (!all.length) { return []; }
        var vals = all.map(function (s) { return valuesOf(s, numberOf(tile, 42)); });
        var last = vals[0][vals[0].length - 1];
        var out = [];

        if (!Array.isArray(all[0].points)) {
            out.push(form('append', last));
            out.push(form('appendAt', last, undefined, {}, { timestamp: { example: iso(now), code: 'Date.now()' } }));
            if (all.length > 1) {
                out.push(form('appendTo', vals[1][vals[1].length - 1], undefined, {}, { series: { example: all[1].name, code: json(all[1].name) } }));
            }
        }

        var first = pairsOf(vals[0], now);
        out.push(form('pairs', first.example, first.code));

        var each = all.map(function (s, k) { return pairsOf(vals[k], now); });
        out.push(form('samples',
            { series: all.map(function (s, k) { return { name: s.name, samples: each[k].example }; }) },
            '{ series: [' + all.map(function (s, k) { return '{ name: ' + json(s.name) + ', samples: ' + each[k].code + ' }'; }).join(', ') + '] }'));

        // The step form with its last point at now, in the code too.
        var steps = all.map(function (s, k) {
            var step = s.stepSec > 0 ? s.stepSec : 3600;
            return { name: s.name, stepSec: step, points: vals[k], back: (vals[k].length - 1) * step * 1000 };
        });
        out.push(form('steps',
            { series: steps.map(function (s) { return { name: s.name, start: iso(now - s.back), stepSec: s.stepSec, points: s.points }; }) },
            '{ series: [' + steps.map(function (s) {
                return '{ name: ' + json(s.name) + ', start: ' + agoCode(s.back) + ', stepSec: ' + s.stepSec + ', points: ' + json(s.points) + ' }';
            }).join(', ') + '] }'));
        return out;
    }

    function categoryForms(tile, kind) {
        var count = tile.categories.length;
        var all = seriesOf(tile);
        var valuesFor = function (s) {
            return s && Array.isArray(s.values) && s.values.length === count ? s.values : tile.categories.map(function (_, i) { return i + 1; });
        };
        var out = [form('values', valuesFor(all[0]), undefined, { count: count })];
        if (all.length > 1) {
            out.push(form('valuesTo', valuesFor(all[1]), undefined, {}, { series: { example: all[1].name, code: json(all[1].name) } }));
        }
        out.push(form('categories', {
            categories: tile.categories,
            series: (all.length ? all : [{ name: 'A' }]).map(function (s) { return { name: s.name, values: valuesFor(s) }; }),
        }));
        // A verdict per bar exists only on a bar with categories and exactly one series.
        if (kind === 'bar' && all.length <= 1) {
            var v = valuesFor(all[0]);
            out.push(form('statuses', { series: [{ name: all.length ? all[0].name : 'A', values: v,
                statuses: v.map(function (_, i) { return i === v.length - 1 ? 'critical' : null; }) }] }));
        }
        return out;
    }

    function tableForms(tile) {
        var columns = Array.isArray(tile.columns) && tile.columns.length ? tile.columns.length : 1;
        var first = Array.isArray(tile.rows) && tile.rows[0] ? tile.rows[0].cells : null;
        var row = Array.isArray(first) && first.length === columns
            ? first
            : Array.from({ length: columns }, function (_, i) { return i === 0 ? 'A' : i; });
        return [form('rows', [row], undefined, { count: columns }), form('rowStatus', [{ cells: row, status: 'warning' }])];
    }

    function timelineForms(tile, now) {
        var states = (Array.isArray(tile.states) ? tile.states : []).map(function (s) { return s && s.id; }).filter(Boolean);
        if (!states.length) { return []; }
        var lanes = (Array.isArray(tile.lanes) ? tile.lanes : []).filter(function (l) { return l && typeof l.name === 'string'; });
        var out = [
            form('state', states[0], undefined, { states: states.join(', ') }),
            form('stateAt', states[0], undefined, {}, { timestamp: { example: iso(now), code: 'Date.now()' } }),
        ];
        if (lanes.length > 1) {
            out.push(form('stateLane', states[0], undefined, {}, { lane: { example: lanes[1].name, code: json(lanes[1].name) } }));
        }
        out.push(form('window', { from: iso(now - 8 * HOUR), to: iso(now) }, '{ from: ' + agoCode(8 * HOUR) + ', to: ' + agoCode(0) + ' }'));
        return out;
    }

    function forms(tile, now) {
        if (!tile || typeof tile !== 'object') { return []; }
        now = typeof now === 'number' ? now : Date.now();
        var categories = Array.isArray(tile.categories);
        var out;
        switch (tile.view) {
            case 'label':
                out = [form('text', typeof tile.value === 'number' || typeof tile.value === 'string' ? tile.value : 'Running')];
                break;
            case 'gauge':
            case 'progress':
                out = [form('number', numberOf(tile, 0))];
                break;
            case 'donut':
                out = [form('number', numberOf(tile, 0))].concat(categories ? categoryForms(tile, 'donut') : []);
                break;
            case 'pie':
                out = categories ? categoryForms(tile, 'pie') : [];
                break;
            case 'bar':
                out = categories ? categoryForms(tile, 'bar') : timeSeriesForms(tile, now);
                break;
            case 'line':
                out = timeSeriesForms(tile, now);
                break;
            case 'table':
                out = tableForms(tile);
                break;
            case 'timeline':
                out = timelineForms(tile, now);
                break;
            default:
                return [];
        }
        if (!out.length) { return []; }
        out.push(form('fields', { status: 'warning' }));
        return out;
    }

    function fill(text, params) {
        return text.replace(/__(\w+)__/g, function (m, name) { return params[name] === undefined ? m : String(params[name]); });
    }

    /** describe is the English wording of one form: "a number (replaces the value)". */
    function describe(f) {
        var t = TEXT[f.key];
        return fill(t.payload, f.params) + ' (' + fill(t.effect, f.params) + ')';
    }

    /**
     * hint is one English sentence for an error message: what a value for the tile
     * can be. A refused value is the moment someone needs it, and the node's help
     * cannot know the tiles of their view. Objects and forms that need a further
     * message property are left out; the node's dialog lists them.
     */
    function hint(tile) {
        var list = forms(tile).filter(function (f) { return IN_HINT[f.key]; }).map(describe);
        if (!list.length) { return ''; }
        var kind = tile.view + (Array.isArray(tile.categories) ? ' with categories' : '');
        var last = list.pop();
        return 'A ' + kind + ' takes ' + (list.length ? list.join(', ') + ' or ' : '') + last;
    }

    function oneLine(s) {
        return String(s === undefined || s === null ? '' : s).replace(/[\r\n]+/g, ' ');
    }

    /**
     * exampleCode is the source of the function node "Insert example flow" writes:
     * for every tile every form it takes, each a node.send under its description.
     * The first is live, the others are commented out, ready to swap in. It lands in
     * a flow, so it is English whatever language the editor speaks, and it names no
     * view: the same code serves any view with these tiles.
     */
    function exampleCode(doc) {
        var lines = [
            '// An example message for every tile of this view, written by andon out.',
            '// msg.topic is the tile ID. Below each tile, every form it takes: the first',
            '// one is sent, the others are commented out. Replace the values with your own.',
        ];
        (doc && Array.isArray(doc.tiles) ? doc.tiles : []).forEach(function (tile) {
            var list = forms(tile);
            if (!list.length) { return; }
            lines.push('', '// ' + oneLine(tile.id) + ' - ' + oneLine(tile.view) + (tile.title ? ' - ' + oneLine(tile.title) : ''));
            list.forEach(function (f, i) {
                var props = Object.keys(f.msg).map(function (name) { return ', ' + name + ': ' + f.msg[name].code; }).join('');
                lines.push('//   ' + describe(f));
                lines.push((i === 0 ? '' : '// ') + 'node.send({ topic: ' + json(tile.id) + ', payload: ' + f.code + props + ' });');
            });
        });
        lines.push('', 'return null;');
        return lines.join('\n');
    }

    return { forms: forms, describe: describe, hint: hint, exampleCode: exampleCode, TEXT: TEXT };
});
