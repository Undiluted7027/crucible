import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { resolve } from "node:path";
import { DocksideAdapter } from "./adapter.js";

const enabled = process.env.CRUCIBLE_DOCKSIDE_INTEGRATION === "1";

test("pinned Dockside runs the invoice lifecycle and reports application readiness", { skip: !enabled }, async () => {
  const root = resolve(import.meta.dirname, "../..");
  const adapter = new DocksideAdapter({
    executable: resolve(root, ".crucible/upstream/dockside/cli/dockside"),
    server: "crucible-local",
    cliConfigDirectory: resolve(root, ".crucible/dockside-runner-cli"),
    operationTimeoutMs: 120_000,
    readinessTimeoutMs: 60_000,
    readinessPollMs: 2_000,
    maxOutputBytes: 262_144,
  });
  const name = `crucible-invoice-${process.pid}`;
  let createdId: string | undefined;

  try {
    const running = await adapter.create({
      name,
      profile: "crucible-invoice-v1",
      image: "crucible/invoice-vulnerable:slice1",
      network: "crucible-invoice-v1",
      unixuser: "crucible",
      ide: "openvscode/1.109.5",
      access: { app: "owner", ide: "owner" },
    });
    createdId = running.id;
    assert.equal(running.state, "running");
    assert.equal(running.readiness.status, "not-checked");
    assert.equal(running.profile, "crucible-invoice-v1");
    assert.equal(running.network, "crucible-invoice-v1");

    const ready = await adapter.waitUntilReady(running.id, "app");
    assert.equal(ready.state, "ready");
    assert.equal(ready.readiness.status, "ready");
    assert.ok(ready.routes.some((route) => route.kind === "ide" && route.access === "owner"));
    assert.ok(ready.routes.some((route) => route.name === "app" && route.access === "owner"));

    const logs = await adapter.logs(running.id);
    assert.match(logs.text, /invoice target listening on 3000/);
    assert.ok(logs.retainedBytes <= 262_144);

    const stopped = await adapter.stop(running.id);
    assert.equal(stopped.state, "stopped");
    const restarted = await adapter.start(running.id);
    assert.equal(restarted.state, "running");
  } finally {
    if (createdId !== undefined) await adapter.remove(createdId);
  }
});

test("a running target with a broken service path fails readiness", { skip: !enabled }, async () => {
  const root = resolve(import.meta.dirname, "../..");
  const normal = new DocksideAdapter({
    executable: resolve(root, ".crucible/upstream/dockside/cli/dockside"),
    server: "crucible-local",
    cliConfigDirectory: resolve(root, ".crucible/dockside-runner-cli"),
    operationTimeoutMs: 120_000,
    readinessTimeoutMs: 60_000,
    readinessPollMs: 2_000,
    maxOutputBytes: 262_144,
  });
  const shortReadiness = new DocksideAdapter({
    executable: resolve(root, ".crucible/upstream/dockside/cli/dockside"),
    server: "crucible-local",
    cliConfigDirectory: resolve(root, ".crucible/dockside-runner-cli"),
    operationTimeoutMs: 5_000,
    readinessTimeoutMs: 1_000,
    readinessPollMs: 250,
    maxOutputBytes: 262_144,
  });
  const name = `crucible-not-ready-${process.pid}`;
  let createdId: string | undefined;
  let containerId: string | undefined;

  try {
    const running = await normal.create({
      name,
      profile: "crucible-invoice-v1",
      image: "crucible/invoice-vulnerable:slice1",
      network: "crucible-invoice-v1",
      unixuser: "crucible",
      ide: "openvscode/1.109.5",
      access: { app: "owner", ide: "owner" },
    });
    createdId = running.id;
    containerId = running.containerId;
    assert.ok(containerId !== undefined);

    execFileSync("docker", ["network", "disconnect", "crucible-invoice-v1", containerId]);

    const failed = await shortReadiness.waitUntilReady(running.id, "app");
    assert.equal(failed.state, "failed");
    assert.equal(failed.readiness.status, "failed");
    assert.equal(failed.failure?.operation, "readiness");
    assert.equal(failed.failure?.timedOut, true);
  } finally {
    if (containerId !== undefined) {
      try {
        execFileSync("docker", ["network", "connect", "crucible-invoice-v1", containerId]);
      } catch {
        // It may already be connected or removed. Cleanup below verifies the reservation.
      }
    }
    if (createdId !== undefined) await normal.remove(createdId);
  }
});
