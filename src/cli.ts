#!/usr/bin/env node
import { readFile, mkdir, writeFile, lstat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { catalog } from "./audit/catalog.js";
import { scan } from "./audit/scan.js";
import { runProcess } from "./dockside/process.js";
import type { Verdict } from "./replay/checks.js";
import { changedInputs, fingerprint, readEvidence } from "./replay/evidence.js";
import { markdownReport } from "./replay/report.js";
import { replay } from "./replay/runner.js";
import { revisions, type Revision } from "./replay/schema.js";

const root = resolve(import.meta.dirname, "..");
const help = `
CRUCIBLE — turn an audit warning into an experiment

  crucible scan <repo> [--audit audit.json] [--json] [--out report.json]
  crucible explain GHSA-r5fr-rjxr-66jc
  crucible demo [--json] [--out evidence.json]
  crucible replay invoice [--revision vulnerable|broken|fixed] [--out evidence.json]
  crucible verify <evidence.json> [--json]
  crucible report <evidence.json>

scan     Read npm audit v2 and locate supported ES-module call-site candidates.
         Without --audit, contact the repository's configured npm registry.
demo     Run all three curated invoice revisions through the existing Dockside setup.
replay   Run one curated revision. This does NOT execute the scanned repository.
verify   Check watched-input hashes and the saved gate result; does not rerun checks.
report   Print a shareable Markdown report from saved replay evidence.

Exit codes: 0 completed scan / expected demo / current passing replay;
            1 violation, regression, or changed inputs; 2 error or needs review.
No score, no automatic dismissals, no whole-application safety claim.
`;

function clean(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
}

async function save(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(resolve(path)), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({ allowPositionals: true, strict: true, options: {
    audit: { type: "string" }, out: { type: "string" }, revision: { type: "string" },
    json: { type: "boolean" }, help: { type: "boolean", short: "h" },
  } });
  const [command, argument] = positionals;
  if (values.help || !command) { console.log(help); return; }
  if (positionals.length > 2) throw new Error("Unexpected arguments. Run crucible --help.");
  if (values.out && await lstat(values.out).then(() => true, (error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  })) throw new Error("Output file already exists; choose a new --out path to preserve evidence.");
  if (command === "scan") {
    if (!argument) throw new Error("Provide the repository path: crucible scan ./my-app");
    let input: unknown;
    if (values.audit) input = JSON.parse(await readFile(resolve(values.audit), "utf8"));
    else {
      console.error("Fetching npm audit data (no packages or source code will be changed)...");
      const result = await runProcess({ command: "npm", args: ["--prefix", resolve(argument), "audit", "--json", "--ignore-scripts"], timeoutMs: 60_000, maxOutputBytes: 8_388_608 });
      if (result.timedOut || result.outputTruncated || result.exitCode > 1) throw new Error("npm audit failed or exceeded its limit. Supply a saved --audit report.");
      input = JSON.parse(result.stdout);
    }
    const report = await scan(resolve(argument), input);
    if (values.out) await save(values.out, report);
    if (values.json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`\nCRUCIBLE · npm audit investigation\n${report.findings.length} affected packages · ${report.sourceFiles} source files inspected\n`);
      for (const finding of report.findings) {
        console.log(`${clean(finding.severity.toUpperCase()).padEnd(9)} ${clean(finding.package)} ${clean(finding.range)}`);
        for (const advisory of finding.advisories) {
          console.log(`  ${clean(advisory.id)} · ${clean(advisory.title)}`);
          console.log(`  ${advisory.assessment}${advisory.capsule ? ` · curated ${advisory.capsule} replay available` : " · no reviewed replay"}`);
          for (const site of advisory.candidates) console.log(`    ${clean(site.file)}:${site.line} → ${clean(site.package)}.${clean(site.symbol)}()`);
        }
        if (finding.inheritedFrom.length) console.log(`  Inherited findings: ${finding.inheritedFrom.map(clean).join(", ")} · still unresolved`);
        console.log();
      }
      console.log(report.scope);
      console.log("\nNext: crucible explain GHSA-r5fr-rjxr-66jc\n      crucible demo");
      if (values.out) console.log(`Report: ${values.out}`);
    }
    return;
  }
  if (command === "explain") {
    const entry = catalog.find((item) => item.id === argument);
    if (!entry) { console.log("UNSUPPORTED · No reviewed explanation or replay for this advisory."); process.exitCode = 2; return; }
    console.log(`${entry.id} · ${entry.package}\n\n${entry.summary}\n\nTrigger condition\n${entry.condition}\n\nNext step\n${entry.action}\n\nReference: https://github.com/advisories/${entry.id}\nScope: one curated fixture; application applicability needs its own checks.`);
    return;
  }
  if (command === "demo" || command === "replay") {
    if (command === "demo" && argument) throw new Error("demo takes no positional arguments");
    if (command === "replay" && argument !== "invoice") throw new Error("Supported capsule: invoice");
    const revision = z.enum(revisions).parse(values.revision ?? "vulnerable");
    const output = values.out ?? resolve(root, "evidence/replays", `${Date.now()}.json`);
    const report = await replay(root, command === "demo" ? revisions : [revision], (message) => console.error(`  ${message}`));
    await save(output, report);
    if (values.json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log("\nCRUCIBLE · observed outcomes\n");
      for (const result of report.results) {
        console.log(`${result.revision.padEnd(12)} ${result.verdict}`);
        for (const observation of result.observations) console.log(`  ${observation.name.padEnd(24)} ${observation.outcome}`);
        if (result.error) console.log(`  ${clean(result.error)}`);
      }
      console.log(`\n${report.scope}\nEvidence: ${output}`);
    }
    if (report.cancelled || report.changedDuringRun.length || report.results.some((result) => !result.cleanup)) { process.exitCode = 2; return; }
    if (command === "demo") {
      const expected: Record<Revision, Verdict> = {
        vulnerable: "VIOLATION_REPRODUCED", broken: "FUNCTIONALITY_REGRESSION", fixed: "DECLARED_CHECKS_PASSED",
      };
      process.exitCode = report.results.length === 3 && report.results.every((result) => result.verdict === expected[result.revision]) ? 0 : 2;
      if (!values.json) console.log(process.exitCode === 0 ? "\nDemo matched all three expected outcomes. This is not an application security gate." : "\nDemo did not match expectations; inspect the evidence.");
    } else {
      const result = report.results[0]?.verdict;
      process.exitCode = result === "DECLARED_CHECKS_PASSED" ? 0 : result === "VIOLATION_REPRODUCED" || result === "FUNCTIONALITY_REGRESSION" ? 1 : 2;
    }
    return;
  }
  if (command === "verify") {
    if (!argument) throw new Error("Provide a saved replay evidence file");
    const evidence = await readEvidence(argument);
    const changed = changedInputs(evidence.inputs, await fingerprint(root));
    const status = changed.length || evidence.changedDuringRun.length ? "EVIDENCE_STALE"
      : evidence.results.every((item) => item.cleanup && item.verdict === "DECLARED_CHECKS_PASSED") ? "CURRENT_DECLARED_CHECKS_PASSED" : "CURRENT_REQUIRES_REVIEW";
    if (values.json) console.log(JSON.stringify({ status, changed, note: "Hashes detect changed files, not malicious evidence tampering or changes in a live environment." }, null, 2));
    else console.log(`${status}\n${changed.map((path) => `  changed: ${path}`).join("\n")}\nVerification checks saved input hashes; it does not execute the experiment or attest the live environment.`);
    process.exitCode = status === "CURRENT_DECLARED_CHECKS_PASSED" ? 0 : status === "EVIDENCE_STALE" ? 1 : 2;
    return;
  }
  if (command === "report") {
    if (!argument) throw new Error("Provide a saved replay evidence file");
    console.log(markdownReport(await readEvidence(argument)));
    return;
  }
  throw new Error(`Unknown command: ${clean(command)}. Run crucible --help.`);
}

main().catch((error: unknown) => {
  console.error(`Crucible: ${clean(error instanceof Error ? error.message : String(error))}`);
  process.exitCode = 2;
});
