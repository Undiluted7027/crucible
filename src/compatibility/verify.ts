import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { DocksideAdapter, DocksideOperationError } from "../dockside/adapter.js";
import { runProcess } from "../dockside/process.js";
import {
  compatibilityTimeouts, docksideAdapterConfig, invoiceTarget, invoiceTargetRequest, managerContainer, sensitiveEnvironmentPattern,
} from "../dockside/reviewed-setup.js";
import { docksideReservationListSchema } from "../dockside/schema.js";

const root = resolve(import.meta.dirname, "../..");
const adapterConfig = docksideAdapterConfig(root, compatibilityTimeouts);
const { network: targetNetwork, image: targetImage } = invoiceTarget;
const unrelatedNetwork = "crucible-unrelated-probe-v1";
const unrelatedContainer = "crucible-unrelated-probe";
const expectedDocksideImageId = "sha256:876acbdf7152d51c732b41acaf9addabadfcbb6bde3d2d7e8c7b2361a8da3c12";

const inspectSchema = z.array(
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

async function command(command: string, args: readonly string[], timeoutMs = 15_000): Promise<string> {
  const result = await runProcess({ command, args, timeoutMs, maxOutputBytes: 262_144 });
  if (result.exitCode !== 0 || result.timedOut) {
    throw new Error(`${command} ${args[0] ?? ""} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

async function dockerJson<T>(args: readonly string[], parse: (input: unknown) => T): Promise<T> {
  return parse(JSON.parse(await command("docker", args)));
}

async function probeTarget(containerId: string, source: string, args: readonly string[] = []): Promise<boolean> {
  const result = await runProcess({
    command: "docker",
    args: ["exec", containerId, "node", "-e", source, ...args],
    timeoutMs: 8_000,
    maxOutputBytes: 16_384,
  });
  return result.exitCode === 0 && !result.timedOut;
}

async function resourceInventory(): Promise<readonly string[]> {
  const output = await command("docker", [
    "ps",
    "-a",
    "--filter",
    "label=owner.username=crucible",
    "--format",
    "{{.ID}} {{.Names}} {{.Status}}",
  ]);
  return output.trim() === "" ? [] : output.trim().split("\n").sort();
}

async function reservationExists(name: string): Promise<boolean> {
  const result = await runProcess({
    command: adapterConfig.executable,
    args: ["--server", adapterConfig.server, "list", "--output", "json"],
    timeoutMs: 10_000,
    maxOutputBytes: 262_144,
    env: {
      ...process.env,
      DOCKSIDE_CLI_CONFIG: adapterConfig.cliConfigDirectory,
    },
  });
  if (result.exitCode !== 0 || result.timedOut) throw new Error(`Could not inspect Dockside reservations: ${result.stderr}`);
  return docksideReservationListSchema.parse(JSON.parse(result.stdout)).some((item) => item.name === name);
}

async function removeOwnedProbeResources(): Promise<void> {
  await runProcess({
    command: "docker",
    args: ["container", "rm", "--force", unrelatedContainer],
    timeoutMs: 10_000,
    maxOutputBytes: 16_384,
  });
  await runProcess({
    command: "docker",
    args: ["network", "rm", unrelatedNetwork],
    timeoutMs: 10_000,
    maxOutputBytes: 16_384,
  });
}

async function main(): Promise<void> {
  const before = await resourceInventory();
  const name = `crucible-verify-${Date.now()}`;
  const hostSecretPath = resolve(root, ".crucible/dockside-data/containment/host-secret");
  let environmentId: string | undefined;

  const adapter = new DocksideAdapter(adapterConfig);
  const shortDeadlineAdapter = new DocksideAdapter(
    docksideAdapterConfig(root, { operationTimeoutMs: 500, readinessTimeoutMs: 1_000, readinessPollMs: 250 }),
  );

  try {
    await mkdir(dirname(hostSecretPath), { recursive: true });
    await writeFile(hostSecretPath, randomBytes(32), { mode: 0o600 });

    const dockside = (await dockerJson(["inspect", managerContainer], inspectSchema.parse))[0];
    assert.ok(dockside !== undefined);
    assert.equal(dockside.Image, expectedDocksideImageId);
    assert.equal(dockside.State.Running, true);
    const serverVersion = (await command("docker", ["exec", managerContainer, "cat", "/etc/service/nginx/data/version"])).trim();
    const cliVersion = (await command(adapterConfig.executable, ["--version"])).trim();
    assert.equal(serverVersion, "v4.0.1 (c583421)");
    assert.equal(cliVersion, "dockside 0.2.0");

    const targetNetworkState = (await dockerJson(["network", "inspect", targetNetwork], networkSchema.parse))[0];
    assert.ok(targetNetworkState !== undefined);
    assert.equal(targetNetworkState.Internal, true);
    const docksideEndpoint = Object.values(targetNetworkState.Containers).find(({ Name }) => Name === managerContainer);
    assert.ok(docksideEndpoint !== undefined);
    const docksideIp = docksideEndpoint.IPv4Address.split("/")[0];
    assert.ok(docksideIp !== undefined && docksideIp !== "");

    const running = await adapter.create(invoiceTargetRequest(name));
    environmentId = running.id;
    assert.ok(running.containerId !== undefined);
    const ready = await adapter.waitUntilReady(running.id, "app");
    const containerId = running.containerId;
    const applicationRoute = ready.routes.find(({ name: routeName }) => routeName === "app");
    const ideRoute = ready.routes.find(({ kind }) => kind === "ide");
    assert.ok(applicationRoute !== undefined);
    assert.ok(ideRoute !== undefined);
    const anonymousApplicationStatus = Number((await command("curl", ["--insecure", "--silent", "--output", "/dev/null", "--write-out", "%{http_code}", applicationRoute.url])).trim());
    const anonymousIdeStatus = Number((await command("curl", ["--insecure", "--silent", "--output", "/dev/null", "--write-out", "%{http_code}", ideRoute.url])).trim());
    assert.notEqual(anonymousApplicationStatus, 200);
    assert.notEqual(anonymousIdeStatus, 200);

    const target = (await dockerJson(["inspect", containerId], inspectSchema.parse))[0];
    assert.ok(target !== undefined);
    assert.equal(target.Image, invoiceTarget.imageId);
    assert.equal(target.Config.User, invoiceTarget.unixuser);
    assert.equal(target.HostConfig.NetworkMode, targetNetwork);
    assert.equal(target.HostConfig.Memory, invoiceTarget.limits.memoryBytes);
    assert.equal(target.HostConfig.MemorySwap, invoiceTarget.limits.memoryBytes);
    assert.equal(target.HostConfig.NanoCpus, invoiceTarget.limits.nanoCpus);
    assert.equal(target.HostConfig.PidsLimit, invoiceTarget.limits.pidsLimit);
    assert.equal(target.HostConfig.Binds, null);
    assert.ok(target.HostConfig.SecurityOpt?.includes("no-new-privileges:true"));
    assert.deepEqual(
      [...(target.HostConfig.CapDrop ?? [])].sort(),
      ["CAP_AUDIT_WRITE", "CAP_MKNOD", "CAP_NET_RAW", "CAP_SETFCAP"].sort(),
    );
    assert.equal(target.Mounts.some(({ Destination }) => Destination === "/var/run/docker.sock"), false);
    assert.equal(target.Mounts.some(({ Type }) => Type === "bind"), false);
    assert.equal(
      (target.Config.Env ?? []).some((entry) => sensitiveEnvironmentPattern.test(entry)),
      false,
    );

    await command("docker", ["network", "create", "--internal", "--label", "dev.crucible.owner=compatibility-probe", unrelatedNetwork]);
    await command("docker", [
      "run",
      "--detach",
      "--name",
      unrelatedContainer,
      "--network",
      unrelatedNetwork,
      "--entrypoint",
      "node",
      targetImage,
      "-e",
      "require('node:net').createServer(() => {}).listen(4040); setInterval(() => {}, 10000)",
    ]);
    const unrelatedState = (await dockerJson(["network", "inspect", unrelatedNetwork], networkSchema.parse))[0];
    assert.ok(unrelatedState !== undefined);
    const unrelatedIp = Object.values(unrelatedState.Containers).find(({ Name }) => Name === unrelatedContainer)?.IPv4Address.split("/")[0];
    assert.ok(unrelatedIp !== undefined && unrelatedIp !== "");

    const cannotReadHostSecret = await probeTarget(
      containerId,
      "const fs=require('node:fs'); process.exit(fs.existsSync('/data/containment/host-secret') ? 2 : 0)",
    );
    const cannotReachInternet = await probeTarget(
      containerId,
      "fetch('https://example.com',{signal:AbortSignal.timeout(2500)}).then(()=>process.exit(2)).catch(()=>process.exit(0))",
    );
    const tcpDenied = "const net=require('node:net');const s=net.connect(Number(process.argv[1]),process.argv[2]);const done=(code)=>{s.destroy();process.exit(code)};s.setTimeout(2500,()=>done(0));s.on('error',()=>done(0));s.on('connect',()=>done(2));";
    const cannotReachManagement = await probeTarget(containerId, tcpDenied, ["443", docksideIp]);
    const cannotReachUnrelatedTarget = await probeTarget(containerId, tcpDenied, ["4040", unrelatedIp]);
    assert.equal(cannotReadHostSecret, true);
    assert.equal(cannotReachInternet, true);
    assert.equal(cannotReachManagement, true);
    assert.equal(cannotReachUnrelatedTarget, true);

    const logs = await adapter.logs(running.id);
    const stopped = await adapter.stop(running.id);
    const restarted = await adapter.start(running.id);
    await adapter.remove(running.id);
    environmentId = undefined;
    await removeOwnedProbeResources();
    await unlink(hostSecretPath);

    const notReadyName = `${name}-not-ready`;
    const notReadyEnvironment = await adapter.create(invoiceTargetRequest(notReadyName));
    environmentId = notReadyEnvironment.id;
    assert.ok(notReadyEnvironment.containerId !== undefined);
    await command("docker", ["network", "disconnect", targetNetwork, notReadyEnvironment.containerId]);
    const failedReadiness = await shortDeadlineAdapter.waitUntilReady(notReadyEnvironment.id, "app");
    const readinessTimeoutExplicit = failedReadiness.state === "failed"
      && failedReadiness.readiness.status === "failed"
      && failedReadiness.failure?.operation === "readiness"
      && failedReadiness.failure.timedOut;
    assert.equal(readinessTimeoutExplicit, true);
    await command("docker", ["network", "connect", targetNetwork, notReadyEnvironment.containerId]);
    await adapter.remove(notReadyEnvironment.id);
    environmentId = undefined;

    const failedLaunchName = `${name}-failed-launch`;
    const backupImage = "crucible/invoice-vulnerable:compatibility-backup";
    let failedLaunchExplicit = false;
    let failedLaunchReservationCleaned = false;
    await command("docker", ["image", "tag", targetImage, backupImage]);
    await command("docker", ["image", "rm", targetImage]);
    try {
      await adapter.create(invoiceTargetRequest(failedLaunchName));
      assert.fail("Dockside unexpectedly launched a missing target image");
    } catch (error) {
      assert.ok(error instanceof DocksideOperationError);
      assert.equal(error.failure.operation, "create");
      failedLaunchExplicit = true;
    } finally {
      await command("docker", ["image", "tag", backupImage, targetImage]);
      await command("docker", ["image", "rm", backupImage]);
    }
    const failedLaunchCleanupDeadline = Date.now() + 45_000;
    while (Date.now() < failedLaunchCleanupDeadline) {
      if (!(await reservationExists(failedLaunchName))) {
        failedLaunchReservationCleaned = true;
        break;
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
    }
    assert.equal(failedLaunchReservationCleaned, true);

    const timeoutName = `${name}-timeouts`;
    const timeoutEnvironment = await adapter.create(invoiceTargetRequest(timeoutName));
    environmentId = timeoutEnvironment.id;
    let stopTimeoutExplicit = false;
    try {
      await shortDeadlineAdapter.stop(timeoutEnvironment.id);
      assert.fail("The short stop deadline unexpectedly completed");
    } catch (error) {
      assert.ok(error instanceof DocksideOperationError);
      assert.equal(error.failure.operation, "stop");
      assert.equal(error.failure.timedOut, true);
      stopTimeoutExplicit = true;
    }
    const afterTimedOutStop = await adapter.get(timeoutEnvironment.id);
    if (afterTimedOutStop.state === "running") await adapter.stop(timeoutEnvironment.id);

    let removalTimeoutExplicit = false;
    try {
      await shortDeadlineAdapter.remove(timeoutEnvironment.id);
      assert.fail("The short removal deadline unexpectedly completed");
    } catch (error) {
      assert.ok(error instanceof DocksideOperationError);
      assert.equal(error.failure.operation, "remove");
      assert.equal(error.failure.timedOut, true);
      removalTimeoutExplicit = true;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_500));
    await adapter.remove(timeoutEnvironment.id);
    environmentId = undefined;

    const after = await resourceInventory();
    assert.deepEqual(after, before);

    const evidence = {
      schemaVersion: 1,
      recordedAt: new Date().toISOString(),
      host: { platform: process.platform, architecture: process.arch },
      dockside: {
        tag: "v4.0.1",
        revision: "c5834215605e4230f9c1f6b576fd8f49b5a71629",
        reportedVersion: serverVersion,
        cliVersion,
        imageId: dockside.Image,
        containerId: dockside.Id,
      },
      target: {
        capsule: "invoice-lodash-template-imports",
        reservationId: running.id,
        containerId,
        image: targetImage,
        imageId: target.Image,
        profile: running.profile,
        network: running.network,
        routes: ready.routes,
        anonymousRouteStatus: {
          application: anonymousApplicationStatus,
          ide: anonymousIdeStatus,
        },
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
      failures: {
        failedLaunchExplicit,
        failedLaunchReservationCleaned,
        readinessTimeoutExplicit,
        stopTimeoutExplicit,
        removalTimeoutExplicit,
        cleanupVerified: true,
      },
      containment: {
        internalNetwork: targetNetworkState.Internal,
        noBindMounts: target.HostConfig.Binds === null,
        noDockerSocket: !target.Mounts.some(({ Destination }) => Destination === "/var/run/docker.sock"),
        noSensitiveEnvironment: !(target.Config.Env ?? []).some((entry) => sensitiveEnvironmentPattern.test(entry)),
        cannotReadHostSecret,
        cannotReachInternet,
        cannotReachManagement,
        cannotReachUnrelatedTarget,
      },
      cleanup: { before, after },
      limitations: [
        "This evidence covers the selected invoice target and named probes on Docker Desktop for linux/arm64.",
        "It is not a claim that containers safely contain arbitrary hostile workloads.",
      ],
    };
    const path = resolve(root, "evidence/dockside/slice-1-compatibility.json");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o644 });
    process.stdout.write(`${path}\n`);
  } finally {
    if (environmentId !== undefined) {
      try {
        await adapter.remove(environmentId);
      } catch {
        // The caller receives the original compatibility failure. Remaining owned
        // resources stay visible for manual inspection instead of being hidden.
      }
    }
    await removeOwnedProbeResources();
    try {
      await unlink(hostSecretPath);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
}

await main();
