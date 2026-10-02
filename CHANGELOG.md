# Changelog

Versions follow [semantic versioning](https://semver.org): a major version may
break an existing flow, and its entry says what to change.

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
