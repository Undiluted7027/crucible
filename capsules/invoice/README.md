# Invoice capsule

The one curated case: lodash template injection (`GHSA-r5fr-rjxr-66jc`) through the `imports` option of an invoice preview endpoint. The two folders below look like copies of each other but do different jobs.

| Folder | What it is | Used by |
| --- | --- | --- |
| `target/` | Source for the Docker image `crucible/invoice-vulnerable:slice1`: the Dockerfile, the pinned dependencies, and a first version of the app. | `docker build` only |
| `replay/` | The reviewed revisions of the app that a replay actually tests, plus the dependency manifest that `crucible scan` audits. | the runner, `scan`, watched-input hashing |

## How a replay uses them

1. Dockside starts a container from the image built from `target/`. The image supplies the runtime: Node, express and the vulnerable lodash 4.17.20.
2. The runner then overwrites `/workspace/dist/server.js` and `render.js` in the container with the revision under test, and restarts it (`installRevision` in `src/replay/target.ts`). The revision's TypeScript is compiled in memory and never touches the image.
3. The same four requests (`src/replay/checks.ts`) are sent to each revision.

So the app code in `target/src/` is never what gets tested. Only what `target/` installs matters. It is also why the image is named `invoice-vulnerable` even though the source it runs during a replay comes from `replay/`.

## The revisions (`replay/`)

| Revision | Source | Intent |
| --- | --- | --- |
| `vulnerable` | `src/server.ts`, `src/render.ts` | The vulnerable behavior: `options.imports` keys reach `lodash.template`. |
| `broken` | `src/server.ts`, `patches/broken.ts` | A tempting repair that removes the `imports` option entirely. The custom-currency control catches it. |
| `fixed` | `src/server.ts`, `patches/fixed.ts` | Accepts only a string `currency`. Same lodash version, so this is an application-level mitigation. |

`replay/` is also the "scanned repository" in the demo: `crucible scan capsules/invoice/replay --audit examples/invoice-audit.json`. That is why it carries its own `package.json` and lockfile.

## Changing anything here

- **`replay/` is a watched input.** Editing any file in it makes every saved evidence file report `EVIDENCE_STALE` until the replay is run again. Moving `replay/src/render.ts` also changes the file paths `scan` prints.
- **`target/` changes the image.** Rebuild with the command in [docs/dockside-local.md](../../docs/dockside-local.md), then run `npm run dockside:verify` and update the pinned image ID in `config/dockside/compatibility.json` and `src/dockside/reviewed-setup.ts`. A test fails if the two disagree.

## Known rough edges

- `replay/package.json` is a copy of `target/package.json`, including the package name `@crucible/invoice-target`. Only its dependency list and lockfile are used, because `replay/` is never built or started on its own. Its name is left alone because it is also recorded in the lockfile.
- The runner and `watchedPaths` name this capsule directly. Supporting a second capsule would mean moving those values into the capsule. That is deliberately not done until there is a second case.
