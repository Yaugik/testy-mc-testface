import { trafficError, TrafficGeneratorError } from "./errors.js";
import type {
  TrafficAttemptResult,
  TrafficBatchDefinition,
  TrafficBatchReport,
  TrafficGenerator,
  TrafficGeneratorOptions,
  TrafficRepeatDefinition,
  TrafficRequestDefinition,
  TrafficRequestResult,
  TrafficRouteBinding,
} from "./types.js";
import {
  assertIdentifier,
  buildGatewayRequestUrl,
  defaultSleep,
  fingerprint,
  isRetriableNetworkOutcome,
  normalizeNonNegativeInteger,
  normalizePositiveInteger,
  normalizeRequest,
  retryDelayMs,
  safeErrorCode,
  shouldRetryStatus,
  throwIfAborted,
  type NormalizedTrafficRequest,
  type TrafficHardLimits,
} from "./util.js";

const DEFAULT_MAX_REQUESTS = 100;
const HARD_MAX_REQUESTS = 1_000;
const DEFAULT_MAX_CONCURRENCY = 10;
const HARD_MAX_CONCURRENCY = 50;
const DEFAULT_MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_MAX_REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_TOTAL_DURATION_MS = 300_000;
const DEFAULT_MAX_RETRY_ATTEMPTS = 10;
const DEFAULT_MAX_RETRY_DELAY_MS = 60_000;

interface BoundedResponseBody {
  readonly bytes: Uint8Array;
  readonly fingerprint?: string;
}

export class HttpTrafficGenerator implements TrafficGenerator {
  private readonly fetchImpl: typeof fetch;
  private readonly clock: () => Date;
  private readonly sleep: (durationMs: number, signal?: AbortSignal) => Promise<void>;
  private readonly limits: TrafficHardLimits & {
    readonly maxRequests: number;
    readonly maxConcurrency: number;
    readonly maxResponseBytes: number;
    readonly maxTotalDurationMs: number;
  };

  public constructor(options: TrafficGeneratorOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.clock = options.clock ?? (() => new Date());
    this.sleep = options.sleep ?? defaultSleep;
    this.limits = {
      maxRequests: normalizePositiveInteger(
        options.maxRequests,
        DEFAULT_MAX_REQUESTS,
        HARD_MAX_REQUESTS,
        "Maximum traffic requests",
      ),
      maxConcurrency: normalizePositiveInteger(
        options.maxConcurrency,
        DEFAULT_MAX_CONCURRENCY,
        HARD_MAX_CONCURRENCY,
        "Maximum traffic concurrency",
      ),
      maxBodyBytes: normalizePositiveInteger(
        options.maxBodyBytes,
        DEFAULT_MAX_BODY_BYTES,
        1024 * 1024,
        "Maximum traffic request body bytes",
      ),
      maxResponseBytes: normalizePositiveInteger(
        options.maxResponseBytes,
        DEFAULT_MAX_RESPONSE_BYTES,
        1024 * 1024,
        "Maximum traffic response body bytes",
      ),
      maxRequestTimeoutMs: normalizePositiveInteger(
        options.maxRequestTimeoutMs,
        DEFAULT_MAX_REQUEST_TIMEOUT_MS,
        3_600_000,
        "Maximum traffic request timeout",
      ),
      maxTotalDurationMs: normalizePositiveInteger(
        options.maxTotalDurationMs,
        DEFAULT_MAX_TOTAL_DURATION_MS,
        3_600_000,
        "Maximum traffic batch duration",
      ),
      maxRetryAttempts: normalizePositiveInteger(
        options.maxRetryAttempts,
        DEFAULT_MAX_RETRY_ATTEMPTS,
        100,
        "Maximum traffic retry attempts",
      ),
      maxRetryDelayMs: normalizeNonNegativeInteger(
        options.maxRetryDelayMs,
        DEFAULT_MAX_RETRY_DELAY_MS,
        300_000,
        "Maximum traffic retry delay",
      ),
    };
  }

  public async send(
    route: TrafficRouteBinding,
    request: TrafficRequestDefinition,
    signal?: AbortSignal,
  ): Promise<TrafficRequestResult> {
    throwIfAborted(signal);
    const normalized = normalizeRequest(request, this.limits);
    return this.executeRequest(route, normalized, signal);
  }

