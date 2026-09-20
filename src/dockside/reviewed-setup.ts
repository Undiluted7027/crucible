import { resolve } from "node:path";
import type { CreateEnvironmentInput, DocksideAdapterConfig } from "./adapter.js";

/** Trusted Dockside container that creates and manages targets. Targets never receive its Docker socket. */
export const managerContainer = "crucible-dockside-v401";

/**
 * The one reviewed target: the invoice image, its Dockside profile, and the limits that profile applies.
 * These must match config/dockside/*.json; reviewed-setup.test.ts fails when they drift.
 */
export const invoiceTarget = {
  profile: "crucible-invoice-v1",
  network: "crucible-invoice-v1",
  image: "crucible/invoice-vulnerable:slice1",
  imageId: "sha256:cc62c7cee8a42e9abd23f77db795b15c3f726f5f7dbb2fcdeb42239c7c41e190",
  unixuser: "crucible",
  ide: "openvscode/1.109.5",
  limits: { memoryBytes: 1_073_741_824, nanoCpus: 1_000_000_000, pidsLimit: 256 },
} as const;

/** Environment variables that would mean host credentials leaked into a target. */
export const sensitiveEnvironmentPattern = /(?:TOKEN|PASSWORD|SECRET|SSH_|DOCKER_HOST)/u;

/** Dockside request for one disposable invoice target; `name` must be unique per environment. */
export function invoiceTargetRequest(name: string): CreateEnvironmentInput {
  return {
    name,
    profile: invoiceTarget.profile,
    image: invoiceTarget.image,
    network: invoiceTarget.network,
    unixuser: invoiceTarget.unixuser,
    ide: invoiceTarget.ide,
    access: { app: "owner", ide: "owner" },
  };
}

type Timeouts = Pick<DocksideAdapterConfig, "operationTimeoutMs" | "readinessTimeoutMs" | "readinessPollMs">;

/** Generous deadlines for the compatibility check and integration tests; recorded in compatibility.json. */
export const compatibilityTimeouts: Timeouts = { operationTimeoutMs: 120_000, readinessTimeoutMs: 60_000, readinessPollMs: 2_000 };

/** Tighter deadlines for a replay, which creates several targets in one run. */
export const replayTimeouts: Timeouts = { operationTimeoutMs: 60_000, readinessTimeoutMs: 20_000, readinessPollMs: 500 };

/** Adapter settings for the local Dockside installation under `<root>/.crucible`. */
export function docksideAdapterConfig(root: string, timeouts: Timeouts): DocksideAdapterConfig {
  return {
    executable: resolve(root, ".crucible/upstream/dockside/cli/dockside"),
    server: "crucible-local",
    cliConfigDirectory: resolve(root, ".crucible/dockside-runner-cli"),
    maxOutputBytes: 262_144,
    ...timeouts,
  };
}
