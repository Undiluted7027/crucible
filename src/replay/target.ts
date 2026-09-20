/**
 * What the controller does to a running invoice target through Docker: prove it is the reviewed, restricted
 * target, replace its application source with one revision, and send it a check.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import ts from "typescript";
import { z } from "zod";
import { postJsonScript, tcpDeniedScript, writeStdinToFileScript } from "../dockside/container-scripts.js";
import { runChecked } from "../dockside/process.js";
import { invoiceTarget, managerContainer, sensitiveEnvironmentPattern } from "../dockside/reviewed-setup.js";
import type { Response } from "./checks.js";
import type { Revision } from "./schema.js";

const responseSchema = z.object({ status: z.number(), body: z.string(), durationMs: z.number() });

const targetSchema = z.object({
  Image: z.string(),
  Config: z.object({ User: z.string(), Env: z.array(z.string()) }),
  Mounts: z.array(z.object({ Type: z.string(), Destination: z.string() })),
  HostConfig: z.object({
    Memory: z.number(),
    NanoCpus: z.number(),
    PidsLimit: z.number(),
    Privileged: z.boolean(),
    SecurityOpt: z.array(z.string()),
    NetworkMode: z.string(),
  }),
  NetworkSettings: z.object({ Networks: z.record(z.string(), z.object({ IPAddress: z.string() })) }),
});

export type TargetInspection = z.infer<typeof targetSchema>;

function docker(args: readonly string[], stdin?: string): Promise<string> {
  return runChecked({
    command: "docker",
    args,
    timeoutMs: 15_000,
    maxOutputBytes: 65_536,
    ...(stdin === undefined ? {} : { stdin }),
  });
}

/** Ways the target differs from the reviewed image and restricted profile. Empty means it matches. */
export function profileViolations(target: TargetInspection): string[] {
  const { limits } = invoiceTarget;
  const expectations = [
    { violation: "image is not the reviewed image", holds: target.Image === invoiceTarget.imageId },
    { violation: "does not run as the unprivileged user", holds: target.Config.User === invoiceTarget.unixuser },
    {
      violation: "has a bind mount or the Docker socket",
      holds: !target.Mounts.some((mount) => mount.Type === "bind" || mount.Destination.includes("docker.sock")),
    },
    { violation: "is privileged", holds: !target.HostConfig.Privileged },
    { violation: "is not on the reviewed network", holds: target.HostConfig.NetworkMode === invoiceTarget.network },
    { violation: "memory limit differs", holds: target.HostConfig.Memory === limits.memoryBytes },
    { violation: "CPU limit differs", holds: target.HostConfig.NanoCpus === limits.nanoCpus },
    { violation: "process limit differs", holds: target.HostConfig.PidsLimit === limits.pidsLimit },
    { violation: "may gain privileges", holds: target.HostConfig.SecurityOpt.includes("no-new-privileges:true") },
    {
      violation: "environment carries credentials",
      holds: !target.Config.Env.some((value) => sensitiveEnvironmentPattern.test(value)),
    },
  ];
  return expectations.filter(({ holds }) => !holds).map(({ violation }) => violation);
}

/**
 * Refuses to go on unless the target is the reviewed image under the restricted profile, on an internal network,
 * and cannot reach the management container or the internet. Run before any vulnerability trigger is sent.
 * Returns the target's address on that network.
 */
export async function assertRestrictedTarget(containerId: string): Promise<string> {
  const [target] = z.array(targetSchema).parse(JSON.parse(await docker(["inspect", containerId])));
  if (target === undefined) throw new Error("Docker returned no data for the target container");
  const violations = profileViolations(target);
  if (violations.length > 0) {
    throw new Error(
      `Target differs from the reviewed image or restricted profile; reproduction refused (${violations.join("; ")}).`,
    );
  }

  const address = target.NetworkSettings.Networks[invoiceTarget.network]?.IPAddress;
  if (!address || !/^\d+\.\d+\.\d+\.\d+$/.test(address)) throw new Error("Target has no expected network address");

  const internal = await docker(["network", "inspect", invoiceTarget.network, "--format", "{{.Internal}}"]);
  if (internal.trim() !== "true") throw new Error("Target network must be internal");

  const managerAddressTemplate = `{{(index .NetworkSettings.Networks "${invoiceTarget.network}").IPAddress}}`;
  const managerAddress = (await docker(["inspect", managerContainer, "--format", managerAddressTemplate])).trim();
  await docker([
    "exec", containerId, "node", "-e", tcpDeniedScript, "1200", `${managerAddress}:443`, "1.1.1.1:443",
  ]);
  return address;
}

/**
 * Replaces the target's application source with one reviewed revision. The image ships the vulnerable app; each
 * revision overwrites `server.js` and `render.js` under /workspace/dist. The capsule keeps that source as
 * TypeScript, so it is compiled here in memory. The target must be restarted for the change to take effect.
 */
export async function installRevision(containerId: string, root: string, revision: Revision): Promise<void> {
  const capsule = resolve(root, "capsules/invoice/replay");
  const files = [
    { destination: "server.js", source: "src/server.ts" },
    { destination: "render.js", source: revision === "vulnerable" ? "src/render.ts" : `patches/${revision}.ts` },
  ];
  for (const { destination, source } of files) {
    const typescript = await readFile(resolve(capsule, source), "utf8");
    const { outputText: javascript } = ts.transpileModule(typescript, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    });
    await docker(
      ["exec", "-i", "--user", invoiceTarget.unixuser, containerId, "node", "-e", writeStdinToFileScript,
        `/workspace/dist/${destination}`],
      javascript,
    );
  }
}

/**
 * Sends one check's request to the target and returns what came back. The request is made from the trusted
 * management container, never the target, and only a bounded response is read.
 */
export async function sendCheck(address: string, body: unknown): Promise<Response> {
  const stdout = await docker(
    ["exec", "-i", managerContainer, "node", "-e", postJsonScript],
    JSON.stringify({ url: `http://${address}:3000/invoices/preview`, body }),
  );
  return responseSchema.parse(JSON.parse(stdout));
}

/** The Docker-level operations a replay performs on a target. `replay()` accepts substitutes so tests need no Docker. */
export const dockerTarget = { assertRestrictedTarget, installRevision, sendCheck };
export type TargetOperations = typeof dockerTarget;