  public async burst(
    route: TrafficRouteBinding,
    batch: TrafficBatchDefinition,
    signal?: AbortSignal,
  ): Promise<TrafficBatchReport> {
    const batchId = assertIdentifier(batch.batchId, "Traffic batch ID");
    const requestCount = batch.requests.length;
    if (requestCount < 1 || requestCount > this.limits.maxRequests) {
      throw trafficError(
        "invalid-config",
        `Traffic batch request count must be between 1 and ${this.limits.maxRequests}.`,
      );
    }
    const concurrency = normalizePositiveInteger(
      batch.concurrency,
      Math.min(requestCount, this.limits.maxConcurrency),
      this.limits.maxConcurrency,
      "Traffic batch concurrency",
    );
    const maxTotalDurationMs = normalizePositiveInteger(
      batch.maxTotalDurationMs,
      this.limits.maxTotalDurationMs,
      this.limits.maxTotalDurationMs,
      "Traffic batch duration",
    );
    const normalized = batch.requests.map((request) =>
      normalizeRequest(request, this.limits),
    );
    assertUniqueRequestIds(normalized);
    return this.executeBatch(
      route,
      batchId,
      normalized,
      concurrency,
      maxTotalDurationMs,
      signal,
    );
  }

  public repeat(
    route: TrafficRouteBinding,
    definition: TrafficRepeatDefinition,
    signal?: AbortSignal,
  ): Promise<TrafficBatchReport> {
    const count = normalizePositiveInteger(
      definition.count,
      1,
      this.limits.maxRequests,
      "Traffic repeat count",
    );
    const request = definition.request;
    const requests = Array.from({ length: count }, (_, index) => ({
      ...request,
      id: repeatedRequestId(request.id, index + 1),
    }));
    return this.burst(
      route,
      {
        batchId: definition.batchId,
        requests,
        ...(definition.concurrency === undefined
          ? {}
          : { concurrency: definition.concurrency }),
        ...(definition.maxTotalDurationMs === undefined
          ? {}
          : { maxTotalDurationMs: definition.maxTotalDurationMs }),
      },
      signal,
    );
  }

  private async executeRequest(
    route: TrafficRouteBinding,
    request: NormalizedTrafficRequest,
    signal?: AbortSignal,
  ): Promise<TrafficRequestResult> {
    const started = this.now();
    if (request.delayBeforeMs > 0) {
      await this.sleep(request.delayBeforeMs, signal);
    }
    const attempts: TrafficAttemptResult[] = [];
    for (let attempt = 1; attempt <= request.retry.attempts; attempt += 1) {
      throwIfAborted(signal);
      const result = await this.executeAttempt(route, request, attempt, signal);
      const shouldRetry =
        attempt < request.retry.attempts &&
        (result.outcome === "response"
          ? result.statusCode !== undefined &&
            shouldRetryStatus(request.retry, result.statusCode)
          : result.outcome !== "response-too-large" &&
            isRetriableNetworkOutcome(request.retry));
      if (shouldRetry) {
        const scheduledRetryDelayMs = retryDelayMs(
          request.retry,
          attempt,
          this.limits.maxRetryDelayMs,
        );
        attempts.push({
          ...result,
          scheduledRetryDelayMs,
        });
        await this.sleep(scheduledRetryDelayMs, signal);
      } else {
        attempts.push(result);
        break;
      }
    }
    const completed = this.now();
    const finalAttempt = attempts.at(-1);
    if (!finalAttempt) {
      throw trafficError("invalid-config", "Traffic request did not execute an attempt.");
    }
    const totalDurationMs = completed.getTime() - started.getTime();
    const failureReasons = evaluateExpectation(
      request,
      finalAttempt,
      attempts.length,
      totalDurationMs,
    );
    return {
      requestId: request.id,
      status: failureReasons.length === 0 ? "passed" : "failed",
      method: request.method,
      pathFingerprint: request.pathFingerprint,
      attemptCount: attempts.length,
      totalDurationMs,
      startedAt: started.toISOString(),
      completedAt: completed.toISOString(),
      attempts,
      ...(finalAttempt.statusCode === undefined
        ? {}
        : { finalStatusCode: finalAttempt.statusCode }),
      failureReasons,
    };
  }

