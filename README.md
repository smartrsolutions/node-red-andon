# Andon for Node-RED

Send values from Node-RED to [Andon](https://andon.app), the iPhone app that shows
your data as tiles and widgets. Everything is end-to-end encrypted: the content key
stays in your Node-RED, and only the devices you paired can read what you send.

```
[MQTT oee] ──┐
[S7 count] ──┼──► [andon out] ──► iPhone
[SQL order] ─┘
```

Two nodes:

- **andon-view** (configuration): one view. Its tiles come from a template you
  design in the [Andon configurator](https://andon.app/en/configurator); its keys come
  from the `.env` the configurator gives you.
- **andon out**: takes values. `msg.topic` is the tile ID, `msg.payload` the value.
  It collects, checks, encrypts and uploads them.

## Getting started

### Try the example

The example brings its own four tiles and a simulator that feeds them, so all it
needs from you are the keys of a view.

1. **Install** this package: *Manage palette → Install*, search for `andon`.
2. **Create a view** in the [configurator](https://andon.app/en/configurator) and
   download the `.env`. Leave the tiles alone, and do not download the template:
   the example has its own.
3. **Pair** your iPhone: scan the configurator's QR code with the Andon app.
4. **Import the example**: *Import → Examples → @smartrsolutions/node-red-andon → Andon basics*.
5. **Open the view** `Getting started` (the pencil next to *View* in `andon out`)
   and click *Import .env*. Only that one: the simulator sends to the tiles the
   example came with, and another template would replace them.
6. **Deploy.** The node turns green, and the tiles appear on your iPhone.

### Your own tiles

1. **Design** your tiles in the [configurator](https://andon.app/en/configurator) and
   create the view there. Download the `.env` and the template.
2. **Pair** your iPhone: scan the configurator's QR code with the Andon app.
3. **Add an `andon out`** node to a flow. Next to *View*, add a new view and open it
   with the pencil, then click *Import .env* and *Import template*.
4. **Connect your sources** to the node: `msg.topic` is the tile ID, `msg.payload`
   the value. The node's dialog lists what each tile takes, and *Insert example
   flow* puts a source in front of it that sends an example value to every tile.
5. **Deploy.**

Without the `.env`, the node is marked as not configured before you deploy.
Without the template, it shows *no template* once deployed: a view knows its tiles
from the template, and without one it takes a whole view document only.

Coming from the example, the step is the same: replace its simulator with your own
sources, and import your template into its view once the tile IDs are yours.

A second example, *All tile kinds*, has one tile of every kind and a function node
that lists every form each of them takes: *Import → Examples →
@smartrsolutions/node-red-andon → All tile kinds*, then the `.env` as above. It is
what *Insert example flow* writes, for a view with every kind in it.

## Messages

`msg.topic` is the ID of a tile, as the view lists it. What `msg.payload` does
depends on the tile:

| Tile | `msg.payload` | Effect |
|---|---|---|
| label | number or text | replaces the value |
| gauge, progress, donut | number | replaces the value |
| line, bar over time | number | appended to the series, now or at `msg.timestamp`; `msg.series` picks the series |
| line, bar over time | array of `[timestamp, value]` pairs | replaces the series; `msg.series` picks which |
| line, bar over time | `{series: [{name, samples}]}` | replaces every series |
| line, bar over time | `{series: [{name, start, stepSec, points}]}` | replaces every series: a point every `stepSec` from `start` |
| bar with categories, pie, donut | array of numbers, one per category | replaces the values; `msg.series` picks the series |
| bar with categories, pie, donut | `{categories, series: [{name, values}]}` | replaces categories and values together |
| bar with categories, one series | `{series: [{name, values, statuses}]}` | a verdict per bar: `ok`, `warning`, `critical` or `null` |
| table | array of rows, a row an array of cells | replaces the rows |
| table | array of `{cells, status}` | replaces the rows, with a status per row |
| timeline | state ID | starts a new segment, now or at `msg.timestamp`; `msg.lane` picks the lane |
| timeline | `{from, to}` | moves the time axis; what lies before `from` is trimmed |
| any tile | object, e.g. `{"value": 79.3, "status": "warning"}` | sets the named fields; `null` removes one |

A number cannot be appended to a series in the step form: it has no timestamp of
its own. Send pairs or a whole series instead; either replaces the step form.

The dialog of `andon out` lists these forms for the tiles of your view, and *Insert
example flow* writes all of them into a function node, one `node.send` each, and
below them, commented out, the same values as one message without `msg.topic`.

Numbers may arrive as text (`"79.3"`), as MQTT and most PLC nodes deliver them.

Timestamps are ISO 8601 in UTC, as `Date.toISOString()` writes them;
`Date.toString()` is refused. A whole history at a fixed step - hourly values since
midnight, say - is one series in the step form:

```js
const midnight = new Date();
midnight.setHours(0, 0, 0, 0);
msg.topic = 't_visitors';
msg.payload = { series: [{ name: 'Today', start: midnight.toISOString(), stepSec: 3600, points: [12, 30, 41] }] };
```

A series has at least one point.

Without `msg.topic`, one message can carry several tiles - the natural shape for
a function node that has all its values at once, from one query or one API call:

```js
return { payload: { t_oee: 79.3, t_shift: 580, t_reasons: [4, 7, 2] } };
```

Each value takes the same forms as with `msg.topic`. The message is taken or
refused as a whole, and `msg.series`, `msg.lane` and `msg.timestamp` apply to every
tile in it; for a value that needs its own, use `msg.topic`. Sent one by one or as
one message, values that arrive together go out in the same upload.

A whole view document as `msg.payload` (it has `tiles`) replaces the state,
template included - for a source that builds its tiles itself rather than filling
those of a template. `generatedAt` and `staleAfterSec` are set on upload.

A value that does not fit its tile is refused with an error a Catch node receives,
and the error says what the tile takes. The view stays as it was, so one bad value
never blocks the others.

The first real value of a series or timeline lane replaces the points the
template came with: those are the configurator's start values, not measurements.

## When it uploads

- A change goes out at most once per **interval** (30 s by default, 10 s at least).
  The first change after a quiet spell goes out at once.
- While values keep arriving, even unchanged ones, a heartbeat goes out after half
  the **stale** time, so the view stays fresh.
- When no value arrives, nothing is sent: the app then shows the view as stale,
  which is what it should show when your source has stopped.
- Devices are woken only when a tile's **status** changes (configurable). Every
  wake-up costs battery on every paired device.

## Status

The status of a tile (`ok`, `warning`, `critical`, `stale`) is your judgement: the
app does not compute it from the value. Send it with the value, or tick
*status from bands* for a tile in the view to have it derived from its bands.

## From the environment, for a container

A Node-RED in a container often has no editor to type a secret into, and no
credential store worth writing to. Set **From the environment** on the view to a
prefix — `ANDON_`, or `ANDON_CLOUD_` for a second view in the same environment —
and everything the dialog leaves empty is read from there instead:

| Variable | What for |
|---|---|
| `<prefix>VIEW` | the view ID |
| `<prefix>WRITE_SECRET` | the write secret |
| `<prefix>CONTENT_KEY` | the content key, base64 |
| `<prefix>KEY_VERSION` | the key version, 1 if unset |
| `<prefix>URL` | the relay, if it is not the public one |

Those are the names the `.env` from the configurator already uses, so it can be
handed to the container unedited. A prefix has to be upper case and end in an
underscore, and it replaces the leading `ANDON_` of each name.

What the view holds always wins; the environment fills in the rest. A variable
nobody set makes the view say which one it was, and nothing is uploaded until it is
there. The flow file then carries variable *names* and no secret at all — which is
what makes a flow safe to commit, copy between machines and hand to a deployment.

The template stays in the flow: it is titles, icons, units and ranges, not a
secret.

## Security

- Write secret and content key are Node-RED credentials: stored encrypted in
  `flows_cred.json` and never part of an exported flow. Set `credentialSecret` in
  your `settings.js`. Or keep them out of Node-RED's files entirely and hand them
  in through the environment, see above.
- The content key never leaves Node-RED. The write secret is sent only in the
  `Authorization` header of the upload.
- The output of `andon out` is a summary (sizes, status code, `notify`), never the
  envelope or a secret.
- The `.env` from the configurator also holds the invite secret. This package drops
  it on import: a data source does not pair devices.

## Requirements

Node-RED 3.0 or newer, Node.js 18 or newer.

## License

Copyright 2026 SMARTR.solutions. Licensed under the Apache License, Version 2.0;
the text is in the file `LICENSE` of this package.
