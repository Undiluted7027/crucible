export const environmentStates = [
  "created",
  "preparing",
  "ready",
  "running",
  "stopped",
  "failed",
  "deleted",
] as const;

export type EnvironmentState = (typeof environmentStates)[number];

export type Readiness =
  | { readonly status: "not-checked" }
  | { readonly status: "checking"; readonly startedAt: string }
  | { readonly status: "ready"; readonly observedAt: string; readonly statusCode: number }
  | { readonly status: "failed"; readonly observedAt: string; readonly reason: string };

export interface EnvironmentRoute {
  readonly kind: "ide" | "service";
  readonly name: string;
  readonly url: string;
  readonly access: "owner" | "developer";
}

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

export interface EnvironmentLog {
  readonly text: string;
  readonly truncated: boolean;
  readonly retainedBytes: number;
}

