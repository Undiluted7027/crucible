import { z } from "zod";
import { outcomes, verdicts } from "./checks.js";

/** The curated revisions of the invoice capsule that a replay can run. */
export const revisions = ["vulnerable", "broken", "fixed"] as const;
export type Revision = (typeof revisions)[number];

const observationSchema = z.object({
  name: z.string(),
  kind: z.enum(["trigger", "control"]),
  outcome: z.enum(outcomes),
  status: z.number().optional(),
  body: z.string().optional(),
  durationMs: z.number().optional(),
  error: z.string().optional(),
});

/**
 * The saved result of a replay. `replay()` returns this type, and `verify` and `report` read it back,
 * so the file format is defined here once.
 */
export const replayEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string(),
  startedAt: z.string(),
  recordedAt: z.string(),
  durationMs: z.number(),
  cancelled: z.boolean(),
  capsule: z.literal("invoice"),
  advisory: z.string(),
  requests: z.array(z.object({ name: z.string(), kind: z.enum(["trigger", "control"]), body: z.unknown() })),
  host: z.object({ platform: z.string(), architecture: z.string(), node: z.string() }),
  scope: z.string(),
  environment: z.object({ backend: z.string(), image: z.string(), imageId: z.string(), platform: z.string(), network: z.string() }),
  // Watched files and their hashes; empty would make `verify` vacuously current.
  inputs: z.record(z.string(), z.string()).refine((items) => Object.keys(items).length > 0),
  changedDuringRun: z.array(z.string()),
  // At least one result: a run cancelled before starting must not read as "every check passed".
  results: z.array(z.object({
    revision: z.enum(revisions),
    verdict: z.enum(verdicts),
    observations: z.array(observationSchema),
    error: z.string().optional(),
    cleanup: z.boolean(),
  })).min(1),
});

export type ReplayEvidence = z.infer<typeof replayEvidenceSchema>;
