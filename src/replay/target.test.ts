import assert from "node:assert/strict";
import test from "node:test";
import { invoiceTarget } from "../dockside/reviewed-setup.js";
import { profileViolations, type TargetInspection } from "./target.js";

const compliant: TargetInspection = {
  Image: invoiceTarget.imageId,
  Config: { User: invoiceTarget.unixuser, Env: ["NODE_ENV=production", "PORT=3000"] },
  Mounts: [],
  HostConfig: {
    Memory: invoiceTarget.limits.memoryBytes,
    NanoCpus: invoiceTarget.limits.nanoCpus,
    PidsLimit: invoiceTarget.limits.pidsLimit,
    Privileged: false,
    SecurityOpt: ["no-new-privileges:true"],
    NetworkMode: invoiceTarget.network,
  },
  NetworkSettings: { Networks: {} },
};

test("a target drifting from the reviewed profile is reported by every way it drifts", () => {
  assert.deepEqual(profileViolations(compliant), []);

  const drifted: TargetInspection = {
    ...compliant,
    Image: "sha256:not-the-reviewed-image",
    // The socket is caught by its path even when it is not a bind mount.
    Mounts: [{ Type: "volume", Destination: "/run/docker.sock" }],
    Config: { ...compliant.Config, Env: [...compliant.Config.Env, "GITHUB_TOKEN=x"] },
    HostConfig: { ...compliant.HostConfig, Privileged: true, PidsLimit: 4096 },
  };
  assert.deepEqual(profileViolations(drifted), [
    "image is not the reviewed image",
    "has a bind mount or the Docker socket",
    "is privileged",
    "process limit differs",
    "environment carries credentials",
  ]);
});
