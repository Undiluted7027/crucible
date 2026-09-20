/**
 * `npm run dockside:verify`: proves this machine's Dockside installation can host the reviewed invoice target
 * safely, then records what it observed in evidence/dockside/slice-1-compatibility.json.
 *
 * It needs the prepared installation described in docs/dockside-local.md and creates and removes real containers,
 * networks and (briefly) a Docker image tag. Every check throws on failure, so reaching the end means all held.
 * Not to be confused with `crucible verify`, which only compares saved replay evidence with the files on disk.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { DocksideAdapter, DocksideOperationError } from "../dockside/adapter.js";
import { internetDeniedScript, pathAbsentScript, tcpDeniedScript } from "../dockside/container-scripts.js";
import { runChecked, runProcess } from "../dockside/process.js";
import {
  compatibilityTimeouts, docksideAdapterConfig, invoiceTarget, invoiceTargetRequest, managerContainer,
  sensitiveEnvironmentPattern,
} from "../dockside/reviewed-setup.js";
import { docksideReservationListSchema } from "../dockside/schema.js";

const root = resolve(import.meta.dirname, "../..");
const adapterConfig = docksideAdapterConfig(root, compatibilityTimeouts);
const { network: targetNetwork, image: targetImage } = invoiceTarget;
const unrelatedNetwork = "crucible-unrelated-probe-v1";
const unrelatedContainer = "crucible-unrelated-probe";
const expectedDocksideImageId = "sha256:876acbdf7152d51c732b41acaf9addabadfcbb6bde3d2d7e8c7b2361a8da3c12";
// Seen by the Dockside container at /data/containment/host-secret, and never by a target.
const hostSecretPath = resolve(root, ".crucible/dockside-data/containment/host-secret");
const hostSecretPathInContainers = "/data/containment/host-secret";
const evidencePath = resolve(root, "evidence/dockside/slice-1-compatibility.json");

const containerSchema = z.array(
  z.object({
    Id: z.string(),
    Image: z.string(),
    Config: z.object({
      Env: z.array(z.string()).nullable(),
      User: z.string(),
      Labels: z.record(z.string(), z.string()).nullable(),
    }),
    HostConfig: z.object({
      Binds: z.array(z.string()).nullable(),
      CapDrop: z.array(z.string()).nullable(),
      Memory: z.number(),
      MemorySwap: z.number(),
      NanoCpus: z.number(),
      NetworkMode: z.string(),
      PidsLimit: z.number().nullable(),
      SecurityOpt: z.array(z.string()).nullable(),
    }),
    Mounts: z.array(z.object({ Type: z.string(), Source: z.string(), Destination: z.string(), RW: z.boolean() })),
    State: z.object({ Running: z.boolean(), Status: z.string() }),
  }),
);

const networkSchema = z.array(
  z.object({
    Internal: z.boolean(),
    IPAM: z.object({ Config: z.array(z.object({ Subnet: z.string().optional(), Gateway: z.string().optional() })) }),
    Containers: z.record(z.string(), z.object({ Name: z.string(), IPv4Address: z.string() })),
  }),
);

type ContainerInspection = z.infer<typeof containerSchema>[number];
type NetworkInspection = z.infer<typeof networkSchema>[number];

// ---- Running commands -------------------------------------------------------------------------------------------

/** Runs a command that must succeed and returns its stdout. */
function run(command: string, args: readonly string[]): Promise<string> {
  return runChecked({ command, args, timeoutMs: 15_000, maxOutputBytes: 262_144 });
}

async function inspectContainer(nameOrId: string): Promise<ContainerInspection> {
  const [container] = containerSchema.parse(JSON.parse(await run("docker", ["inspect", nameOrId])));
  assert.ok(container !== undefined, `docker inspect returned nothing for ${nameOrId}`);
  return container;
}

async function inspectNetwork(name: string): Promise<NetworkInspection> {
  const [network] = networkSchema.parse(JSON.parse(await run("docker", ["network", "inspect", name])));
  assert.ok(network !== undefined, `docker network inspect returned nothing for ${name}`);
  return network;
}

/** The address a container has on a network, without the subnet suffix. */
function addressOn(network: NetworkInspection, containerName: string): string {
  const endpoint = Object.values(network.Containers).find(({ Name }) => Name === containerName);
  const address = endpoint?.IPv4Address.split("/")[0];
  assert.ok(address !== undefined && address !== "", `${containerName} has no address on the network`);
  return address;
}

/**
 * Runs a probe script inside a container and reports whether the action was denied.
 * A probe that fails to run counts as not denied, so a broken probe cannot pass.
 */
