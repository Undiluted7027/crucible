import assert from "node:assert/strict";
import test from "node:test";
import { runChecked, runProcess } from "./process.js";

test("bounds retained command output", async () => {
  const result = await runProcess({
    command: process.execPath,
    args: ["-e", "process.stdout.write('0123456789')"],
    timeoutMs: 1_000,
    maxOutputBytes: 4,
  });
  assert.equal(result.stdout, "6789");
  assert.equal(result.outputTruncated, true);
});

test("marks a command that exceeds its deadline", async () => {
  const result = await runProcess({
    command: process.execPath,
    args: ["-e", "setTimeout(() => {}, 10_000)"],
    timeoutMs: 20,
    maxOutputBytes: 1_024,
  });
  assert.equal(result.timedOut, true);
  assert.notEqual(result.exitCode, 0);
});


test("runChecked refuses failed or truncated output instead of returning partial data", async () => {
  const request = { command: process.execPath, timeoutMs: 1_000, maxOutputBytes: 1_024 };
  assert.equal(await runChecked({ ...request, args: ["-e", "process.stdout.write('ok')"] }), "ok");
  await assert.rejects(
    runChecked({ ...request, args: ["-e", "console.error('boom'); process.exit(3)"] }),
    /exited 3\): boom/,
  );
  await assert.rejects(
    runChecked({ ...request, maxOutputBytes: 4, args: ["-e", "process.stdout.write('0123456789')"] }),
    /output exceeded its limit/,
  );
});
