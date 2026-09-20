import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runProcess } from "../dockside/process.js";
import { clean, saveJson } from "../output.js";
import { catalog } from "./catalog.js";
import { scan, type ScanReport } from "./scan.js";

/** Live registry lookup. Nothing in the repository is installed, executed, or modified. */
async function fetchNpmAudit(repository: string): Promise<unknown> {
  console.error("Fetching npm audit data (no packages or source code will be changed)...");
  const result = await runProcess({
    command: "npm",
    args: ["--prefix", repository, "audit", "--json", "--ignore-scripts"],
    timeoutMs: 60_000,
    maxOutputBytes: 8_388_608,
  });
  // npm audit exits 1 when it finds vulnerabilities; anything higher is a real failure.
  if (result.timedOut || result.outputTruncated || result.exitCode > 1) {
    throw new Error("npm audit failed or exceeded its limit. Supply a saved --audit report.");
  }
  return JSON.parse(result.stdout);
}

function printScanReport(report: ScanReport): void {
  console.log(`\nCRUCIBLE · npm audit investigation`);
  console.log(`${report.findings.length} affected packages · ${report.sourceFiles} source files inspected\n`);
  for (const finding of report.findings) {
    console.log(`${clean(finding.severity.toUpperCase()).padEnd(9)} ${clean(finding.package)} ${clean(finding.range)}`);
    for (const advisory of finding.advisories) {
      console.log(`  ${clean(advisory.id)} · ${clean(advisory.title)}`);
      const replay = advisory.capsule ? ` · curated ${advisory.capsule} replay available` : " · no reviewed replay";
      console.log(`  ${advisory.assessment}${replay}`);
      for (const site of advisory.candidates) {
        console.log(`    ${clean(site.file)}:${site.line} → ${clean(site.package)}.${clean(site.symbol)}()`);
      }
    }
    if (finding.inheritedFrom.length) {
      console.log(`  Inherited findings: ${finding.inheritedFrom.map(clean).join(", ")} · still unresolved`);
    }
    console.log();
  }
  console.log(report.scope);
  console.log("\nNext: crucible explain GHSA-r5fr-rjxr-66jc\n      crucible demo");
}

export interface ScanOptions {
  repository: string;
  /** A saved npm audit v2 report; the registry is contacted when absent. */
  auditFile: string | undefined;
  out: string | undefined;
  json: boolean;
}

/** `crucible scan`: exit 0 whenever a report was produced, even one with findings. */
export async function scanCommand({ repository, auditFile, out, json }: ScanOptions): Promise<number> {
  const root = resolve(repository);
  const audit: unknown = auditFile
    ? JSON.parse(await readFile(resolve(auditFile), "utf8"))
    : await fetchNpmAudit(root);
  const report = await scan(root, audit);
  if (out) await saveJson(out, report);
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printScanReport(report);
    if (out) console.log(`Report: ${out}`);
  }
  return 0;
}

/** `crucible explain`: exit 2 for an advisory with no reviewed explanation. */
export function explainCommand(advisoryId: string | undefined): number {
  const entry = catalog.find((item) => item.id === advisoryId);
  if (!entry) {
    console.log("UNSUPPORTED · No reviewed explanation or replay for this advisory.");
    return 2;
  }
  console.log([
    `${entry.id} · ${entry.package}`,
    "",
    entry.summary,
    "",
    "Trigger condition",
    entry.condition,
    "",
    "Next step",
    entry.action,
    "",
    `Reference: https://github.com/advisories/${entry.id}`,
    "Scope: one curated fixture; application applicability needs its own checks.",
  ].join("\n"));
  return 0;
}
