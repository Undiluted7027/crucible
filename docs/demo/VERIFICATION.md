# CLI verification — September 20, 2026

Executed on macOS arm64 with Node **24.18.0**. Target containers used the existing pinned Linux arm64 invoice image and Dockside v4.0.1 installation. Dependencies and images were already prepared; these are warm local measurements, not clean-machine setup benchmarks.

Re-recorded with the source at commit `f770fb5`, after the internal refactor of the CLI, runner and adapter. The runtime results below are unchanged, and the replay evidence files were regenerated so they match the current source.

| Check | Observed result |
| --- | --- |
| `npm test` | 31 passed; two integration tests explicitly skipped in this command |
| `npm run test:integration` | Both integration tests passed, including failed readiness |
| `npm run typecheck` | Passed |
| Installed `crucible` executable in an isolated temporary npm prefix | Help command passed under Node 24; temporary install removed. Not repeated for the refactor; the `--help` output is unchanged |
| Saved audit import | 8 affected packages, 18 direct advisory records, four source files inspected; inherited warnings retained |
| Live npm audit lookup | Produced valid JSON through the CLI |
| Single repaired replay | All four declared checks passed; target removed; 20.67 seconds |
| Three-revision rehearsal | All expected outcomes observed; targets removed; 61.19 seconds |
| Changed-file revalidation | Current/0 → stale/1 → restored/0 |
| Post-run Docker inventory | No `crucible-replay-*` containers remained |

## Runtime results

| Revision | Injection | Standard invoice | Custom currency | Server-owned template | Verdict |
| --- | --- | --- | --- | --- | --- |
| vulnerable | Reproduced | Passed | Passed | Passed | VIOLATION_REPRODUCED |
| broken | Blocked | Passed | Regression | Passed | FUNCTIONALITY_REGRESSION |
| fixed | Blocked | Passed | Passed | Passed | DECLARED_CHECKS_PASSED |

The final rehearsal recorded no watched-input changes during execution. The fixed case uses a reviewed application guard, not a dependency upgrade. The remaining scanner findings are unresolved.

## Artifacts

- [Three-revision JSON](../../evidence/replays/submission-demo.json) and [readable report](../../evidence/replays/submission-demo.md).
- [Single repaired JSON](../../evidence/replays/submission-fixed.json) and [readable report](../../evidence/replays/submission-fixed.md).
- [Stale-input rehearsal](../../evidence/cli-staleness-check.json).
- [Imported audit investigation](../../evidence/cli-audit-scan.json).

The older `first-cli-run.json` records an earlier implementation and is intentionally stale after subsequent code changes and no longer loads with `verify` or `report`. Use the submission artifacts above for the presentation.

## What these checks do not establish

No independent customer application, second vulnerability class, clean-machine Dockside installation, Windows/Linux host support, adversarial container escape resistance, or automatic repair generation was validated in this CLI build. Static candidate extraction is intentionally incomplete. The code and tests demonstrate the documented one-case workflow.
