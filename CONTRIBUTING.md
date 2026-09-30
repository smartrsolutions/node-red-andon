# Contributing

This repository is the public mirror of the package's source. The package is
developed in a private repository next to the Andon relay and its specification;
every release arrives here as one commit, tagged `v<version>`, and that tag is
what publishes to npm (`.github/workflows/publish.yml`). What is on npm was built
from the commit of the same version here, and npm's provenance statement says so.

- **Issues** are welcome here, or by mail to <support@andon.app>.
- **Pull requests** cannot be merged here, because the next release would
  overwrite them. A change we take is applied in the source repository and
  arrives with the next release.
- **Security problems**: please write to <support@andon.app> instead of opening a
  public issue.
