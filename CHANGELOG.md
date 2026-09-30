# Changelog

Versions follow [semantic versioning](https://semver.org): a major version may
break an existing flow, and its entry says what to change.

## 1.0.0

The first release.

- **andon-view** (configuration node): one view. Tiles from a template designed in
  the [Andon configurator](https://andon.app/en/configurator), keys from the `.env`
  it hands out; write secret and content key are stored as Node-RED credentials.
- **andon out**: values in by `msg.topic` = tile ID, checked against the view,
  end-to-end encrypted and uploaded at most once per interval, with a heartbeat
  while values keep arriving.
- The example flow *Andon basics* under *Import → Examples*.
