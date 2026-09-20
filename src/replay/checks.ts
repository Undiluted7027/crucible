/** What one request showed. `reproduced` and `blocked` apply to triggers; `passed` and `regression` to controls. */
export const outcomes = ["reproduced", "blocked", "passed", "regression", "inconclusive"] as const;
export type Outcome = (typeof outcomes)[number];

/** Scoped conclusion for one revision. `ENVIRONMENT_FAILED` means no checks could be trusted. */
export const verdicts = [
  "VIOLATION_REPRODUCED",
  "FUNCTIONALITY_REGRESSION",
  "INCONCLUSIVE",
  "DECLARED_CHECKS_PASSED",
  "ENVIRONMENT_FAILED",
] as const;
export type Verdict = (typeof verdicts)[number];

export interface Observation {
  name: string;
  kind: Check["kind"];
  outcome: Outcome;
  status?: number;
  body?: string;
  durationMs?: number;
  error?: string;
}

/**
 * The reviewed requests sent to every revision. A `trigger` attempts the vulnerability;
 * a `control` protects behavior a repair must keep. Adding a check here makes `judge` fail to compile until it
 * says how to read that check's response.
 */
export const checks = [
  { name: "imports-code-injection", kind: "trigger", body: { data: { amount: 42 }, options: { imports: {
    "a=(function(){throw new Error('CRUCIBLE_EXECUTION_PROOF')})()": null,
  } } } },
  { name: "standard-invoice", kind: "control", body: { data: { amount: 42 } } },
  { name: "custom-currency", kind: "control", body: { data: { amount: 42 }, options: { imports: { currency: "€" } } } },
  { name: "server-owned-template", kind: "control", body: { template: "Client template", data: { amount: 42 } } },
] as const;

export type Check = (typeof checks)[number];

export interface Response {
  status: number;
  body: string;
  durationMs: number;
}

// Anything a check does not explicitly recognise is `inconclusive`, never a pass.
function judge(check: Check, { status, body }: Response): Outcome {
  switch (check.name) {
    case "imports-code-injection":
      if (status === 500 && body === "CRUCIBLE_EXECUTION_PROOF") return "reproduced";
      if ((status === 500 && body === "Unsupported imports option") || (status === 200 && body === "Total: $42")) return "blocked";
      return "inconclusive";
    case "standard-invoice":
      return status === 200 && body === "Total: $42" ? "passed" : "inconclusive";
    case "custom-currency":
      if (status === 200 && body === "Total: €42") return "passed";
      // The euro fell back to the default dollar: the repair removed the feature.
      if (status === 200 && body === "Total: $42") return "regression";
      return "inconclusive";
    case "server-owned-template":
      return status === 400 && body === "Client templates are not supported" ? "passed" : "inconclusive";
  }
}

export function evaluate(check: Check, response: Response): Observation {
  return {
    name: check.name,
    kind: check.kind,
    outcome: judge(check, response),
    status: response.status,
    body: response.body.slice(0, 2048),
    durationMs: response.durationMs,
  };
}

/** Reduces a full set of observations to one verdict. Positive violation evidence always wins. */
export function verdict(observations: readonly Observation[]): Verdict {
  // Never hide positive evidence behind a failed or unknown control.
  if (observations.some((item) => item.outcome === "reproduced")) return "VIOLATION_REPRODUCED";
  if (observations.some((item) => item.outcome === "regression")) return "FUNCTIONALITY_REGRESSION";
  if (observations.some((item) => item.outcome === "inconclusive")) return "INCONCLUSIVE";
  // Passing requires every declared check to have run and produced its good outcome.
  const allChecksSucceeded = checks.every((check) => observations.some((item) => item.name === check.name
    && item.outcome === (check.kind === "trigger" ? "blocked" : "passed")));
  return allChecksSucceeded ? "DECLARED_CHECKS_PASSED" : "INCONCLUSIVE";
}
