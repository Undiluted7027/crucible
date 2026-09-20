# Sample npm audit inputs

`invoice-audit.json` was obtained with `npm --prefix capsules/invoice/replay audit --json --ignore-scripts` during CLI development on September 20, 2026. It corresponds to the fixture's pinned lockfile. Live audit output can change as advisories are updated.

`npm-audit.json` is the older saved input from the reachable-audit experiment. It includes additional packages (such as semver and minimist) that are not dependencies of this invoice fixture. It is retained only as an import-format example; use `invoice-audit.json` for the presentation.

Neither file is proof of application exploitability. The original scanner data remains intact.
