export type Brand<Value, Name extends string> = Value & {
  readonly __brand: Name;
};

export type RunId = Brand<string, "RunId">;
export type ScenarioId = Brand<string, "ScenarioId">;
export type VendorId = Brand<string, "VendorId">;
export type JourneyId = Brand<string, "JourneyId">;

export const RUN_STATUSES = [
  "CREATED",
  "VALIDATING",
  "ALLOCATING",
  "COMPILING",
  "CONFIGURING",
  "RUNNING",
  "OBSERVING",
  "ASSERTING",
  "PASSED",
  "FAILED",
  "CANCELLING",
  "CANCELLED",
  "CLEANUP",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export interface RunContext {
  readonly runId: RunId;
  readonly scenarioId: ScenarioId;
  readonly target: string;
  readonly createdAt: string;
}

export interface ResourceLease {
  readonly leaseId: string;
  readonly runId: RunId;
  readonly resourceType: string;
  readonly resourceKey: string;
  readonly expiresAt: string;
}

export interface TimelineEvent {
  readonly occurredAt: string;
  readonly runId: RunId;
  readonly category: string;
  readonly name: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface ArtifactReference {
  readonly artifactId: string;
  readonly runId: RunId;
  readonly mediaType: string;
  readonly location: string;
  readonly sha256: string;
}

export interface SanitizedError {
  readonly name: string;
  readonly message: string;
  readonly code?: string;
}

export type Result<Value, ErrorValue> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: ErrorValue };

export function success<Value>(value: Value): Result<Value, never> {
  return { ok: true, value };
}

export function failure<ErrorValue>(error: ErrorValue): Result<never, ErrorValue> {
  return { ok: false, error };
}
