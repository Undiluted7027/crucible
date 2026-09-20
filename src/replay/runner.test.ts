import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import type { EnvironmentSnapshot } from "../contracts/environment.js";
import { replay, type ReplayAdapter, type ReplayDependencies } from "./runner.js";
import type { TargetOperations } from "./target.js";

// Real repository root: replay() fingerprints the watched files there, and they do not change during a test.
const root = resolve(import.meta.dirname, "../..");

const environment: EnvironmentSnapshot = {
  id: "env-1", name: "env", state: "running", containerId: "container-1", image: "", profile: "", network: "",
  routes: [], readiness: { status: "not-checked" },
};

const reproduced = { status: 500, body: "CRUCIBLE_EXECUTION_PROOF", durationMs: 1 };

function fakes(overrides: { adapter?: Partial<ReplayAdapter>; target?: Partial<TargetOperations> } = {}) {
  const removed: string[] = [];
  const sent: unknown[] = [];
  const dependencies: ReplayDependencies = {
    adapter: {
      create: async () => environment,
      stop: async () => environment,
      start: async () => environment,
      waitUntilReady: async () => ({ ...environment, state: "ready" }),
      remove: async (id) => {
        removed.push(id);
      },
      ...overrides.adapter,
    },
    target: {
      assertRestrictedTarget: async () => "10.0.0.2",
      installRevision: async () => {},
      sendCheck: async (_address, body) => {
        sent.push(body);
        return reproduced;
      },
      ...overrides.target,
    },
  };
  return { dependencies, removed, sent };
}

test("a target that fails its restricted-profile check is removed and never receives a vulnerability trigger", async () => {
  const { dependencies, removed, sent } = fakes({
    target: { assertRestrictedTarget: async () => { throw new Error("Target differs from the reviewed image"); } },
  });
  const evidence = await replay(root, ["vulnerable"], () => {}, dependencies);

  assert.equal(sent.length, 0);
  assert.deepEqual(removed, ["env-1"]);
  assert.deepEqual(
    evidence.results.map(({ verdict, cleanup, error }) => ({ verdict, cleanup, error })),
    [{ verdict: "ENVIRONMENT_FAILED", cleanup: true, error: "Target differs from the reviewed image" }],
  );
});

test("a target that cannot be removed stops the run before the next revision starts", async () => {
  const messages: string[] = [];
  const { dependencies } = fakes({
    adapter: { remove: async () => { throw new Error("docker daemon unavailable"); } },
  });
  const evidence = await replay(root, ["vulnerable", "broken", "fixed"], (message) => messages.push(message), dependencies);

  assert.equal(evidence.results.length, 1);
  assert.equal(evidence.results[0]?.cleanup, false);
  assert.match(evidence.results[0]?.error ?? "", /^Cleanup failed: docker daemon unavailable/);
  assert.ok(messages.some((message) => message.includes("CLEANUP FAILED")));
});

test("cancelling mid-run keeps the violation already observed, removes the target, and skips later revisions", async () => {
  let requests = 0;
  const { dependencies, removed } = fakes({
    target: {
      sendCheck: async () => {
        requests += 1;
        // The first check reproduces the violation; a signal then arrives before the second is sent.
        process.emit("SIGINT");
        return reproduced;
      },
    },
  });
  const evidence = await replay(root, ["vulnerable", "broken", "fixed"], () => {}, dependencies);

  assert.equal(requests, 1);
  assert.equal(evidence.cancelled, true);
  assert.deepEqual(removed, ["env-1"]);
  assert.equal(evidence.results.length, 1);
  assert.deepEqual(
    evidence.results.map(({ verdict, cleanup, error }) => ({ verdict, cleanup, error })),
    [{ verdict: "VIOLATION_REPRODUCED", cleanup: true, error: "Replay cancelled" }],
  );
});
