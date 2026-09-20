import assert from "node:assert/strict";
import test from "node:test";
import { checks, evaluate, verdict, type Observation } from "./checks.js";
import { changedInputs } from "./evidence.js";

const [injection, standard, currency, serverTemplate] = checks;
const respond = (status: number, body: string) => ({ status, body, durationMs: 10 });

const passing = [
  evaluate(injection, respond(500, "Unsupported imports option")),
  evaluate(standard, respond(200, "Total: $42")),
  evaluate(currency, respond(200, "Total: €42")),
  evaluate(serverTemplate, respond(400, "Client templates are not supported")),
];

test("blocks the named trigger without confusing an unknown response, missing check, or broken feature with a pass", () => {
  assert.equal(verdict(passing), "DECLARED_CHECKS_PASSED");
  assert.equal(verdict(passing.slice(0, 3)), "INCONCLUSIVE");
  assert.equal(evaluate(injection, respond(500, "Something crashed")).outcome, "inconclusive");
  const euroFellBackToDollar = evaluate(currency, respond(200, "Total: $42"));
  assert.equal(verdict(passing.map((item) => item.name === currency.name ? euroFellBackToDollar : item)), "FUNCTIONALITY_REGRESSION");
});

test("positive violation evidence survives an inconclusive functional control", () => {
  const observations: Observation[] = [evaluate(injection, respond(500, "CRUCIBLE_EXECUTION_PROOF")),
    { name: standard.name, kind: "control", outcome: "inconclusive", error: "timeout" }];
  assert.equal(verdict(observations), "VIOLATION_REPRODUCED");
});

test("evidence invalidation catches additions and deletions as well as modified files", () => {
  assert.deepEqual(changedInputs({ "src/a.ts": "old", "src/gone.ts": "x", "lock": "same" },
    { "src/a.ts": "new", "src/added.ts": "y", "lock": "same" }), ["src/a.ts", "src/added.ts", "src/gone.ts"]);
});
