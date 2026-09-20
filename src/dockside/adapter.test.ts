import assert from "node:assert/strict";
import test from "node:test";
import { DocksideAdapter, DocksideOperationError, routesOf, snapshotOf, stateOf } from "./adapter.js";
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
  assert.equal(stateOf(1), "running");
  assert.equal(stateOf(-4), "failed");
  assert.equal(snapshotOf(reservation).readiness.status, "not-checked");
});

test("returns only access-controlled routes", () => {
  const routes = routesOf(reservation);
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

test("readiness means the health route answers 200: it keeps polling, and on timeout reports the last thing it saw", async () => {
  const healthChecks = (statuses: number[]) => async (request: ProcessRequest): Promise<ProcessResult> => {
    if (request.args.includes("check-url")) return result({ stdout: JSON.stringify({ status: statuses.shift() ?? 503 }) });
    return result({ stdout: JSON.stringify(reservation) });
  };

  const ready = await adapter(healthChecks([503, 503, 200])).waitUntilReady("invoice-1", "app");
  assert.equal(ready.state, "ready");
  assert.equal(ready.readiness.status, "ready");

  const neverHealthy = await adapter(healthChecks([])).waitUntilReady("invoice-1", "app");
  assert.equal(neverHealthy.state, "failed");
  assert.equal(neverHealthy.failure?.operation, "readiness");
  assert.equal(neverHealthy.failure?.timedOut, true);
  assert.partialDeepStrictEqual(neverHealthy.readiness, { status: "failed", reason: "health route returned HTTP 503" });
});

test("remove stops a running environment first and fails loudly if Dockside still lists it afterwards", async () => {
  const dockside = (statusAfterRemove: number) => {
    const commands: string[] = [];
    let status = 1;
    const run = async (request: ProcessRequest): Promise<ProcessResult> => {
      const command = request.args[2] ?? "";
      commands.push(command);
      if (command === "stop") status = 0;
      if (command === "remove") status = statusAfterRemove;
      return command === "list" ? result({ stdout: JSON.stringify([{ ...reservation, status }]) }) : result();
    };
    return { commands, run };
  };

  const removed = dockside(-3);
  await adapter(removed.run).remove("invoice-1");
  assert.deepEqual(removed.commands.filter((command) => command === "stop" || command === "remove"), ["stop", "remove"]);

  await assert.rejects(adapter(dockside(0).run).remove("invoice-1"), /still reports invoice-1 after removal/);
});

// A fake Dockside for removal. `statuses` are what successive `list` calls report (the last one repeats), and
// `removeResult` is what the `remove` command itself does.
function removalDockside(statuses: number[], removeResult: ProcessResult = result()) {
  const commands: string[] = [];
  const run = async (request: ProcessRequest): Promise<ProcessResult> => {
    const command = request.args[2] ?? "";
    commands.push(command);
    if (command === "list") {
      const status = statuses.length > 1 ? statuses.shift() : statuses[0];
      return result({ stdout: JSON.stringify([{ ...reservation, status }]) });
    }
    return command === "remove" ? removeResult : result();
  };
  return { commands, adapter: adapter(run) };
}

test("removal tolerates Dockside having already deleted the environment, or still finishing an earlier removal", async () => {
  // Dockside keeps listing a deleted reservation (status -3); there is nothing left to remove.
  const alreadyDeleted = removalDockside([-3]);
  await alreadyDeleted.adapter.remove("invoice-1");
  assert.ok(!alreadyDeleted.commands.includes("remove"));

  // Our command fails because Dockside is still finishing an earlier removal (still listed as stopped for a moment).
  const stillDeleting = removalDockside([0, 0, 0, -3], result({ exitCode: 1, stderr: "docker rm failed" }));
  await stillDeleting.adapter.remove("invoice-1");
});

test("removal still fails for a real error, and a timed-out removal stays a timeout even if Dockside finishes it", async () => {
  await assert.rejects(removalDockside([0], result({ exitCode: 1, stderr: "docker error" })).adapter.remove("invoice-1"), /remove failed/);

  const timedOut = removalDockside([0, -3], result({ exitCode: -1, timedOut: true }));
  await assert.rejects(timedOut.adapter.remove("invoice-1"), (error: unknown) => {
    assert.ok(error instanceof DocksideOperationError);
    assert.equal(error.failure.operation, "remove");
    assert.equal(error.failure.timedOut, true);
    return true;
  });
});
