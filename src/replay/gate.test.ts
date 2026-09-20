import assert from "node:assert/strict";
import test from "node:test";
import type { Verdict } from "./checks.js";
import { demoExitCode, replayExitCode, verifyExitCode, verifyStatus } from "./gate.js";
import type { ReplayEvidence, Revision } from "./schema.js";

function result(revision: Revision, verdict: Verdict, cleanup = true): ReplayEvidence["results"][number] {
  return { revision, verdict, observations: [], cleanup };
}

function evidence(results: ReplayEvidence["results"], overrides: Partial<ReplayEvidence> = {}): ReplayEvidence {
  return {
    schemaVersion: 1, runId: "run", startedAt: "", recordedAt: "", durationMs: 0, cancelled: false, capsule: "invoice",
    advisory: "GHSA-test", requests: [], host: { platform: "test", architecture: "test", node: "test" }, scope: "",
    environment: { backend: "Dockside", image: "", imageId: "", platform: "", network: "" },
    inputs: { "src/a.ts": "hash" }, changedDuringRun: [], results, ...overrides,
  };
}

const vulnerableAndBroken = [result("vulnerable", "VIOLATION_REPRODUCED"), result("broken", "FUNCTIONALITY_REGRESSION")];
const expectedDemo = [...vulnerableAndBroken, result("fixed", "DECLARED_CHECKS_PASSED")];

test("the demo succeeds only when all three revisions behave as designed and the run is trustworthy", () => {
  assert.equal(demoExitCode(evidence(expectedDemo)), 0);
  // A wrong verdict, a missing revision, or any untrustworthy run is never a success.
  assert.equal(demoExitCode(evidence([...vulnerableAndBroken, result("fixed", "VIOLATION_REPRODUCED")])), 2);
  assert.equal(demoExitCode(evidence(vulnerableAndBroken)), 2);
  assert.equal(demoExitCode(evidence(expectedDemo, { cancelled: true })), 2);
  assert.equal(demoExitCode(evidence(expectedDemo, { changedDuringRun: ["src/a.ts"] })), 2);
  assert.equal(demoExitCode(evidence([...vulnerableAndBroken, result("fixed", "DECLARED_CHECKS_PASSED", false)])), 2);
});

test("a single replay passes only on declared checks passing; violations fail it and undecided results never pass", () => {
  assert.equal(replayExitCode(evidence([result("fixed", "DECLARED_CHECKS_PASSED")])), 0);
  assert.equal(replayExitCode(evidence([result("vulnerable", "VIOLATION_REPRODUCED")])), 1);
  assert.equal(replayExitCode(evidence([result("broken", "FUNCTIONALITY_REGRESSION")])), 1);
  assert.equal(replayExitCode(evidence([result("fixed", "INCONCLUSIVE")])), 2);
  assert.equal(replayExitCode(evidence([result("fixed", "ENVIRONMENT_FAILED")])), 2);
  // Passing checks do not count if the target was left running.
  assert.equal(replayExitCode(evidence([result("fixed", "DECLARED_CHECKS_PASSED", false)])), 2);
});

test("saved evidence is stale after any input change, and current evidence passes only if every run did", () => {
  const passed = evidence([result("fixed", "DECLARED_CHECKS_PASSED")]);
  assert.equal(verifyStatus(passed, []), "CURRENT_DECLARED_CHECKS_PASSED");
  assert.equal(verifyStatus(passed, ["src/a.ts"]), "EVIDENCE_STALE");
  assert.equal(verifyStatus({ ...passed, changedDuringRun: ["src/a.ts"] }, []), "EVIDENCE_STALE");
  // Changed inputs outrank a failing verdict: the result needs another run before it means anything.
  assert.equal(verifyStatus(evidence([result("vulnerable", "VIOLATION_REPRODUCED")]), ["src/a.ts"]), "EVIDENCE_STALE");
  assert.equal(verifyStatus(evidence([result("vulnerable", "VIOLATION_REPRODUCED")]), []), "CURRENT_REQUIRES_REVIEW");
  assert.deepEqual(
    (["CURRENT_DECLARED_CHECKS_PASSED", "EVIDENCE_STALE", "CURRENT_REQUIRES_REVIEW"] as const).map(verifyExitCode),
    [0, 1, 2],
  );
});
