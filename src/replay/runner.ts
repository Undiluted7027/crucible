import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import ts from "typescript";
import { z } from "zod";
import { invoiceAdvisory } from "../audit/catalog.js";
import { DocksideAdapter } from "../dockside/adapter.js";
import { runProcess } from "../dockside/process.js";
import {
  docksideAdapterConfig, invoiceTarget, invoiceTargetRequest, managerContainer, replayTimeouts, sensitiveEnvironmentPattern,
} from "../dockside/reviewed-setup.js";
import { checks, evaluate, verdict, type Observation, type Response } from "./checks.js";
import { fingerprint, changedInputs } from "./evidence.js";
import type { ReplayEvidence, Revision } from "./schema.js";

const responseSchema = z.object({ status: z.number(), body: z.string(), durationMs: z.number() });
const targetSchema = z.object({
  Image: z.string(),
  Config: z.object({ User: z.string(), Env: z.array(z.string()) }),
  Mounts: z.array(z.object({ Type: z.string(), Destination: z.string() })),
  HostConfig: z.object({ Memory: z.number(), NanoCpus: z.number(), PidsLimit: z.number(), Privileged: z.boolean(), SecurityOpt: z.array(z.string()), NetworkMode: z.string() }),
  NetworkSettings: z.object({ Networks: z.record(z.string(), z.object({ IPAddress: z.string() })) }),
});

async function command(args: string[], stdin?: string): Promise<string> {
  const result = await runProcess({ command: "docker", args, timeoutMs: 15_000, maxOutputBytes: 65_536,
    ...(stdin === undefined ? {} : { stdin }) });
  if (result.exitCode !== 0 || result.timedOut || result.outputTruncated) throw new Error(`docker ${args[0]} failed: ${result.stderr.slice(-1000)}`);
  return result.stdout;
}

async function inspectTarget(container: string): Promise<string> {
  const target = z.array(targetSchema).parse(JSON.parse(await command(["inspect", container])))[0];
  const { limits } = invoiceTarget;
  if (!target || target.Image !== invoiceTarget.imageId || target.Config.User !== invoiceTarget.unixuser
    || target.Mounts.some((mount) => mount.Type === "bind" || mount.Destination.includes("docker.sock"))
    || target.HostConfig.Privileged || target.HostConfig.NetworkMode !== invoiceTarget.network
    || target.HostConfig.Memory !== limits.memoryBytes || target.HostConfig.NanoCpus !== limits.nanoCpus
    || target.HostConfig.PidsLimit !== limits.pidsLimit || !target.HostConfig.SecurityOpt.includes("no-new-privileges:true")
    || target.Config.Env.some((value) => sensitiveEnvironmentPattern.test(value))) {
    throw new Error("Target differs from the reviewed image or restricted profile; reproduction refused.");
  }
  const address = target.NetworkSettings.Networks[invoiceTarget.network]?.IPAddress;
  if (!address || !/^\d+\.\d+\.\d+\.\d+$/.test(address)) throw new Error("Target has no expected network address");
  const internal = await command(["network", "inspect", invoiceTarget.network, "--format", "{{.Internal}}"]);
  if (internal.trim() !== "true") throw new Error("Target network must be internal");
  const managerIp = (await command(["inspect", managerContainer, "--format", `{{(index .NetworkSettings.Networks "${invoiceTarget.network}").IPAddress}}`])).trim();
  // Run a bounded connectivity probe before sending any vulnerability trigger.
  const probe = `const net=require('node:net');
    async function denied(host,port){return new Promise(resolve=>{const s=net.connect(port,host);const finish=v=>{s.destroy();resolve(v)};s.setTimeout(1200,()=>finish(true));s.on('error',()=>finish(true));s.on('connect',()=>finish(false));})}
    Promise.all([denied(process.argv[1],443),denied('1.1.1.1',443)]).then(results=>process.exit(results.every(Boolean)?0:2));`;
  await command(["exec", container, "node", "-e", probe, managerIp]);
  return address;
}

