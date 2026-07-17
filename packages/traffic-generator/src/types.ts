import type { RunId } from "@testy/shared-types";
import type { GatewayRouteBinding } from "@testy/traffic-gateway";

export type TrafficJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly TrafficJsonValue[]
  | { readonly [key: string]: TrafficJsonValue };

export type TrafficMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

export type TrafficRequestBody =
  | {
      readonly kind: "json";
      readonly value: TrafficJsonValue;
    }
  | {
      readonly kind: "malformed-json";
      readonly value: string;
    }
  | {
      readonly kind: "form";
      readonly fields: Readonly<Record<string, string>>;
    }
  | {
      readonly kind: "raw";
      readonly value: string;
      readonly contentType?: string;
    };

export interface TrafficRetryPolicy {
  readonly attempts: number;
  readonly delayMs?: number;
  readonly backoffFactor?: number;
  readonly retryOnStatuses?: readonly number[];
  readonly retryOnNetworkError?: boolean;
}

export interface TrafficExpectation {
  readonly statusCodes?: readonly number[];
  readonly networkFailure?: boolean;
  readonly minDurationMs?: number;
  readonly maxDurationMs?: number;
  readonly attemptCount?: number;
}

export interface TrafficRequestDefinition {
  readonly id: string;
  readonly path: string;
  readonly method?: TrafficMethod;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: TrafficRequestBody;
  readonly idempotencyKey?: string;
  readonly timeoutMs?: number;
  readonly abortAfterMs?: number;
  readonly delayBeforeMs?: number;
  readonly retry?: TrafficRetryPolicy;
  readonly expect?: TrafficExpectation;
}

export interface TrafficBatchDefinition {
  readonly batchId: string;
  readonly requests: readonly TrafficRequestDefinition[];
  readonly concurrency?: number;
  readonly maxTotalDurationMs?: number;
}

export interface TrafficRepeatDefinition {
  readonly batchId: string;
  readonly request: TrafficRequestDefinition;
  readonly count: number;
  readonly concurrency?: number;
  readonly maxTotalDurationMs?: number;
}

export type TrafficAttemptOutcome =
  | "response"
  | "network-error"
  | "timeout"
  | "client-abort"
  | "response-too-large";

export interface TrafficAttemptResult {
  readonly requestId: string;
  readonly attempt: number;
  readonly method: TrafficMethod;
  readonly pathFingerprint: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly outcome: TrafficAttemptOutcome;
  readonly statusCode?: number;
  readonly requestPayloadFingerprint?: string;
  readonly responsePayloadFingerprint?: string;
  readonly responseBytes?: number;
  readonly errorCode?: string;
  readonly scheduledRetryDelayMs?: number;
}

export interface TrafficRequestResult {
  readonly requestId: string;
  readonly status: "passed" | "failed";
  readonly method: TrafficMethod;
  readonly pathFingerprint: string;
  readonly attemptCount: number;
  readonly totalDurationMs: number;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly attempts: readonly TrafficAttemptResult[];
  readonly finalStatusCode?: number;
  readonly failureReasons: readonly string[];
}

export interface TrafficBatchReport {
  readonly batchId: string;
  readonly status: "passed" | "failed";
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly requestCount: number;
  readonly passedCount: number;
  readonly failedCount: number;
  readonly timedOut: boolean;
  readonly concurrency: number;
  readonly results: readonly TrafficRequestResult[];
}

export interface TrafficGeneratorLimits {
  readonly maxRequests?: number;
  readonly maxConcurrency?: number;
  readonly maxBodyBytes?: number;
  readonly maxResponseBytes?: number;
  readonly maxRequestTimeoutMs?: number;
  readonly maxTotalDurationMs?: number;
  readonly maxRetryAttempts?: number;
  readonly maxRetryDelayMs?: number;
}

export interface TrafficGeneratorOptions extends TrafficGeneratorLimits {
  readonly fetchImpl?: typeof fetch;
  readonly clock?: () => Date;
  readonly sleep?: (durationMs: number, signal?: AbortSignal) => Promise<void>;
}

export interface TrafficRouteBinding {
  readonly routeId: string;
  readonly runId: RunId;
  readonly proxyBaseUrl: string;
  readonly routeToken: string;
}

export interface TrafficGenerator {
  send(
    route: TrafficRouteBinding | GatewayRouteBinding,
    request: TrafficRequestDefinition,
    signal?: AbortSignal,
  ): Promise<TrafficRequestResult>;
  burst(
    route: TrafficRouteBinding | GatewayRouteBinding,
    batch: TrafficBatchDefinition,
    signal?: AbortSignal,
  ): Promise<TrafficBatchReport>;
  repeat(
    route: TrafficRouteBinding | GatewayRouteBinding,
    definition: TrafficRepeatDefinition,
    signal?: AbortSignal,
  ): Promise<TrafficBatchReport>;
}

export type TrafficEvidence =
  | {
      readonly kind: "request";
      readonly report: TrafficRequestResult;
    }
  | {
      readonly kind: "batch";
      readonly report: TrafficBatchReport;
    };
