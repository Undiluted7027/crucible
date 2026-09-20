import type { Verdict } from "./checks.js";
import type { ReplayEvidence, Revision } from "./schema.js";

/** One revision's result with no observations, for tests that only care about verdict and cleanup. */
export function revisionResult(revision: Revision, verdict: Verdict, cleanup = true): ReplayEvidence["results"][number] {
  return { revision, verdict, observations: [], cleanup };
}

/** A complete evidence record with inert defaults. Override only what a test is about. */
export function replayEvidence(
  results: ReplayEvidence["results"],
  overrides: Partial<ReplayEvidence> = {},
): ReplayEvidence {
  return {
    schemaVersion: 1, runId: "run", startedAt: "", recordedAt: "", durationMs: 0, cancelled: false, capsule: "invoice",
    advisory: "GHSA-test", requests: [], host: { platform: "test", architecture: "test", node: "test" }, scope: "",
    environment: { backend: "Dockside", image: "", imageId: "", platform: "", network: "" },
    inputs: { "src/a.ts": "hash" }, changedDuringRun: [], results, ...overrides,
  };
}
