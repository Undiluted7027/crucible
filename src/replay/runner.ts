import { randomUUID } from "node:crypto";
import { invoiceAdvisory } from "../audit/catalog.js";
import { DocksideAdapter } from "../dockside/adapter.js";
import { docksideAdapterConfig, invoiceTarget, invoiceTargetRequest, replayTimeouts } from "../dockside/reviewed-setup.js";
import { errorMessage } from "../errors.js";
import { checks, evaluate, verdict, type Observation } from "./checks.js";
import { changedInputs, fingerprint } from "./evidence.js";
import type { ReplayEvidence, Revision } from "./schema.js";
import { dockerTarget, type TargetOperations } from "./target.js";

type RevisionResult = ReplayEvidence["results"][number];

/** The parts of the Dockside adapter a replay uses. */
export type ReplayAdapter = Pick<DocksideAdapter, "create" | "stop" | "start" | "waitUntilReady" | "remove">;

/** What a replay talks to. The defaults are real Dockside and Docker; tests pass fakes. */
export interface ReplayDependencies {
  adapter: ReplayAdapter;
  target: TargetOperations;
}

interface RevisionRun extends ReplayDependencies {
  root: string;
  runId: string;
  revision: Revision;
  progress: (message: string) => void;
  isCancelled: () => boolean;
}

/**
 * Runs one revision in its own disposable target and always removes it. Nothing throws: a failure is recorded on
 * the result, with any observations gathered so far, so the caller still has evidence and knows whether cleanup worked.
 */
async function replayRevision({ adapter, target, root, runId, revision, progress, isCancelled }: RevisionRun): Promise<RevisionResult> {
  const name = `crucible-replay-${runId.slice(0, 8)}-${revision}`;
  let identifier = name;
  const observations: Observation[] = [];
  const result: RevisionResult = { revision, verdict: "ENVIRONMENT_FAILED", observations, cleanup: false };
  try {
    progress(`${revision}: creating a disposable Dockside target`);
    const environment = await adapter.create(invoiceTargetRequest(name));
    identifier = environment.id;
    const { containerId } = environment;
    if (!containerId) throw new Error("Dockside did not return a container ID");

    await target.assertRestrictedTarget(containerId);
    await target.installRevision(containerId, root, revision);
    // A restart picks up the installed source; readiness then proves the revision actually serves requests.
    await adapter.stop(identifier);
    await adapter.start(identifier);
    const ready = await adapter.waitUntilReady(identifier, "app");
    if (ready.state !== "ready") throw new Error("Application readiness failed");

    const address = await target.assertRestrictedTarget(containerId);
    for (const check of checks) {
      if (isCancelled()) throw new Error("Replay cancelled");
      try {
        observations.push(evaluate(check, await target.sendCheck(address, check.body)));
      } catch (error) {
        // One unanswered request is inconclusive; the other checks still run.
        observations.push({ name: check.name, kind: check.kind, outcome: "inconclusive", error: errorMessage(error) });
      }
    }
    result.verdict = verdict(observations);
  } catch (error) {
    result.error = errorMessage(error);
    // Keep evidence gathered before the failure; a reproduced violation must not be lost to a later error.
    if (observations.length) result.verdict = verdict(observations);
  } finally {
    try {
      await adapter.remove(identifier);
      result.cleanup = true;
    } catch (error) {
      result.error = `Cleanup failed: ${errorMessage(error)}`;
    }
  }
  return result;
}

/**
 * Replays the selected revisions one after another and returns the full evidence record. SIGINT/SIGTERM finish the
 * current operation, remove the target, and stop before the next revision. A failed cleanup stops the run at once.
 */
export async function replay(
  root: string,
  selected: readonly Revision[],
  progress: (message: string) => void,
  { adapter, target }: ReplayDependencies = {
    adapter: new DocksideAdapter(docksideAdapterConfig(root, replayTimeouts)),
    target: dockerTarget,
  },
): Promise<ReplayEvidence> {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const inputs = await fingerprint(root);
  const runId = randomUUID();
  const results: RevisionResult[] = [];

  let cancelled = false;
  const cancel = () => {
    cancelled = true;
    progress("Cancellation requested; cleaning up after the current bounded operation.");
  };
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  try {
    for (const revision of selected) {
      if (cancelled) break;
      const result = await replayRevision({ adapter, target, root, runId, revision, progress, isCancelled: () => cancelled });
      results.push(result);
      progress(`${revision}: ${result.verdict}${result.cleanup ? " · target removed" : " · CLEANUP FAILED"}`);
      if (!result.cleanup) break;
    }
  } finally {
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
  }

  return {
    schemaVersion: 1,
    runId,
    startedAt,
    recordedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - started),
    cancelled,
    capsule: invoiceAdvisory.capsule,
    advisory: invoiceAdvisory.id,
    requests: checks.map(({ name, kind, body }) => ({ name, kind, body })),
    host: { platform: process.platform, architecture: process.arch, node: process.version },
    scope: "Curated invoice fixture, not the scanned repository. Application-level mitigation on lodash 4.17.20; unrelated audit findings remain unresolved.",
    environment: {
      backend: "Dockside",
      image: invoiceTarget.image,
      imageId: invoiceTarget.imageId,
      platform: "linux/arm64",
      network: invoiceTarget.network,
    },
    inputs,
    // Inputs are compared after the run, so an edit made while it executed marks the evidence stale.
    changedDuringRun: changedInputs(inputs, await fingerprint(root)),
    results,
  };
}
