/**
 * Lifecycle of a disposable environment as Crucible sees it, independent of Dockside.
 * `running` only means the container is up. `ready` is reached only after the application answers its health route.
 */
export type EnvironmentState = "created" | "preparing" | "ready" | "running" | "stopped" | "failed" | "deleted";

/** Result of asking the application whether it is serving, kept separate from container state. */
export type Readiness =
  | { readonly status: "not-checked" }
  | { readonly status: "ready"; readonly observedAt: string; readonly statusCode: number }
  | { readonly status: "failed"; readonly observedAt: string; readonly reason: string };

/** A URL Dockside serves for the environment. Only routes that require an owner or developer login are listed. */
export interface EnvironmentRoute {
  readonly kind: "ide" | "service";
  readonly name: string;
  readonly url: string;
  readonly access: "owner" | "developer";
}

/** Why an operation failed, in terms the caller can act on. `timedOut` means our own deadline, not Dockside's. */
export interface EnvironmentFailure {
  readonly operation: "create" | "get" | "start" | "stop" | "logs" | "remove" | "readiness";
  readonly message: string;
  readonly exitCode?: number;
  readonly timedOut: boolean;
  readonly details?: string;
}

export interface EnvironmentSnapshot {
  readonly id: string;
  readonly name: string;
  readonly state: EnvironmentState;
  readonly containerId?: string;
  readonly image: string;
  readonly profile: string;
  readonly network: string;
  readonly routes: readonly EnvironmentRoute[];
  readonly readiness: Readiness;
  readonly failure?: EnvironmentFailure;
}

/** Container logs with terminal control sequences removed. `truncated` means the oldest output was dropped. */
export interface EnvironmentLog {
  readonly text: string;
  readonly truncated: boolean;
  readonly retainedBytes: number;
}

