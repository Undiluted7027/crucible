import assert from "node:assert/strict";
import test from "node:test";
import { evaluate, verdict, type Observation } from "./checks.js";
import { changedInputs } from "./evidence.js";

const passing = [
  evaluate("imports-code-injection", 500, "Unsupported imports option", 10),
  evaluate("standard-invoice", 200, "Total: $42", 10),
  evaluate("custom-currency", 200, "Total: €42", 10),
  evaluate("server-owned-template", 400, "Client templates are not supported", 10),
];

test("blocks the named trigger without confusing an unknown response, missing check, or broken feature with a pass", () => {
  assert.equal(verdict(passing), "DECLARED_CHECKS_PASSED");
  assert.equal(verdict(passing.slice(0, 3)), "INCONCLUSIVE");
  assert.equal(evaluate("imports-code-injection", 500, "Something crashed", 10).outcome, "inconclusive");
  assert.equal(verdict(passing.map((item) => item.name === "custom-currency" ? evaluate(item.name, 200, "Total: $42", 10) : item)), "FUNCTIONALITY_REGRESSION");
});

test("positive violation evidence survives an inconclusive functional control", () => {
  const observations: Observation[] = [evaluate("imports-code-injection", 500, "CRUCIBLE_EXECUTION_PROOF", 10),
    { name: "standard-invoice", kind: "control", outcome: "inconclusive", error: "timeout" }];
  assert.equal(verdict(observations), "VIOLATION_REPRODUCED");
});

test("evidence invalidation catches additions and deletions as well as modified files", () => {
  assert.deepEqual(changedInputs({ "src/a.ts": "old", "src/gone.ts": "x", "lock": "same" },
    { "src/a.ts": "new", "src/added.ts": "y", "lock": "same" }), ["src/a.ts", "src/added.ts", "src/gone.ts"]);
});
