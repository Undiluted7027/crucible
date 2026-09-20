import assert from "node:assert/strict";
import test from "node:test";
import { DocksideAdapter, DocksideOperationError, docksideInternals } from "./adapter.js";
import type { ProcessRequest, ProcessResult } from "./process.js";

const reservation = {
  id: "reservation-1",
  name: "invoice-1",
  status: 1,
  profile: "crucible-invoice-v1",
  containerId: "abc123",
  data: {
    image: "crucible/invoice-vulnerable:slice1",
    network: "crucible-invoice-v1",
    parentFQDN: ".local.dockside.dev",
    unixuser: "crucible",
    runningIDE: "openvscode/1.95.3",
  },
  meta: { access: { ide: "owner", app: "owner" } },
  profileObject: {
    routers: [
      { name: "ide", type: "ide", prefixes: ["ide"], https: { protocol: "http", port: 3000 }, auth: ["owner"] },
      { name: "app", prefixes: ["app"], https: { protocol: "http", port: 3000 }, auth: ["owner"] },
    ],
  },
};

function result(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return { exitCode: 0, stdout: "", stderr: "", timedOut: false, outputTruncated: false, ...overrides };
}

function adapter(run: (request: ProcessRequest) => Promise<ProcessResult>): DocksideAdapter {
  return new DocksideAdapter(
    {
      executable: "dockside",
      server: "crucible-local",
      cliConfigDirectory: "/tmp/test-dockside-cli",
      operationTimeoutMs: 100,
      readinessTimeoutMs: 100,
      readinessPollMs: 10,
      maxOutputBytes: 1_024,
    },
    run,
  );
}

test("maps Dockside lifecycle status without treating running as ready", () => {
  assert.equal(docksideInternals.stateOf(1), "running");
  assert.equal(docksideInternals.stateOf(-4), "failed");
  assert.equal(docksideInternals.snapshotOf(reservation).readiness.status, "not-checked");
});

test("returns only access-controlled routes", () => {
  const routes = docksideInternals.routesOf(reservation);
  assert.deepEqual(
    routes.map(({ kind, name, access }) => ({ kind, name, access })),
    [
      { kind: "ide", name: "ide", access: "owner" },
      { kind: "service", name: "app", access: "owner" },
    ],
  );
  assert.match(routes[0]?.url ?? "", /^https:\/\/ide-invoice-1/);
});

test("rejects a successful command when the observed final state is wrong", async () => {
  const run = async (request: ProcessRequest): Promise<ProcessResult> =>
    request.args.includes("list")
      ? result({ stdout: JSON.stringify([{ ...reservation, status: -2 }]) })
      : result();

  await assert.rejects(adapter(run).start("invoice-1"), (error: unknown) => {
    assert.ok(error instanceof DocksideOperationError);
    assert.match(error.message, /status -2/);
    return true;
  });
});

test("rejects malformed Dockside JSON at the adapter boundary", async () => {
  await assert.rejects(adapter(async () => result({ stdout: "not-json" })).get("invoice-1"), /malformed get output/);
});

test("returns an explicit timed-out operation failure", async () => {
  await assert.rejects(
    adapter(async () => result({ exitCode: -1, timedOut: true })).start("invoice-1"),
    (error: unknown) => {
      assert.ok(error instanceof DocksideOperationError);
      assert.equal(error.failure.operation, "start");
      assert.equal(error.failure.timedOut, true);
      return true;
    },
  );
});

test("sanitizes terminal controls in logs", async () => {
  const logs = await adapter(async () => result({ stdout: "safe\u001b[31m red\u001b[0m\u0000", outputTruncated: true })).logs("invoice-1");
  assert.deepEqual(logs, { text: "safe red", truncated: true, retainedBytes: 8 });
});
