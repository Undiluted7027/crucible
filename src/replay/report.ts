import { z } from "zod";

const reportSchema = z.object({
  schemaVersion: z.literal(1), runId: z.string(), recordedAt: z.string(), scope: z.string(), advisory: z.string(),
  environment: z.object({ imageId: z.string(), backend: z.string() }),
  results: z.array(z.object({ revision: z.string(), verdict: z.string(), cleanup: z.boolean(), error: z.string().optional(),
    observations: z.array(z.object({ name: z.string(), outcome: z.string(), status: z.number().optional(), body: z.string().optional() })) })),
});

function cell(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replaceAll("|", "\\|").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function markdownReport(input: unknown): string {
  const report = reportSchema.parse(input);
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
