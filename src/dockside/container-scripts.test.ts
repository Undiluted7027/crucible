import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { createServer as createTcpServer, type Server } from "node:net";
import test from "node:test";
import { postJsonScript, tcpDeniedScript } from "./container-scripts.js";
import { runProcess } from "./process.js";

// The scripts normally run in a container; here they run in this Node against a local server.
function runScript(script: string, args: readonly string[], stdin?: string) {
  return runProcess({
    command: process.execPath,
    args: ["-e", script, ...args],
    ...(stdin === undefined ? {} : { stdin }),
    timeoutMs: 5_000,
    maxOutputBytes: 65_536,
  });
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  return address.port;
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

test("the TCP probe reports success only when every target refuses the connection", async () => {
  const openServer = createTcpServer();
  const open = `127.0.0.1:${await listen(openServer)}`;
  // A port that was just released is reliably refused.
  const releasedServer = createTcpServer();
  const closed = `127.0.0.1:${await listen(releasedServer)}`;
  await close(releasedServer);

  try {
    assert.equal((await runScript(tcpDeniedScript, ["1000", closed])).exitCode, 0);
    assert.equal((await runScript(tcpDeniedScript, ["1000", open])).exitCode, 2);
    // One reachable target among refused ones still fails the probe.
    assert.equal((await runScript(tcpDeniedScript, ["1000", closed, open])).exitCode, 2);
  } finally {
    await close(openServer);
  }
});

test("the HTTP transport returns a bounded response and rejects an oversized one", async () => {
  const server = createHttpServer((request, response) => {
    response.end(request.url === "/large" ? "x".repeat(9_000) : "Total: $42");
  });
  const base = `http://127.0.0.1:${await listen(server)}`;

  try {
    const small = await runScript(postJsonScript, [], JSON.stringify({ url: `${base}/`, body: {} }));
    assert.equal(small.exitCode, 0);
    assert.partialDeepStrictEqual(JSON.parse(small.stdout), { status: 200, body: "Total: $42" });

    const large = await runScript(postJsonScript, [], JSON.stringify({ url: `${base}/large`, body: {} }));
    assert.equal(large.exitCode, 1);
    assert.match(large.stderr, /Response too large/);
  } finally {
    await close(server);
  }
});