async function isDenied(containerId: string, script: string, args: readonly string[] = []): Promise<boolean> {
  const result = await runProcess({
    command: "docker",
    args: ["exec", containerId, "node", "-e", script, ...args],
    timeoutMs: 8_000,
    maxOutputBytes: 16_384,
  });
  return result.exitCode === 0 && !result.timedOut;
}

/** Containers labelled as owned by Crucible. Compared before and after to prove nothing leaked. */
async function resourceInventory(): Promise<readonly string[]> {
  const output = await run("docker", [
    "ps", "-a", "--filter", "label=owner.username=crucible", "--format", "{{.ID}} {{.Names}} {{.Status}}",
  ]);
  return output.trim() === "" ? [] : output.trim().split("\n").sort();
}

async function reservationExists(name: string): Promise<boolean> {
  const result = await runProcess({
    command: adapterConfig.executable,
    args: ["--server", adapterConfig.server, "list", "--output", "json"],
    timeoutMs: 10_000,
    maxOutputBytes: 262_144,
    env: { ...process.env, DOCKSIDE_CLI_CONFIG: adapterConfig.cliConfigDirectory },
  });
  if (result.exitCode !== 0 || result.timedOut) throw new Error(`Could not inspect Dockside reservations: ${result.stderr}`);
  return docksideReservationListSchema.parse(JSON.parse(result.stdout)).some((item) => item.name === name);
}

async function waitForReservationRemoved(name: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (await reservationExists(name)) {
    assert.ok(Date.now() < deadline, `Dockside still lists ${name} after ${timeoutMs}ms`);
    await delay(1_000);
  }
}

async function removeUnrelatedProbeResources(): Promise<void> {
  for (const args of [["container", "rm", "--force", unrelatedContainer], ["network", "rm", unrelatedNetwork]]) {
    await runProcess({ command: "docker", args, timeoutMs: 10_000, maxOutputBytes: 16_384 });
  }
}

// ---- Environments created by this run ---------------------------------------------------------------------------

/** Environments created and not yet removed. `main` removes any left behind when a check fails. */
const liveEnvironments = new Set<string>();

async function createTarget(adapter: DocksideAdapter, name: string) {
  const environment = await adapter.create(invoiceTargetRequest(name));
  liveEnvironments.add(environment.id);
  return environment;
}

async function removeTarget(adapter: DocksideAdapter, id: string): Promise<void> {
  await adapter.remove(id);
  liveEnvironments.delete(id);
}

// ---- Checks, in the order they run ------------------------------------------------------------------------------

/** The pinned Dockside server and CLI are installed and running, and the target network is internal. */
async function checkInstallation() {
  const dockside = await inspectContainer(managerContainer);
  assert.equal(dockside.Image, expectedDocksideImageId);
  assert.equal(dockside.State.Running, true);
  const serverVersion = (await run("docker", ["exec", managerContainer, "cat", "/etc/service/nginx/data/version"])).trim();
  const cliVersion = (await run(adapterConfig.executable, ["--version"])).trim();
  assert.equal(serverVersion, "v4.0.1 (c583421)");
  assert.equal(cliVersion, "dockside 0.2.0");

  const network = await inspectNetwork(targetNetwork);
  assert.equal(network.Internal, true);
  return {
    managerAddress: addressOn(network, managerContainer),
    internalNetwork: network.Internal,
    evidence: {
      tag: "v4.0.1",
      revision: "c5834215605e4230f9c1f6b576fd8f49b5a71629",
      reportedVersion: serverVersion,
      cliVersion,
      imageId: dockside.Image,
      containerId: dockside.Id,
    },
  };
}

function hasDockerSocket(target: ContainerInspection): boolean {
  return target.Mounts.some(({ Destination }) => Destination === "/var/run/docker.sock");
}

function hasCredentialEnvironment(target: ContainerInspection): boolean {
  return (target.Config.Env ?? []).some((entry) => sensitiveEnvironmentPattern.test(entry));
}

/** The running target has exactly the restricted profile: limits, capabilities, mounts, and no credentials. */
function assertRestrictedConfiguration(target: ContainerInspection): void {
  const { limits } = invoiceTarget;
  assert.equal(target.Image, invoiceTarget.imageId);
  assert.equal(target.Config.User, invoiceTarget.unixuser);
  assert.equal(target.HostConfig.NetworkMode, targetNetwork);
  assert.equal(target.HostConfig.Memory, limits.memoryBytes);
  assert.equal(target.HostConfig.MemorySwap, limits.memoryBytes);
  assert.equal(target.HostConfig.NanoCpus, limits.nanoCpus);
  assert.equal(target.HostConfig.PidsLimit, limits.pidsLimit);
  assert.equal(target.HostConfig.Binds, null);
  assert.ok(target.HostConfig.SecurityOpt?.includes("no-new-privileges:true"));
  assert.deepEqual(
    [...(target.HostConfig.CapDrop ?? [])].sort(),
    ["CAP_AUDIT_WRITE", "CAP_MKNOD", "CAP_NET_RAW", "CAP_SETFCAP"].sort(),
  );
  assert.equal(hasDockerSocket(target), false);
  assert.equal(target.Mounts.some(({ Type }) => Type === "bind"), false);
  assert.equal(hasCredentialEnvironment(target), false);
}