  private async executeAttempt(
    route: TrafficRouteBinding,
    request: NormalizedTrafficRequest,
    attempt: number,
    signal?: AbortSignal,
  ): Promise<TrafficAttemptResult> {
    const started = this.now();
    const controller = new AbortController();
    let timedOut = false;
    let clientAborted = false;
    const onParentAbort = () => controller.abort();
    signal?.addEventListener("abort", onParentAbort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, request.timeoutMs);
    const clientAbort = request.abortAfterMs === undefined
      ? undefined
      : setTimeout(() => {
          clientAborted = true;
          controller.abort();
        }, request.abortAfterMs);
    try {
      const target = buildGatewayRequestUrl(route, request.path);
      const headers = new Headers(request.headers);
      headers.set("x-testy-route-token", route.routeToken);
      headers.set("x-testy-run-id", route.runId);
      const response = await this.fetchImpl(target, {
        method: request.method,
        headers,
        redirect: "manual",
        signal: controller.signal,
        ...(request.body === undefined ? {} : { body: request.body }),
      });
      const body = await readBoundedResponseBody(
        response,
        this.limits.maxResponseBytes,
      );
      const completed = this.now();
      return {
        requestId: request.id,
        attempt,
        method: request.method,
        pathFingerprint: request.pathFingerprint,
        startedAt: started.toISOString(),
        completedAt: completed.toISOString(),
        durationMs: completed.getTime() - started.getTime(),
        outcome: "response",
        statusCode: response.status,
        ...(request.requestPayloadFingerprint
          ? { requestPayloadFingerprint: request.requestPayloadFingerprint }
          : {}),
        ...(body.fingerprint
          ? { responsePayloadFingerprint: body.fingerprint }
          : {}),
        responseBytes: body.bytes.byteLength,
      };
    } catch (error) {
      if (signal?.aborted) {
        throw trafficError("cancelled", "Traffic execution was cancelled.");
      }
      const completed = this.now();
      const outcome = error instanceof TrafficGeneratorError && error.code === "response-too-large"
        ? "response-too-large"
        : timedOut
          ? "timeout"
          : clientAborted
            ? "client-abort"
            : "network-error";
      return {
        requestId: request.id,
        attempt,
        method: request.method,
        pathFingerprint: request.pathFingerprint,
        startedAt: started.toISOString(),
        completedAt: completed.toISOString(),
        durationMs: completed.getTime() - started.getTime(),
        outcome,
        ...(request.requestPayloadFingerprint
          ? { requestPayloadFingerprint: request.requestPayloadFingerprint }
          : {}),
        errorCode: outcome === "response-too-large"
          ? "response-too-large"
          : outcome === "timeout"
            ? "timeout"
            : outcome === "client-abort"
              ? "client-abort"
              : safeErrorCode(error),
      };
    } finally {
      clearTimeout(timeout);
      if (clientAbort) clearTimeout(clientAbort);
      signal?.removeEventListener("abort", onParentAbort);
    }
  }

  private async executeBatch(
    route: TrafficRouteBinding,
    batchId: string,
    requests: readonly NormalizedTrafficRequest[],
    concurrency: number,
    maxTotalDurationMs: number,
    signal?: AbortSignal,
  ): Promise<TrafficBatchReport> {
    const started = this.now();
    throwIfAborted(signal);
    const controller = new AbortController();
    let timedOut = false;
    const onParentAbort = () => controller.abort();
    signal?.addEventListener("abort", onParentAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, maxTotalDurationMs);
    const results: TrafficRequestResult[] = new Array(requests.length);
    let next = 0;
    const worker = async (): Promise<void> => {
      while (true) {
        const index = next;
        next += 1;
        const request = requests[index];
        if (!request) return;
        try {
          results[index] = await this.executeRequest(route, request, controller.signal);
        } catch (error) {
          if (signal?.aborted) throw error;
          if (!timedOut) throw error;
          results[index] = cancelledRequestResult(request, this.now(), "batch-timeout");
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: concurrency }, () => worker()));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onParentAbort);
    }
    if (signal?.aborted) {
      throw trafficError("cancelled", "Traffic execution was cancelled.");
    }
    const completed = this.now();
    const finalized = requests.map((request, index) =>
      results[index] ?? cancelledRequestResult(request, completed, "batch-timeout"),
    );
    const failedCount = finalized.filter((result) => result.status === "failed").length;
    return {
      batchId,
      status: !timedOut && failedCount === 0 ? "passed" : "failed",
      startedAt: started.toISOString(),
      completedAt: completed.toISOString(),
      durationMs: completed.getTime() - started.getTime(),
      requestCount: finalized.length,
      passedCount: finalized.length - failedCount,
      failedCount,
      timedOut,
      concurrency,
      results: finalized,
    };
  }

  private now(): Date {
    return new Date(this.clock().getTime());
  }
}

