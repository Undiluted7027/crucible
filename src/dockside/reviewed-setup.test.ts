import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { z } from "zod";
import { compatibilityTimeouts, invoiceTarget } from "./reviewed-setup.js";

const root = resolve(import.meta.dirname, "../..");

const compatibilitySchema = z.object({
  target: z.object({ profile: z.string(), image: z.string(), network: z.string(), imageId: z.string() }),
  limits: z.object({ operationTimeoutMs: z.number(), readinessTimeoutMs: z.number(), readinessPollMs: z.number() }),
});

const profileSchema = z.object({
  images: z.array(z.string()),
  networks: z.array(z.string()),
  unixusers: z.array(z.string()),
  IDEs: z.array(z.string()),
  dockerArgs: z.array(z.string()),
});

async function readJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(JSON.parse(await readFile(resolve(root, path), "utf8")));
}

test("pinned target values in code match the reviewed Dockside configuration", async () => {
  const compatibility = await readJson("config/dockside/compatibility.json", compatibilitySchema);
  assert.deepEqual(compatibility.target, {
    profile: invoiceTarget.profile,
    image: invoiceTarget.image,
    network: invoiceTarget.network,
    imageId: invoiceTarget.imageId,
  });
  assert.deepEqual(compatibility.limits, compatibilityTimeouts);

  const profile = await readJson(`config/dockside/${invoiceTarget.profile}.json`, profileSchema);
  assert.deepEqual(profile.images, [invoiceTarget.image]);
  assert.deepEqual(profile.networks, [invoiceTarget.network]);
  assert.deepEqual(profile.unixusers, [invoiceTarget.unixuser]);
  assert.deepEqual(profile.IDEs, [invoiceTarget.ide]);

  const { memoryBytes, nanoCpus, pidsLimit } = invoiceTarget.limits;
  for (const arg of [`--cpus=${nanoCpus / 1e9}`, `--memory=${memoryBytes / 2 ** 30}G`, `--pids-limit=${pidsLimit}`]) {
    assert.ok(profile.dockerArgs.includes(arg), `profile is missing ${arg}`);
  }
});