/**
 * From inside the target, the host secret is invisible and the internet, the Dockside management container, and an
 * unrelated target on another internal network are all unreachable. Creates the unrelated target and the secret for
 * the probes and removes both afterwards.
 */
async function probeContainment(containerId: string, managerAddress: string) {
  await mkdir(dirname(hostSecretPath), { recursive: true });
  await writeFile(hostSecretPath, randomBytes(32), { mode: 0o600 });
  try {
    await run("docker", [
      "network", "create", "--internal", "--label", "dev.crucible.owner=compatibility-probe", unrelatedNetwork,
    ]);
    // A listener the target could reach only if the networks were not isolated from each other.
    const listener = "require('node:net').createServer(() => {}).listen(4040); setInterval(() => {}, 10000)";
    await run("docker", [
      "run", "--detach", "--name", unrelatedContainer, "--network", unrelatedNetwork, "--entrypoint", "node",
      targetImage, "-e", listener,
    ]);
    const unrelatedAddress = addressOn(await inspectNetwork(unrelatedNetwork), unrelatedContainer);

    const probes = {
      cannotReadHostSecret: await isDenied(containerId, pathAbsentScript, [hostSecretPathInContainers]),
      cannotReachInternet: await isDenied(containerId, internetDeniedScript),
      cannotReachManagement: await isDenied(containerId, tcpDeniedScript, ["2500", `${managerAddress}:443`]),
      cannotReachUnrelatedTarget: await isDenied(containerId, tcpDeniedScript, ["2500", `${unrelatedAddress}:4040`]),
    };
    assert.deepEqual(Object.values(probes), [true, true, true, true], `containment probe failed: ${JSON.stringify(probes)}`);
    return probes;
  } finally {
    await removeUnrelatedProbeResources();
    await unlink(hostSecretPath).catch((error: unknown) => {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    });
  }
}

/**
 * The happy path: a target starts, becomes ready, is not reachable anonymously, has the restricted configuration
 * and containment, and survives stop, start and removal.
 */
async function checkRunningTarget(adapter: DocksideAdapter, name: string, managerAddress: string) {
  const running = await createTarget(adapter, name);
  assert.ok(running.containerId !== undefined);
  const { containerId } = running;
  const ready = await adapter.waitUntilReady(running.id, "app");

  const applicationRoute = ready.routes.find((route) => route.name === "app");
  const ideRoute = ready.routes.find((route) => route.kind === "ide");
  assert.ok(applicationRoute !== undefined);
  assert.ok(ideRoute !== undefined);
  const anonymousStatus = async (url: string) => Number((await run("curl", [
    "--insecure", "--silent", "--output", "/dev/null", "--write-out", "%{http_code}", url,
  ])).trim());
  const anonymousRouteStatus = {
    application: await anonymousStatus(applicationRoute.url),
    ide: await anonymousStatus(ideRoute.url),
  };
  assert.notEqual(anonymousRouteStatus.application, 200);
  assert.notEqual(anonymousRouteStatus.ide, 200);

  const target = await inspectContainer(containerId);
  assertRestrictedConfiguration(target);
  const probes = await probeContainment(containerId, managerAddress);

  const logs = await adapter.logs(running.id);
  const stopped = await adapter.stop(running.id);
  const restarted = await adapter.start(running.id);
  await removeTarget(adapter, running.id);

  return {
    target: {
      capsule: "invoice-lodash-template-imports",
      reservationId: running.id,
      containerId,
      image: targetImage,
      imageId: target.Image,
      profile: running.profile,
      network: running.network,
      routes: ready.routes,
      anonymousRouteStatus,
    },
    lifecycle: {
      createdState: running.state,
      readiness: ready.readiness,
      stoppedState: stopped.state,
      restartedState: restarted.state,
      removed: true,
      logBytesRetained: logs.retainedBytes,
      logsTruncated: logs.truncated,
    },
    containment: {
      noBindMounts: target.HostConfig.Binds === null,
      noDockerSocket: !hasDockerSocket(target),
      noSensitiveEnvironment: !hasCredentialEnvironment(target),
      ...probes,
    },
  };
}

