import assert from "node:assert/strict";
import test from "node:test";
import { runProcess } from "./process.js";

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

