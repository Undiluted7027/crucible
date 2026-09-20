export interface Observation {
  name: string;
  kind: "trigger" | "control";
  outcome: "reproduced" | "blocked" | "passed" | "regression" | "inconclusive";
  status?: number;
  body?: string;
  durationMs?: number;
  error?: string;
}

export const checks = [
  { name: "imports-code-injection", kind: "trigger", body: { data: { amount: 42 }, options: { imports: {
    "a=(function(){throw new Error('CRUCIBLE_EXECUTION_PROOF')})()": null,
  } } } },
  { name: "standard-invoice", kind: "control", body: { data: { amount: 42 } } },
  { name: "custom-currency", kind: "control", body: { data: { amount: 42 }, options: { imports: { currency: "€" } } } },
  { name: "server-owned-template", kind: "control", body: { template: "Client template", data: { amount: 42 } } },
] as const;

export function evaluate(name: string, status: number, body: string, durationMs: number): Observation {
  let outcome: Observation["outcome"] = "inconclusive";
  const kind = name === "imports-code-injection" ? "trigger" : "control";
  if (kind === "trigger") {
    if (status === 500 && body === "CRUCIBLE_EXECUTION_PROOF") outcome = "reproduced";
    else if ((status === 500 && body === "Unsupported imports option") || (status === 200 && body === "Total: $42")) outcome = "blocked";
  } else if (name === "standard-invoice") {
    if (status === 200 && body === "Total: $42") outcome = "passed";
  } else if (name === "custom-currency") {
    if (status === 200 && body === "Total: €42") outcome = "passed";
    else if (status === 200 && body === "Total: $42") outcome = "regression";
  } else if (name === "server-owned-template") {
    if (status === 400 && body === "Client templates are not supported") outcome = "passed";
  }
  return { name, kind, outcome, status, body: body.slice(0, 2048), durationMs };
}

export function verdict(observations: readonly Observation[]): string {
  // Never hide positive evidence behind a failed or unknown control.
  if (observations.some((item) => item.outcome === "reproduced")) return "VIOLATION_REPRODUCED";
  if (observations.some((item) => item.outcome === "regression")) return "FUNCTIONALITY_REGRESSION";
  if (observations.some((item) => item.outcome === "inconclusive")) return "INCONCLUSIVE";
  if (checks.some((check) => !observations.some((item) => item.name === check.name && item.kind === check.kind
    && item.outcome === (check.kind === "trigger" ? "blocked" : "passed")))) return "INCONCLUSIVE";
  return "DECLARED_CHECKS_PASSED";
}
