import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { replayEvidenceSchema, type ReplayEvidence } from "./schema.js";

export const watchedPaths = ["src", "capsules/invoice/replay", "config/dockside", "package.json", "package-lock.json"];

export async function fingerprint(root: string): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  async function walk(path: string): Promise<void> {
    const info = await stat(path);
    if (info.isDirectory()) {
      for (const item of await readdir(path, { withFileTypes: true })) {
        if (item.name === "node_modules" || item.name === "dist" || item.isSymbolicLink()) continue;
        await walk(resolve(path, item.name));
      }
    } else {
      hashes[relative(root, path)] = createHash("sha256").update(await readFile(path)).digest("hex");
    }
  }
  for (const path of watchedPaths) await walk(resolve(root, path));
  return hashes;
}

/** Loads saved replay evidence, rejecting files that do not match the current format. */
export async function readEvidence(path: string): Promise<ReplayEvidence> {
  return replayEvidenceSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

export function changedInputs(before: Record<string, string>, after: Record<string, string>): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((path) => before[path] !== after[path]).sort();
}
