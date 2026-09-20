import assert from "node:assert/strict";
import test from "node:test";
import { markdownReport } from "./report.js";
import { replayEvidence, revisionResult } from "./test-helpers.js";

test("text from the target cannot break out of a report table cell or inject markup", () => {
  const hostile = "</td>|<img src=x onerror=alert(1)>\nnext line";
  const vulnerable = { ...revisionResult("vulnerable", "VIOLATION_REPRODUCED"), error: hostile };
  vulnerable.observations.push({
    name: "imports-code-injection", kind: "trigger", outcome: "reproduced", status: 500, body: hostile,
  });
  const markdown = markdownReport(replayEvidence([vulnerable]));

  assert.ok(!markdown.includes("<img"), "raw HTML must be escaped");
  assert.ok(markdown.includes("&lt;img"));
  const responseRow = markdown.split("\n").find((line) => line.startsWith("| imports-code-injection"));
  assert.ok(responseRow?.includes("\\|") && responseRow.includes("next line"), "pipes escaped and newline flattened into one row");
});