/** A target that is running but cannot serve is reported as a failed readiness timeout, not as ready. */
async function checkReadinessTimeout(adapter: DocksideAdapter, shortDeadlineAdapter: DocksideAdapter, name: string) {
  const environment = await createTarget(adapter, `${name}-not-ready`);
  assert.ok(environment.containerId !== undefined);
  await run("docker", ["network", "disconnect", targetNetwork, environment.containerId]);
  const failed = await shortDeadlineAdapter.waitUntilReady(environment.id, "app");
  assert.equal(failed.state, "failed");
  assert.equal(failed.readiness.status, "failed");
  assert.equal(failed.failure?.operation, "readiness");
  assert.equal(failed.failure?.timedOut, true);
  await run("docker", ["network", "connect", targetNetwork, environment.containerId]);
  await removeTarget(adapter, environment.id);
}

/**
 * A missing target image makes Dockside's create fail explicitly, and Dockside then cleans up its reservation.
 * The image tag is removed and restored, even if the check fails.
 */
async function checkFailedLaunch(adapter: DocksideAdapter, name: string) {
  const failedLaunchName = `${name}-failed-launch`;
  const backupImage = "crucible/invoice-vulnerable:compatibility-backup";
  await run("docker", ["image", "tag", targetImage, backupImage]);
  await run("docker", ["image", "rm", targetImage]);
  try {
    await assert.rejects(adapter.create(invoiceTargetRequest(failedLaunchName)), (error: unknown) => {
      assert.ok(error instanceof DocksideOperationError);
      assert.equal(error.failure.operation, "create");
      return true;
    });
  } finally {
    await run("docker", ["image", "tag", backupImage, targetImage]);
    await run("docker", ["image", "rm", backupImage]);
  }
  await waitForReservationRemoved(failedLaunchName, 45_000);
}

/** Stop and remove that overrun the controller's deadline fail with an explicit timeout, and can then be finished. */
async function checkOperationTimeouts(adapter: DocksideAdapter, shortDeadlineAdapter: DocksideAdapter, name: string) {
  const expectTimeout = (operation: "stop" | "remove") => (error: unknown) => {
    assert.ok(error instanceof DocksideOperationError);
    assert.equal(error.failure.operation, operation);
    assert.equal(error.failure.timedOut, true);
    return true;
  };
  const environment = await createTarget(adapter, `${name}-timeouts`);
  await assert.rejects(shortDeadlineAdapter.stop(environment.id), expectTimeout("stop"));
  // The timed-out stop may still have completed in Dockside.
  if ((await adapter.get(environment.id)).state === "running") await adapter.stop(environment.id);
  await assert.rejects(shortDeadlineAdapter.remove(environment.id), expectTimeout("remove"));
  await delay(1_500);
  await removeTarget(adapter, environment.id);
}

async function main(): Promise<void> {
  const before = await resourceInventory();
  const name = `crucible-verify-${Date.now()}`;
  const adapter = new DocksideAdapter(adapterConfig);
  const shortDeadlineAdapter = new DocksideAdapter(
    docksideAdapterConfig(root, { operationTimeoutMs: 500, readinessTimeoutMs: 1_000, readinessPollMs: 250 }),
  );

  try {
    const installation = await checkInstallation();
    const running = await checkRunningTarget(adapter, name, installation.managerAddress);
    await checkReadinessTimeout(adapter, shortDeadlineAdapter, name);
    await checkFailedLaunch(adapter, name);
    await checkOperationTimeouts(adapter, shortDeadlineAdapter, name);

    const after = await resourceInventory();
    assert.deepEqual(after, before);

    const evidence = {
      schemaVersion: 1,
      recordedAt: new Date().toISOString(),
      host: { platform: process.platform, architecture: process.arch },
      dockside: installation.evidence,
      target: running.target,
      lifecycle: running.lifecycle,
      // Each failure check above throws if its behavior was not observed, so reaching here means all were.
      failures: {
        failedLaunchExplicit: true,
        failedLaunchReservationCleaned: true,
        readinessTimeoutExplicit: true,
        stopTimeoutExplicit: true,
        removalTimeoutExplicit: true,
        cleanupVerified: true,
      },
      containment: { internalNetwork: installation.internalNetwork, ...running.containment },
      cleanup: { before, after },
      limitations: [
        "This evidence covers the selected invoice target and named probes on Docker Desktop for linux/arm64.",
        "It is not a claim that containers safely contain arbitrary hostile workloads.",
      ],
    };
    await mkdir(dirname(evidencePath), { recursive: true });
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o644 });
    process.stdout.write(`${evidencePath}\n`);
  } finally {
    for (const id of liveEnvironments) {
      try {
        await adapter.remove(id);
      } catch {
        // The caller receives the original compatibility failure. Remaining owned
        // resources stay visible for manual inspection instead of being hidden.
      }
    }
  }
}

await main();
