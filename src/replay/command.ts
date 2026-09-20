import { resolve } from "node:path";
import { z } from "zod";
import { clean, saveJson } from "../output.js";
import { changedInputs, fingerprint, readEvidence } from "./evidence.js";
import { demoExitCode, isTrustedRun, replayExitCode, verifyExitCode, verifyStatus } from "./gate.js";
import { markdownReport } from "./report.js";
import { replay } from "./runner.js";
import { revisions, type ReplayEvidence, type Revision } from "./schema.js";

interface ReplayOptions {
  /** Repository root, used to locate the Dockside installation and the watched inputs. */
  root: string;
  /** Evidence file to create; defaults to a timestamped file under evidence/replays. */
  out: string | undefined;
  json: boolean;
}

function printObservedOutcomes(report: ReplayEvidence, evidenceFile: string): void {
  console.log("\nCRUCIBLE · observed outcomes\n");
  for (const result of report.results) {
    console.log(`${result.revision.padEnd(12)} ${result.verdict}`);
    for (const observation of result.observations) {
      console.log(`  ${observation.name.padEnd(24)} ${observation.outcome}`);
    }
    if (result.error) console.log(`  ${clean(result.error)}`);
  }
  console.log(`\n${report.scope}\nEvidence: ${evidenceFile}`);
}

/** Runs the selected revisions, saves the evidence, and prints it. Exit codes are decided by the caller. */
async function runAndSave(selected: readonly Revision[], { root, out, json }: ReplayOptions): Promise<ReplayEvidence> {
  const evidenceFile = out ?? resolve(root, "evidence/replays", `${Date.now()}.json`);
  const report = await replay(root, selected, (message) => console.error(`  ${message}`));
  await saveJson(evidenceFile, report);
  if (json) console.log(JSON.stringify(report, null, 2));
  else printObservedOutcomes(report, evidenceFile);
  return report;
}

/** `crucible demo`: all three curated revisions. */
export async function demoCommand(options: ReplayOptions): Promise<number> {
  const report = await runAndSave(revisions, options);
  const exitCode = demoExitCode(report);
  // An untrustworthy run has nothing meaningful to say about the expected outcomes.
  if (!options.json && isTrustedRun(report)) {
    console.log(exitCode === 0
      ? "\nDemo matched all three expected outcomes. This is not an application security gate."
      : "\nDemo did not match expectations; inspect the evidence.");
  }
  return exitCode;
}

/** `crucible replay invoice`: one revision, the supported security gate. */
export async function replayCommand(options: ReplayOptions & { revision: string | undefined }): Promise<number> {
  const revision = z.enum(revisions).parse(options.revision ?? "vulnerable");
  return replayExitCode(await runAndSave([revision], options));
}

/** `crucible verify`: compares saved input hashes with the files now. Does not rerun anything. */
export async function verifyCommand({ root, file, json }: { root: string; file: string; json: boolean }): Promise<number> {
  const evidence = await readEvidence(file);
  const changed = changedInputs(evidence.inputs, await fingerprint(root));
  const status = verifyStatus(evidence, changed);
  if (json) {
    console.log(JSON.stringify({
      status,
      changed,
      note: "Hashes detect changed files, not malicious evidence tampering or changes in a live environment.",
    }, null, 2));
  } else {
    console.log(`${status}\n${changed.map((path) => `  changed: ${path}`).join("\n")}\n`
      + "Verification checks saved input hashes; it does not execute the experiment or attest the live environment.");
  }
  return verifyExitCode(status);
}

/** `crucible report`: a shareable Markdown rendering of saved evidence. */
export async function reportCommand(file: string): Promise<number> {
  console.log(markdownReport(await readEvidence(file)));
  return 0;
}
