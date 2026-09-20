#!/usr/bin/env node
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { explainCommand, scanCommand } from "./audit/command.js";
import { errorMessage } from "./errors.js";
import { assertNewFile, clean } from "./output.js";
import { demoCommand, replayCommand, reportCommand, verifyCommand } from "./replay/command.js";

// dist/cli.js sits one level below the repository root.
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

/** Parses the command line, validates it, and runs one command. Returns the process exit code. */
async function run(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    strict: true,
    options: {
      audit: { type: "string" },
      out: { type: "string" },
      revision: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, argument] = positionals;
  if (values.help || !command) {
    console.log(help);
    return 0;
  }
  if (positionals.length > 2) throw new Error("Unexpected arguments. Run crucible --help.");
  if (values.out) await assertNewFile(values.out);

  const { out } = values;
  const json = values.json ?? false;
  switch (command) {
    case "scan":
      if (!argument) throw new Error("Provide the repository path: crucible scan ./my-app");
      return await scanCommand({ repository: argument, auditFile: values.audit, out, json });
    case "explain":
      return explainCommand(argument);
    case "demo":
      if (argument) throw new Error("demo takes no positional arguments");
      return await demoCommand({ root, out, json });
    case "replay":
      if (argument !== "invoice") throw new Error("Supported capsule: invoice");
      return await replayCommand({ root, out, json, revision: values.revision });
    case "verify":
      if (!argument) throw new Error("Provide a saved replay evidence file");
      return await verifyCommand({ root, file: argument, json });
    case "report":
      if (!argument) throw new Error("Provide a saved replay evidence file");
      return await reportCommand(argument);
    default:
      throw new Error(`Unknown command: ${clean(command)}. Run crucible --help.`);
  }
}

run().then(
  (exitCode) => {
    process.exitCode = exitCode;
  },
  (error: unknown) => {
    console.error(`Crucible: ${clean(errorMessage(error))}`);
    process.exitCode = 2;
  },
);
