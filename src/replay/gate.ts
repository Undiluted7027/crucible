import type { Verdict } from "./checks.js";
import { revisions, type ReplayEvidence, type Revision } from "./schema.js";

/** What each reviewed revision must show for the demo to have behaved as designed. */
const expectedDemoVerdicts: Record<Revision, Verdict> = {
  vulnerable: "VIOLATION_REPRODUCED",
  broken: "FUNCTIONALITY_REGRESSION",
  fixed: "DECLARED_CHECKS_PASSED",
};

/** A run's verdicts mean something only if it finished, left the watched inputs alone, and removed every target. */
export function isTrustedRun(report: ReplayEvidence): boolean {
  return !report.cancelled && report.changedDuringRun.length === 0 && report.results.every((result) => result.cleanup);
}

/**
 * `crucible demo` exit code. 0 means the experiment behaved as expected, including its deliberately vulnerable
 * revision, so it is not a security gate.
 */
export function demoExitCode(report: ReplayEvidence): 0 | 2 {
  if (!isTrustedRun(report)) return 2;
  const matchesExpectations = report.results.length === revisions.length
    && report.results.every((result) => result.verdict === expectedDemoVerdicts[result.revision]);
  return matchesExpectations ? 0 : 2;
}

/**
 * `crucible replay` exit code, the supported security gate for a single revision. A reproduced violation or a
 * broken feature is 1. Anything that cannot be trusted or decided is 2, so it never passes by default.
 */
export function replayExitCode(report: ReplayEvidence): 0 | 1 | 2 {
  if (!isTrustedRun(report)) return 2;
  switch (report.results[0]?.verdict) {
    case "DECLARED_CHECKS_PASSED":
      return 0;
    case "VIOLATION_REPRODUCED":
    case "FUNCTIONALITY_REGRESSION":
      return 1;
    default:
      return 2;
  }
}

export type VerifyStatus = "EVIDENCE_STALE" | "CURRENT_DECLARED_CHECKS_PASSED" | "CURRENT_REQUIRES_REVIEW";

/**
 * `crucible verify` status. `changed` lists watched inputs whose hashes differ from those saved in the evidence.
 * Stale evidence says the result needs another run, not that the change introduced a vulnerability.
 */
export function verifyStatus(evidence: ReplayEvidence, changed: readonly string[]): VerifyStatus {
  if (changed.length > 0 || evidence.changedDuringRun.length > 0) return "EVIDENCE_STALE";
  const allPassed = evidence.results.every((result) => result.cleanup && result.verdict === "DECLARED_CHECKS_PASSED");
  return allPassed ? "CURRENT_DECLARED_CHECKS_PASSED" : "CURRENT_REQUIRES_REVIEW";
}

export function verifyExitCode(status: VerifyStatus): 0 | 1 | 2 {
  switch (status) {
    case "CURRENT_DECLARED_CHECKS_PASSED":
      return 0;
    case "EVIDENCE_STALE":
      return 1;
    case "CURRENT_REQUIRES_REVIEW":
      return 2;
  }
}
