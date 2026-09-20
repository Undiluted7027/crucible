import { errorMessage } from "../errors.js";
import type {
  EnvironmentFailure,
  EnvironmentLog,
  EnvironmentRoute,
  EnvironmentSnapshot,
  EnvironmentState,
  Readiness,
} from "../contracts/environment.js";
import {
  docksideReservationListSchema,
  docksideReservationSchema,
  docksideUrlCheckSchema,
  type DocksideReservation,
} from "./schema.js";
import { runProcess, type ProcessRequest, type ProcessResult } from "./process.js";

export interface DocksideAdapterConfig {
  readonly executable: string;
  readonly server: string;
  readonly cliConfigDirectory: string;
  readonly operationTimeoutMs: number;
  readonly readinessTimeoutMs: number;
  readonly readinessPollMs: number;
  readonly maxOutputBytes: number;
}

export interface CreateEnvironmentInput {
  readonly name: string;
  readonly profile: string;
  readonly image: string;
  readonly network: string;
  readonly unixuser: string;
  readonly ide: string;
  readonly access: Readonly<Record<string, "owner" | "developer">>;
}

type ProcessRunner = (request: ProcessRequest) => Promise<ProcessResult>;

export class DocksideOperationError extends Error {
  readonly failure: EnvironmentFailure;

  constructor(failure: EnvironmentFailure) {
    super(failure.message);
    this.name = "DocksideOperationError";
    this.failure = failure;
  }
}

function stateOf(status: number): EnvironmentState {
  switch (status) {
    case -4:
      return "failed";
    case -3:
      return "deleted";
    case -2:
      return "preparing";
    case -1:
      return "created";
    case 0:
      return "stopped";
    case 1:
      return "running";
    default:
      return "failed";
  }
}

function routesOf(reservation: DocksideReservation): EnvironmentRoute[] {
  const parentFqdn = reservation.data.parentFQDN ?? "";
  return reservation.profileObject.routers.flatMap((router) => {
    if (router.type === "passthru") return [];
    const prefix = router.prefixes?.[0] ?? "www";
    const protocol = router.https === undefined ? "http" : "https";
    const fqdn = `${prefix}-${reservation.name}${parentFqdn}`;
    const kind = router.type === "ide" ? "ide" : "service";
    const home = reservation.data.homeDir ?? `/home/${reservation.data.unixuser ?? ""}`;
    const suffix =
      kind === "ide"
        ? reservation.data.runningIDE?.startsWith("openvscode") === true
          ? `/?folder=${encodeURIComponent(home)}`
          : `/#${home}`
        : "/";
    const configuredAccess = reservation.meta.access?.[router.name] ?? router.auth?.[0];
    if (configuredAccess !== "owner" && configuredAccess !== "developer") return [];
    return [{ kind, name: router.name, url: `${protocol}://${fqdn}${suffix}`, access: configuredAccess }];
  });
}

function snapshotOf(reservation: DocksideReservation, readiness: Readiness = { status: "not-checked" }): EnvironmentSnapshot {
  const containerId = reservation.containerId ?? reservation.docker?.ID;
  return {
    id: reservation.id,
    name: reservation.name,
    state: stateOf(reservation.status),
    ...(containerId === undefined ? {} : { containerId }),
    image: reservation.data.image,
    profile: reservation.profile,
    network: reservation.data.network,
    routes: routesOf(reservation),
    readiness,
  };
}

function sanitizeText(value: string): string {
  return value
    .replace(/\u001b\[[0-9;:<=>?]*[@-~]/gu, "")
    .replace(/\u001b\][^\u001b\u0007]*(?:\u0007|\u001b\\)/gu, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001a\u001c-\u001f\u007f]/gu, "");
}

export class DocksideAdapter {
  constructor(
    private readonly config: DocksideAdapterConfig,
    private readonly run: ProcessRunner = runProcess,
  ) {}

  async create(input: CreateEnvironmentInput): Promise<EnvironmentSnapshot> {
    const result = await this.execute(
      "create",
      ["create", "--from-json", "-", "--timeout", String(Math.ceil(this.config.operationTimeoutMs / 1_000)), "--output", "json"],
      JSON.stringify({
        name: input.name,
        profile: input.profile,
        image: input.image,
        network: input.network,
        unixuser: input.unixuser,
        IDE: input.ide,
        access: input.access,
      }),
    );
    const created = this.parseJson("create", result.stdout, docksideReservationSchema.parse);
    return await this.requireState(created.id, "create", (item) => item.status === 1);
  }

  async get(identifier: string): Promise<EnvironmentSnapshot> {
    const result = await this.execute("get", ["get", identifier, "--output", "json"]);
    return snapshotOf(this.parseJson("get", result.stdout, docksideReservationSchema.parse));
  }

  async start(identifier: string): Promise<EnvironmentSnapshot> {
    await this.execute("start", ["start", identifier, "--timeout", String(Math.ceil(this.config.operationTimeoutMs / 1_000))]);
    return await this.requireState(identifier, "start", (item) => item.status === 1);
  }

  async stop(identifier: string): Promise<EnvironmentSnapshot> {
    await this.execute("stop", ["stop", identifier, "--timeout", String(Math.ceil(this.config.operationTimeoutMs / 1_000))]);
    return await this.requireState(identifier, "stop", (item) => item.status === 0);
  }

  async logs(identifier: string): Promise<EnvironmentLog> {
    const result = await this.execute("logs", ["logs", identifier]);
    const sanitized = sanitizeText(result.stdout);
    return {
      text: sanitized,
      truncated: result.outputTruncated,
      retainedBytes: Buffer.byteLength(sanitized),
    };
  }

