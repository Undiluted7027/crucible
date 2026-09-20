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

The earlier [workspace proposal](docs/poc.md) and [slice plan](docs/poc-slices.md) describe the broader product. They are not a list of completed features. This deadline-sized submission does **not** include the web workspace, an autonomous repair agent, arbitrary-repository reproduction, automatic fix PRs, general taint analysis, or a portable one-command Dockside installer. The earlier semver experiment has not been integrated into this CLI.

## Development

```sh
npm test
npm run typecheck
npm run test:integration  # Requires the prepared Dockside installation
```

The main modules are intentionally small:

- `src/audit/scan.ts`: audit validation and candidate extraction.
- `src/replay/runner.ts`: environment orchestration and HTTP transport.
- `src/replay/checks.ts`: reviewed requests and outcome rules.
- `src/replay/evidence.ts`: watched-input identity and invalidation.
- `src/cli.ts`: command parsing, terminal output, and exit codes.

See the [three-minute presentation](docs/demo/SUBMISSION.md) for the rehearsed journey and honest scope.
