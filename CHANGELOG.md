# Changelog

Versions follow [semantic versioning](https://semver.org): a major version may
break an existing flow, and its entry says what to change.

## 1.2.1

- **Insert example flow shows the single message too.** Below the `node.send`
  lines, commented out, the same values as one message without `msg.topic`:
  `return { payload: { tileId: value, ... } }`, for a source that has all its
  values at once. The README says when to use it and what a whole view document does
  instead. The example *All tile kinds* carries it as well.

## 1.2.0

- **A second example, All tile kinds**: a view with one tile of every kind - two
  labels, a gauge, a progress, a line of samples and one in the step form, bars over
  time and over categories, a pie, a donut, a table and a timeline with two lanes -
  in neutral names and values, and the function node *Insert example flow* writes
  for it, with every form every tile takes. *Import → Examples →
  @smartrsolutions/node-red-andon → All tile kinds.*
- **The dialog of andon out shows what each tile takes.** Below the view, every tile
  of its template with every form it accepts and an example of each: for a line a
  number, a number at `msg.timestamp`, `[timestamp, value]` pairs, a whole series
  of samples and one in the step form; for a bar with categories one number per
  category, new categories with their values, a verdict per bar; and so on. What a
  tile takes depends on its kind and its template, and until now the only place that
  said so was the README.
- **Insert example flow**, a button in the same dialog, puts an inject and a
  function node named *Andon example* in front of the node, wired to it. The code
  holds every form of every tile as a `node.send`: the first one live, every 30 s,
  the others commented out, ready to swap in. It is English whatever language the
  editor speaks.
- **An array of `[timestamp, value]` pairs replaces a series in the step form too.**
  It was refused before, because the pairs landed next to the points. A whole series
  sent as an array or an object also counts as real data now: the next number is
  appended to it instead of replacing it as if it were the template's start values.
- **A refused value says what the tile takes**, in English, after what was wrong:
  `tile "t_takt" needs a number, got "hoch". A line takes a number (is appended to
  the series, at the time it arrives) or an array of [timestamp, value] pairs
  (replaces the series; msg.series picks which)`. A
  document the schema refuses gets the same sentence for the tile the message broke.
- **An incomplete view shows on the canvas.** A view with neither a view ID nor an
  environment prefix - the `.env` was never imported - is marked as not configured,
  and so is every andon out on it, before a deploy rather than with the first value.
  A view without a template is no error, since a source may send whole view
  documents, but its andon out nodes say *no template* once deployed, and the view's
  dialog asks for the template right after the `.env` is imported.
- **A broken series says what is broken.** A series has one of two forms, samples or
  `start`/`stepSec`/`points`, and a refused one was reported against both: a series
  whose only fault was a `start` from `Date.toString()` read "missing required field
  samples; unknown field "start"; unknown field "stepSec"", with the cause hidden
  behind "+3 more". The error now names the form the series uses, and only its faults:
  `/series/0/start: invalid date-time`.
- **The README and the node's help say what an array does to a line**: an array of
  `[timestamp, value]` pairs replaces the series, as it always did. The README has an
  example of a whole series in the step form.

## 1.1.0

- **A view can take its values from the environment.** The new field *From the
  environment* on **andon-view** holds a prefix — `ANDON_`, or `ANDON_CLOUD_` for a
  second view in the same environment — and whatever the dialog leaves empty is then
  read from `<prefix>VIEW`, `<prefix>WRITE_SECRET`, `<prefix>CONTENT_KEY`,
  `<prefix>KEY_VERSION` and `<prefix>URL`. Those are the names the `.env` from the
  configurator uses, so it can be handed to a container unedited. What the view
  holds still wins, so nothing changes for a flow that does not set a prefix; a
  variable nobody set makes the view name it. For a Node-RED in a container this is
  what keeps the secrets out of `flows_cred.json` and the flow file free of
  everything but variable names. README: "From the environment, for a container".
- **The key version field is empty by default** and means 1, as it did before. It had
  to be: a field that always holds 1 would make `<prefix>KEY_VERSION` unreachable.
  An existing view keeps the value it was saved with.

## 1.0.1

- **"Getting started" in the README is two paths now**, because the old steps mixed
  them: they had you download the template along with the `.env` and import both into
  the example. The example ships its own four tiles, and its simulator sends to
  exactly those, so a template designed in the configurator replaced them and every
  simulated value was refused afterwards; nothing appeared on the iPhone. Trying the
  example needs the `.env` only. The template belongs to the other path, a view with
  your own tiles. The help of **andon-view** says so too now.

## 1.0.0

The first release.

- **andon-view** (configuration node): one view. Tiles from a template designed in
  the [Andon configurator](https://andon.app/en/configurator), keys from the `.env`
  it hands out; write secret and content key are stored as Node-RED credentials.
- **andon out**: values in by `msg.topic` = tile ID, checked against the view,
  end-to-end encrypted and uploaded at most once per interval, with a heartbeat
  while values keep arriving.
- The example flow *Andon basics* under *Import → Examples*.
