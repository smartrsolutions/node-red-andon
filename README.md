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

1. **Design** your tiles in the [configurator](https://andon.app/en/configurator) and
   create the view there. Download the `.env` and the template.
2. **Pair** your iPhone: scan the configurator's QR code with the Andon app.
3. **Install** this package: *Manage palette → Install*, search for `andon`.
4. **Import the example**: *Import → Examples → @smartrsolutions/node-red-andon → Andon basics*.
5. **Open the view** `Getting started`, click *Import .env* and *Import template*,
   then deploy. The node turns green, and the tiles appear on your iPhone.

Then replace the simulator in the example with your own sources.

## Messages

`msg.topic` is the ID of a tile, as the view lists it. What `msg.payload` does
depends on the tile:

| Tile | `msg.payload` | Effect |
|---|---|---|
| label | number or text | replaces the value |
| gauge, progress, donut | number | replaces the value |
| line, bar over time | number | appended to the series (`msg.timestamp`, `msg.series` optional) |
| bar with categories, pie, donut | array of numbers | replaces the values, one per category |
| table | array of rows (a row is an array of cells) | replaces the rows |
| timeline | state ID | starts a new segment (`msg.lane` optional) |
| any tile | object, e.g. `{"value": 79.3, "status": "warning"}` | sets the named fields; `null` removes one |

Numbers may arrive as text (`"79.3"`), as MQTT and most PLC nodes deliver them.

Without `msg.topic`:

```js
msg.payload = { t_oee: 79.3, t_shift: 580 };   // several tiles at once
msg.payload = { id: "…", tiles: [ … ] };         // a whole view document, replaces the state
```

A value that does not fit its tile is refused with an error a Catch node receives.
The view stays as it was, so one bad value never blocks the others.

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

## Security

- Write secret and content key are Node-RED credentials: stored encrypted in
  `flows_cred.json` and never part of an exported flow. Set `credentialSecret` in
  your `settings.js`.
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
