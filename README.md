# Crucible

**An npm audit warning is a starting point. Crucible makes the next step an experiment.**

Import an audit report, inspect candidate call sites, and replay a supported vulnerability in a disposable application. Compare a reproduction with two repairs, retain the observed results, and flag evidence when its inputs change.

This hackathon build is a local TypeScript CLI. It supports one reviewed invoice-rendering case: `GHSA-r5fr-rjxr-66jc`, lodash template injection through imports keys. Other findings remain visible and unresolved.

## Quick start

Use Node 24 and npm. On the prepared development machine, `fnm exec --using 24` can prefix these commands if the shell selects another Node version.

```sh
npm ci
npm run build
npm run cli -- --help
npm run cli -- scan capsules/invoice/replay --audit examples/invoice-audit.json
npm run cli -- explain GHSA-r5fr-rjxr-66jc
```

Scan another repository using its configured npm registry, or supply its saved npm audit v2 JSON:

```sh
npm run cli -- scan /path/to/app
npm run cli -- scan /path/to/app --audit /path/to/audit.json --json --out investigation.json
```

Scanning does not install dependencies, execute the repository, or modify its source. The static analysis identifies ES-module call-site candidates. It does not establish exploitability or justify dismissing a warning. Supplied audit reports are assumed to belong to the selected repository; the prototype cannot establish their provenance.

## The live demonstration

Replay requires the prepared Docker Desktop / Dockside installation described in [local setup](docs/dockside-local.md). Scan and explain work without it. A fresh clone does not include the local Dockside installation or authentication session.

```sh
npm run demo
```

The command creates three separate targets, applies reviewed fixture source, sends the same four external HTTP checks, and removes each target:

| Revision | Injection check | Custom currency | Result |
| --- | --- | --- | --- |
| vulnerable | Marker executed | Preserved | Violation reproduced |
| broken | Blocked | Broken | Functionality regression |
| fixed | Blocked | Preserved | Declared checks passed |

The repaired application accepts only a server-owned template and a supported currency string. This is an application-level mitigation on the same lodash version, not an upgrade and not a claim that every lodash advisory has been addressed.

The evaluator runs outside the target. Before reproduction, the controller checks the pinned image, resource limits, mounts, environment, internal network, and selected management/internet connectivity restrictions. There are no host credential or Docker-socket mounts in the target. These checks cover this curated fixture, not arbitrary hostile code.

## Saved evidence and revalidation

```sh
npm run cli -- replay invoice --revision fixed --out evidence/replays/my-fixed-run.json
npm run cli -- verify evidence/replays/my-fixed-run.json
npm run cli -- report evidence/replays/my-fixed-run.json > my-report.md
```

Evidence records requests, responses, individual outcomes, image identity, input hashes, duration, runtime, and cleanup. Output files are never overwritten.

Edit a watched file and repeat `verify`: it reports **EVIDENCE_STALE**. That means the previous result needs another run; it does not mean the edit introduced a vulnerability. Additions and deletions also invalidate evidence. Watched inputs include the CLI/checker source, fixture and patches, dependencies, and reviewed Dockside configuration.

`verify` compares local files with a saved run. It does not contact Docker, inspect a running deployment, or protect evidence from deliberate tampering. A fresh replay is needed to test the environment again.

## Exit codes

| Command | 0 | 1 | 2 |
| --- | --- | --- | --- |
| scan | Report produced, even with findings | — | Invalid report, setup, or registry error |
| demo | All three expected outcomes observed | — | Mismatch, failure, changed inputs, or incomplete cleanup |
| replay | Declared checks passed | Violation or regression | Inconclusive or environment failure |
| verify | Inputs current and saved checks passed | Stale inputs | Current evidence requires review, or error |

`demo` succeeding means the experiment behaved as expected—including its deliberately vulnerable revision. Use a single `replay --revision fixed` for the supported fixture's security gate.

## What is implemented

- npm audit v2 import and live registry lookup; inherited and unsupported findings retained.
- Syntactic candidate locations for supported ES-module imports, including named aliases.
- Curated advisory explanation and a Dockside-backed, three-revision replay.
- Separate security and functional observations, bounded operations, cleanup, and explicit failures.
- JSON evidence, Markdown reports, and conservative file-based staleness detection.

This deadline-sized submission is a narrow slice of the broader workspace product and does **not** include the web workspace, an autonomous repair agent, arbitrary-repository reproduction, automatic fix PRs, general taint analysis, or a portable one-command Dockside installer. The earlier semver experiment has not been integrated into this CLI.

## Development

```sh
npm test
npm run typecheck
npm run test:integration  # Requires the prepared Dockside installation
```

Where things live:

- `src/cli.ts`: argument parsing, validation, and dispatch to the commands below. `src/output.ts` holds terminal sanitizing and never-overwrite file writes.
- `src/audit/`: `command.ts` implements `scan` and `explain`; `scan.ts` validates npm audit reports and extracts call-site candidates; `catalog.ts` lists the reviewed advisories.
- `src/replay/`: `command.ts` implements `demo`, `replay`, `verify` and `report`; `gate.ts` decides their exit codes and verification status; `runner.ts` runs each revision in its own disposable target; `target.ts` holds the Docker-level steps (verify the restricted profile, install a revision, send a check); `checks.ts` holds the reviewed requests and outcome rules; `schema.ts` defines the saved evidence format; `evidence.ts` reads evidence and tracks watched inputs; `report.ts` renders Markdown.
- `src/dockside/`: typed adapter over the Dockside CLI (`adapter.ts`), its response schemas (`schema.ts`), bounded subprocess execution (`process.ts`), the `node -e` scripts run inside containers (`container-scripts.ts`), and the pinned image, profile, limits and timeouts every caller shares (`reviewed-setup.ts`).
- `src/errors.ts`: `errorMessage` for anything thrown.
- `src/contracts/environment.ts`: environment types that the rest of Crucible depends on, independent of Dockside.
- `src/compatibility/verify.ts`: `npm run dockside:verify`, which checks a Dockside installation and writes `evidence/dockside/`.
- `capsules/invoice/`: the curated case. `target/` is the image source; `replay/` holds the revisions the runner injects into it. See its [README](capsules/invoice/README.md) before changing either.
- `config/dockside/`, `scripts/dockside/`: reviewed Dockside profile, pinned versions, and network setup.

See the [three-minute presentation](docs/demo/SUBMISSION.md) for the rehearsed journey and honest scope.
