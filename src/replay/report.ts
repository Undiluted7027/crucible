import type { ReplayEvidence } from "./schema.js";

/** Makes untrusted text (target responses, errors) safe inside a Markdown table cell. */
function cell(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replaceAll("|", "\\|").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** A shareable Markdown summary of a saved run. Describes what happened; it is not a new execution or attestation. */
export function markdownReport(report: ReplayEvidence): string {
  const lines = ["# Crucible replay evidence", "", `Run: ${cell(report.runId)}  `, `Recorded: ${cell(report.recordedAt)}`, "",
    `Advisory: ${cell(report.advisory)}`, "", report.scope, "", "| Revision | Observed result | Target removed |", "| --- | --- | --- |"];
  for (const result of report.results) lines.push(`| ${cell(result.revision)} | ${cell(result.verdict)} | ${result.cleanup ? "Yes" : "NO"} |`);
  for (const result of report.results) {
    lines.push("", `## ${cell(result.revision)}`, "", "| Check | Outcome | HTTP | Response |", "| --- | --- | --- | --- |");
    for (const observation of result.observations) lines.push(`| ${cell(observation.name)} | ${cell(observation.outcome)} | ${observation.status ?? "—"} | ${cell(observation.body ?? "No recognized response")} |`);
    if (result.error) lines.push("", `Error: ${cell(result.error)}`);
  }
  lines.push("", `Environment: ${cell(report.environment.backend)} · ${cell(report.environment.imageId)}`, "",
    "This report describes a past execution. Use `crucible verify <evidence.json>` to check for changed watched inputs. Verification is not a new execution, a tamper-proof attestation, or a check of the current Docker environment.");
  return lines.join("\n");
}