// HTTP transport executes in the trusted management container, never in the target.
// It reads only bounded responses; the target cannot write evaluator expectations.
async function request(address: string, body: unknown): Promise<Response> {
  const source = `const fs=require('node:fs'); const input=JSON.parse(fs.readFileSync(0,'utf8'));
    const start=Date.now(); fetch(input.url,{method:'POST',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify(input.body),signal:AbortSignal.timeout(5000)})
    .then(async response=>{let body='';for await(const chunk of response.body){body+=Buffer.from(chunk).toString();if(body.length>8192)throw Error('Response too large');}console.log(JSON.stringify({status:response.status,body,durationMs:Date.now()-start}));})
    .catch(error=>{console.error(error.message);process.exitCode=1;});`;
  return responseSchema.parse(JSON.parse(await command(["exec", "-i", managerContainer, "node", "-e", source],
    JSON.stringify({ url: `http://${address}:3000/invoices/preview`, body }))));
}

export async function replay(root: string, selected: readonly Revision[], progress: (message: string) => void): Promise<ReplayEvidence> {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const inputs = await fingerprint(root);
  const runId = randomUUID();
  const results: ReplayEvidence["results"] = [];
  const adapter = new DocksideAdapter(docksideAdapterConfig(root, replayTimeouts));
  let cancelled = false;
  const cancel = () => { cancelled = true; progress("Cancellation requested; cleaning up after the current bounded operation."); };
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  try {
    for (const revision of selected) {
      if (cancelled) break;
      const name = `crucible-replay-${runId.slice(0, 8)}-${revision}`;
      let identifier = name;
      const observations: Observation[] = [];
      const result: typeof results[number] = { revision, verdict: "ENVIRONMENT_FAILED", observations, cleanup: false };
      results.push(result);
      try {
        progress(`${revision}: creating a disposable Dockside target`);
        const environment = await adapter.create(invoiceTargetRequest(name));
        identifier = environment.id;
        if (!environment.containerId) throw new Error("Dockside did not return a container ID");
        await inspectTarget(environment.containerId);
        const patch = revision === "vulnerable" ? "src/render.ts" : `patches/${revision}.ts`;
        const files = [ ["server.js", "src/server.ts"], ["render.js", patch] ];
        for (const [destination, source] of files) {
          if (!source || !destination) throw new Error("Invalid fixture source mapping");
          const content = await readFile(resolve(root, "capsules/invoice/replay", source), "utf8");
          const javascript = ts.transpileModule(content, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
          await command(["exec", "-i", "--user", "crucible", environment.containerId, "node", "-e",
            "require('node:fs').writeFileSync(process.argv[1],require('node:fs').readFileSync(0))", `/workspace/dist/${destination}`], javascript);
        }
        await adapter.stop(identifier);
        await adapter.start(identifier);
        const ready = await adapter.waitUntilReady(identifier, "app");
        if (ready.state !== "ready") throw new Error("Application readiness failed");
        const address = await inspectTarget(environment.containerId);
        for (const check of checks) {
          if (cancelled) throw new Error("Replay cancelled");
          try {
            const response = await request(address, check.body);
            observations.push(evaluate(check, response));
          } catch (error) {
            observations.push({ name: check.name, kind: check.kind, outcome: "inconclusive", error: error instanceof Error ? error.message : String(error) });
          }
        }
        result.verdict = verdict(observations);
      } catch (error) {
        result.error = error instanceof Error ? error.message : String(error);
        if (observations.length) result.verdict = verdict(observations);
      } finally {
        try { await adapter.remove(identifier); result.cleanup = true; }
        catch (error) { result.error = `Cleanup failed: ${error instanceof Error ? error.message : String(error)}`; }
      }
      progress(`${revision}: ${result.verdict}${result.cleanup ? " · target removed" : " · CLEANUP FAILED"}`);
      if (!result.cleanup) break;
    }
  } finally {
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
  }
  const changedDuringRun = changedInputs(inputs, await fingerprint(root));
  return { schemaVersion: 1, runId, startedAt, recordedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - started), cancelled,
    capsule: invoiceAdvisory.capsule, advisory: invoiceAdvisory.id,
    requests: checks.map(({ name, kind, body }) => ({ name, kind, body })),
    host: { platform: process.platform, architecture: process.arch, node: process.version },
    scope: "Curated invoice fixture, not the scanned repository. Application-level mitigation on lodash 4.17.20; unrelated audit findings remain unresolved.",
    environment: { backend: "Dockside", image: invoiceTarget.image, imageId: invoiceTarget.imageId, platform: "linux/arm64",
      network: invoiceTarget.network },
    inputs, changedDuringRun, results };
}