async function readBoundedResponseBody(
  response: Response,
  maximumBytes: number,
): Promise<BoundedResponseBody> {
  if (!response.body) return { bytes: new Uint8Array() };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const selected = await reader.read();
    if (selected.done) break;
    total += selected.value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw trafficError(
        "response-too-large",
        `Traffic response exceeded the ${maximumBytes}-byte limit.`,
      );
    }
    chunks.push(selected.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    bytes,
    ...(bytes.byteLength === 0 ? {} : { fingerprint: fingerprint(bytes) }),
  };
}

function evaluateExpectation(
  request: NormalizedTrafficRequest,
  finalAttempt: TrafficAttemptResult,
  attemptCount: number,
  totalDurationMs: number,
): readonly string[] {
  const reasons: string[] = [];
  const expectedNetworkFailure = request.expect.networkFailure === true;
  const receivedNetworkFailure = finalAttempt.outcome !== "response";
  if (expectedNetworkFailure !== receivedNetworkFailure) {
    reasons.push(expectedNetworkFailure ? "network-failure-not-observed" : "unexpected-network-failure");
  }
  if (finalAttempt.outcome === "response" && finalAttempt.statusCode !== undefined) {
    const accepted = request.expect.statusCodes
      ? request.expect.statusCodes.includes(finalAttempt.statusCode)
      : finalAttempt.statusCode >= 200 && finalAttempt.statusCode < 400;
    if (!accepted) reasons.push("unexpected-status");
  }
  if (
    request.expect.minDurationMs !== undefined &&
    totalDurationMs < request.expect.minDurationMs
  ) {
    reasons.push("duration-below-minimum");
  }
  if (
    request.expect.maxDurationMs !== undefined &&
    totalDurationMs > request.expect.maxDurationMs
  ) {
    reasons.push("duration-above-maximum");
  }
  if (
    request.expect.attemptCount !== undefined &&
    request.expect.attemptCount !== attemptCount
  ) {
    reasons.push("unexpected-attempt-count");
  }
  return reasons;
}

function assertUniqueRequestIds(
  requests: readonly NormalizedTrafficRequest[],
): void {
  const ids = new Set<string>();
  for (const request of requests) {
    if (ids.has(request.id)) {
      throw trafficError(
        "invalid-config",
        `Traffic batch request ID '${request.id}' is duplicated.`,
      );
    }
    ids.add(request.id);
  }
}

function repeatedRequestId(base: string, ordinal: number): string {
  const suffix = `-${ordinal}`;
  const maximumBaseLength = 64 - suffix.length;
  if (maximumBaseLength < 1 || base.length > maximumBaseLength) {
    throw trafficError(
      "invalid-config",
      "Traffic repeat request ID is too long for generated instance IDs.",
    );
  }
  return `${base}${suffix}`;
}

function cancelledRequestResult(
  request: NormalizedTrafficRequest,
  completed: Date,
  reason: string,
): TrafficRequestResult {
  return {
    requestId: request.id,
    status: "failed",
    method: request.method,
    pathFingerprint: request.pathFingerprint,
    attemptCount: 0,
    totalDurationMs: 0,
    startedAt: completed.toISOString(),
    completedAt: completed.toISOString(),
    attempts: [],
    failureReasons: [reason],
  };
}