  async remove(identifier: string): Promise<void> {
    const before = (await this.list()).find((item) => item.id === identifier || item.name === identifier);
    if (before === undefined) return;
    if (before?.status === 1) await this.stop(before.id);
    await this.execute("remove", ["remove", identifier, "--force", "--timeout", String(Math.ceil(this.config.operationTimeoutMs / 1_000))]);
    const reservations = await this.list();
    const remaining = reservations.find((item) => item.id === identifier || item.name === identifier);
    if (remaining !== undefined && remaining.status > -3) {
      throw this.error("remove", `Dockside still reports ${identifier} after removal`, undefined, false, JSON.stringify(remaining));
    }
  }

  async waitUntilReady(identifier: string, serviceRouteName: string, expectedStatus = 200): Promise<EnvironmentSnapshot> {
    const startedAt = new Date().toISOString();
    const deadline = Date.now() + this.config.readinessTimeoutMs;
    let lastReason = "readiness was not checked";

    while (Date.now() < deadline) {
      const environment = await this.get(identifier);
      if (environment.state !== "running") {
        throw this.error("readiness", `Environment entered ${environment.state} before it became ready`, undefined, false);
      }
      const route = environment.routes.find((candidate) => candidate.name === serviceRouteName);
      if (route === undefined) {
        throw this.error("readiness", `Dockside did not return the ${serviceRouteName} route`, undefined, false);
      }

      const check = await this.executeAllowFailure("readiness", [
        "check-url",
        `${route.url}healthz`,
        "--timeout",
        String(Math.ceil(this.config.readinessPollMs / 1_000)),
        "--output",
        "json",
      ]);
      if (check.exitCode === 0) {
        const observation = this.parseJson("readiness", check.stdout, docksideUrlCheckSchema.parse);
        if (observation.status === expectedStatus) {
          return { ...environment, state: "ready", readiness: { status: "ready", observedAt: new Date().toISOString(), statusCode: observation.status } };
        }
        lastReason = `health route returned HTTP ${observation.status}`;
      } else {
        lastReason = sanitizeText(check.stderr).trim() || `check-url exited ${check.exitCode}`;
      }
      await new Promise((resolve) => setTimeout(resolve, this.config.readinessPollMs));
    }

    const environment = await this.get(identifier);
    return {
      ...environment,
      state: "failed",
      readiness: { status: "failed", observedAt: new Date().toISOString(), reason: lastReason },
      failure: {
        operation: "readiness",
        message: `Application did not become ready after ${this.config.readinessTimeoutMs}ms`,
        timedOut: true,
        details: `Started ${startedAt}; last observation: ${lastReason}`,
      },
    };
  }

  private async list(): Promise<readonly DocksideReservation[]> {
    const result = await this.execute("get", ["list", "--output", "json"]);
    return this.parseJson("get", result.stdout, docksideReservationListSchema.parse);
  }

  private async requireState(
    identifier: string,
    operation: EnvironmentFailure["operation"],
    accepts: (reservation: DocksideReservation) => boolean,
  ): Promise<EnvironmentSnapshot> {
    const reservations = await this.list();
    const reservation = reservations.find((item) => item.id === identifier || item.name === identifier);
    if (reservation === undefined) {
      throw this.error(operation, `Dockside no longer reports ${identifier}`, undefined, false);
    }
    if (!accepts(reservation)) {
      throw this.error(
        operation,
        `Dockside reported status ${reservation.status} after ${operation}`,
        undefined,
        false,
        reservation.createStatus === undefined ? undefined : `docker create exit code ${reservation.createStatus}`,
      );
    }
    return snapshotOf(reservation);
  }

  private async execute(
    operation: EnvironmentFailure["operation"],
    args: readonly string[],
    stdin?: string,
  ): Promise<ProcessResult> {
    const result = await this.executeAllowFailure(operation, args, stdin);
    if (result.exitCode !== 0 || result.timedOut) {
      throw this.error(
        operation,
        result.timedOut ? `${operation} exceeded its controller deadline` : `${operation} failed`,
        result.exitCode,
        result.timedOut,
        sanitizeText(result.stderr).trim(),
      );
    }
    return result;
  }

  private async executeAllowFailure(
    _operation: EnvironmentFailure["operation"],
    args: readonly string[],
    stdin?: string,
  ): Promise<ProcessResult> {
    return await this.run({
      command: this.config.executable,
      args: ["--server", this.config.server, ...args],
      ...(stdin === undefined ? {} : { stdin }),
      timeoutMs: this.config.operationTimeoutMs,
      maxOutputBytes: this.config.maxOutputBytes,
      env: { ...process.env, DOCKSIDE_CLI_CONFIG: this.config.cliConfigDirectory },
    });
  }

  private parseJson<T>(
    operation: EnvironmentFailure["operation"],
    raw: string,
    parse: (input: unknown) => T,
  ): T {
    try {
      return parse(JSON.parse(raw));
    } catch (cause) {
      throw this.error(operation, `Dockside returned malformed ${operation} output`, undefined, false, errorMessage(cause));
    }
  }

  private error(
    operation: EnvironmentFailure["operation"],
    message: string,
    exitCode: number | undefined,
    timedOut: boolean,
    details?: string,
  ): DocksideOperationError {
    return new DocksideOperationError({
      operation,
      message,
      ...(exitCode === undefined ? {} : { exitCode }),
      timedOut,
      ...(details === undefined || details === "" ? {} : { details }),
    });
  }
}

export const docksideInternals = { stateOf, routesOf, sanitizeText, snapshotOf };
