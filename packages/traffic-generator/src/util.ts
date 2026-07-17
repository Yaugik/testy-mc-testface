import { createHash } from "node:crypto";

import { scanStructuredValue } from "@testy/privacy-validation";

import { trafficError } from "./errors.js";
import type {
  TrafficMethod,
  TrafficRequestBody,
  TrafficRequestDefinition,
  TrafficRetryPolicy,
  TrafficRouteBinding,
} from "./types.js";

const requestIdPattern = /^[a-z][a-z0-9-]{0,63}$/u;
const sensitiveHeader = /authorization|cookie|password|secret|api[-_]?key|token/iu;
const liveCredentialPatterns = [
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/gu,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/gu,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/gu,
  /\bsk_live_[A-Za-z0-9]{16,}\b/gu,
  /\bsk-[A-Za-z0-9]{24,}\b/gu,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/gu,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu,
] as const;
const protectedHeaders = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "x-testy-route-token",
  "x-testy-run-id",
]);

export interface NormalizedTrafficRequest {
  readonly id: string;
  readonly method: TrafficMethod;
  readonly path: string;
  readonly headers: Headers;
  readonly body?: Uint8Array;
  readonly pathFingerprint: string;
  readonly requestPayloadFingerprint?: string;
  readonly timeoutMs: number;
  readonly abortAfterMs?: number;
  readonly delayBeforeMs: number;
  readonly retry: Required<Pick<TrafficRetryPolicy, "attempts">> &
    Omit<TrafficRetryPolicy, "attempts">;
  readonly expect: NonNullable<TrafficRequestDefinition["expect"]>;
}

export interface TrafficHardLimits {
  readonly maxBodyBytes: number;
  readonly maxRequestTimeoutMs: number;
  readonly maxRetryAttempts: number;
  readonly maxRetryDelayMs: number;
}

export function fingerprint(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function assertIdentifier(value: string, label: string): string {
  if (!requestIdPattern.test(value)) {
    throw trafficError(
      "invalid-config",
      `${label} must match ${requestIdPattern.source}.`,
    );
  }
  return value;
}

export function normalizeRoute(route: TrafficRouteBinding): URL {
  let url: URL;
  try {
    url = new URL(route.proxyBaseUrl);
  } catch {
    throw trafficError("invalid-config", "Traffic route proxy URL must be absolute.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw trafficError("invalid-config", "Traffic route proxy URL must use HTTP or HTTPS.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw trafficError(
      "invalid-config",
      "Traffic route proxy URL cannot contain credentials, a query, or a fragment.",
    );
  }
  const expectedSuffix = `/v1/proxy/${encodeURIComponent(route.routeId)}`;
  if (url.pathname.replace(/\/$/u, "") !== expectedSuffix) {
    throw trafficError(
      "invalid-config",
      "Traffic route proxy URL does not match the supplied route ID.",
    );
  }
  if (route.routeToken.length < 16) {
    throw trafficError("invalid-config", "Traffic route token is invalid.");
  }
  return url;
}

export function buildGatewayRequestUrl(route: TrafficRouteBinding, path: string): URL {
  const base = normalizeRoute(route);
  const normalizedPath = normalizePath(path);
  const selected = new URL(base.toString());
  selected.pathname = `${base.pathname.replace(/\/$/u, "")}${normalizedPath.pathname}`;
  selected.search = normalizedPath.search;
  return selected;
}

export function normalizeRequest(
  value: TrafficRequestDefinition,
  limits: TrafficHardLimits,
): NormalizedTrafficRequest {
  const id = assertIdentifier(value.id, "Traffic request ID");
  assertSyntheticRequest(value, id);
  const method = value.method ?? "POST";
  const path = normalizePath(value.path);
  const headers = normalizeHeaders(value.headers ?? {});
  const body = encodeBody(value.body, headers, limits.maxBodyBytes);
  if ((method === "GET" || method === "HEAD") && body !== undefined) {
    throw trafficError("invalid-config", `${method} traffic requests cannot contain a body.`);
  }
  if (value.idempotencyKey !== undefined) {
    assertBoundedHeaderValue(value.idempotencyKey, "Idempotency key", 256);
    headers.set("idempotency-key", value.idempotencyKey);
  }
  const timeoutMs = boundedInteger(
    value.timeoutMs ?? 10_000,
    1,
    limits.maxRequestTimeoutMs,
    "Traffic request timeout",
  );
  const abortAfterMs = value.abortAfterMs === undefined
    ? undefined
    : boundedInteger(
        value.abortAfterMs,
        1,
        limits.maxRequestTimeoutMs,
        "Traffic client-abort delay",
      );
  const delayBeforeMs = boundedInteger(
    value.delayBeforeMs ?? 0,
    0,
    limits.maxRetryDelayMs,
    "Traffic pre-request delay",
  );
  const retry = normalizeRetry(value.retry, limits);
  normalizeExpectation(value.expect, limits.maxRetryAttempts);
  if (
    value.expect?.attemptCount !== undefined &&
    value.expect.attemptCount > retry.attempts
  ) {
    throw trafficError(
      "invalid-config",
      "Expected traffic attempt count cannot exceed configured retry attempts.",
    );
  }
  return {
    id,
    method,
    path: `${path.pathname}${path.search}`,
    headers,
    ...(body ? { body: body.bytes } : {}),
    pathFingerprint: fingerprint(`${path.pathname}${path.search}`),
    ...(body ? { requestPayloadFingerprint: fingerprint(body.bytes) } : {}),
    timeoutMs,
    ...(abortAfterMs === undefined ? {} : { abortAfterMs }),
    delayBeforeMs,
    retry,
    expect: value.expect ?? {},
  };
}

export function normalizePositiveInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  label: string,
): number {
  return boundedInteger(value ?? fallback, 1, maximum, label);
}

export function normalizeNonNegativeInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  label: string,
): number {
  return boundedInteger(value ?? fallback, 0, maximum, label);
}

export function retryDelayMs(
  retry: NormalizedTrafficRequest["retry"],
  completedAttempt: number,
  maximum: number,
): number {
  const base = retry.delayMs ?? 0;
  const factor = retry.backoffFactor ?? 1;
  return Math.min(maximum, Math.round(base * factor ** Math.max(0, completedAttempt - 1)));
}

export function shouldRetryStatus(
  retry: NormalizedTrafficRequest["retry"],
  statusCode: number,
): boolean {
  return retry.retryOnStatuses?.includes(statusCode) ?? false;
}

export function isRetriableNetworkOutcome(
  retry: NormalizedTrafficRequest["retry"],
): boolean {
  return retry.retryOnNetworkError === true;
}

export function safeErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const value = (error as { readonly code?: unknown }).code;
    if (typeof value === "string" && /^[a-z0-9-]{1,64}$/u.test(value)) return value;
  }
  return "network-error";
}

export async function defaultSleep(
  durationMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (durationMs <= 0) return;
  if (signal?.aborted) throw trafficError("cancelled", "Traffic execution was cancelled.");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, durationMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(trafficError("cancelled", "Traffic execution was cancelled."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw trafficError("cancelled", "Traffic execution was cancelled.");
  }
}


function assertSyntheticRequest(
  value: TrafficRequestDefinition,
  requestId: string,
): void {
  const issues = scanStructuredValue(value, `traffic-request:${requestId}`);
  const serialized = JSON.stringify(value);
  const credentialPattern = liveCredentialPatterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(serialized);
  });
  if (issues.length === 0 && !credentialPattern) return;
  const codes = [...new Set(issues.map((issue) => issue.code))].sort();
  if (credentialPattern) codes.push("credential-pattern");
  throw trafficError(
    "invalid-config",
    `Traffic request '${requestId}' failed synthetic-data validation (${codes.join(",")}).`,
  );
}

function normalizePath(value: string): URL {
  if (value.length === 0 || value.length > 2_048 || !value.startsWith("/")) {
    throw trafficError(
      "invalid-config",
      "Traffic request path must be a non-empty relative path beginning with '/'.",
    );
  }
  let selected: URL;
  try {
    selected = new URL(value, "http://traffic.invalid");
  } catch {
    throw trafficError("invalid-config", "Traffic request path is invalid.");
  }
  if (selected.origin !== "http://traffic.invalid" || selected.hash) {
    throw trafficError(
      "invalid-config",
      "Traffic request path cannot select another origin or contain a fragment.",
    );
  }
  return selected;
}

function normalizeHeaders(values: Readonly<Record<string, string>>): Headers {
  if (Object.keys(values).length > 32) {
    throw trafficError("invalid-config", "Traffic requests may contain at most 32 headers.");
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(values)) {
    const normalized = name.toLowerCase();
    if (sensitiveHeader.test(normalized)) {
      throw trafficError(
        "invalid-config",
        `Traffic request header '${normalized}' must be supplied by a platform-managed adapter.`,
      );
    }
    if (protectedHeaders.has(normalized)) {
      throw trafficError(
        "invalid-config",
        `Traffic request header '${normalized}' is controlled by the platform.`,
      );
    }
    if (name.length > 128) {
      throw trafficError("invalid-config", "Traffic request header names are too long.");
    }
    assertBoundedHeaderValue(value, `Traffic request header '${normalized}'`, 4_096);
    try {
      headers.set(name, value);
    } catch {
      throw trafficError("invalid-config", `Traffic request header '${normalized}' is invalid.`);
    }
  }
  return headers;
}

function assertBoundedHeaderValue(value: string, label: string, maximum: number): void {
  if (value.length === 0 || value.length > maximum || /[\r\n\0]/u.test(value)) {
    throw trafficError("invalid-config", `${label} is invalid.`);
  }
}

function encodeBody(
  body: TrafficRequestBody | undefined,
  headers: Headers,
  maxBodyBytes: number,
): { readonly bytes: Uint8Array } | undefined {
  if (!body) return undefined;
  let value: string;
  if (body.kind === "json") {
    value = JSON.stringify(body.value);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  } else if (body.kind === "malformed-json") {
    value = body.value;
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  } else if (body.kind === "form") {
    value = new URLSearchParams(Object.entries(body.fields)).toString();
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/x-www-form-urlencoded");
    }
  } else {
    value = body.value;
    if (body.contentType && !headers.has("content-type")) {
      assertBoundedHeaderValue(body.contentType, "Traffic body content type", 256);
      headers.set("content-type", body.contentType);
    }
  }
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength > maxBodyBytes) {
    throw trafficError(
      "invalid-config",
      `Traffic request body exceeds the ${maxBodyBytes}-byte limit.`,
    );
  }
  return { bytes };
}

function normalizeRetry(
  value: TrafficRetryPolicy | undefined,
  limits: TrafficHardLimits,
): NormalizedTrafficRequest["retry"] {
  const attempts = boundedInteger(
    value?.attempts ?? 1,
    1,
    limits.maxRetryAttempts,
    "Traffic retry attempts",
  );
  const delayMs = value?.delayMs === undefined
    ? undefined
    : boundedInteger(
        value.delayMs,
        0,
        limits.maxRetryDelayMs,
        "Traffic retry delay",
      );
  const backoffFactor = value?.backoffFactor ?? 1;
  if (!Number.isFinite(backoffFactor) || backoffFactor < 1 || backoffFactor > 10) {
    throw trafficError(
      "invalid-config",
      "Traffic retry backoff factor must be between 1 and 10.",
    );
  }
  const retryOnStatuses = value?.retryOnStatuses?.map((status) =>
    boundedInteger(status, 100, 599, "Traffic retry status"),
  );
  return {
    attempts,
    ...(delayMs === undefined ? {} : { delayMs }),
    ...(backoffFactor === 1 ? {} : { backoffFactor }),
    ...(retryOnStatuses ? { retryOnStatuses: [...new Set(retryOnStatuses)] } : {}),
    ...(value?.retryOnNetworkError === undefined
      ? {}
      : { retryOnNetworkError: value.retryOnNetworkError }),
  };
}

function normalizeExpectation(
  value: TrafficRequestDefinition["expect"],
  maxRetryAttempts: number,
): void {
  if (value?.statusCodes && value.statusCodes.length === 0) {
    throw trafficError(
      "invalid-config",
      "Expected traffic statuses cannot be empty.",
    );
  }
  if (value?.networkFailure === true && value.statusCodes !== undefined) {
    throw trafficError(
      "invalid-config",
      "A network-failure expectation cannot also declare status codes.",
    );
  }
  for (const status of value?.statusCodes ?? []) {
    boundedInteger(status, 100, 599, "Expected traffic status");
  }
  if (value?.minDurationMs !== undefined) {
    boundedInteger(value.minDurationMs, 0, 3_600_000, "Minimum traffic duration");
  }
  if (value?.maxDurationMs !== undefined) {
    boundedInteger(value.maxDurationMs, 0, 3_600_000, "Maximum traffic duration");
  }
  if (
    value?.minDurationMs !== undefined &&
    value.maxDurationMs !== undefined &&
    value.minDurationMs > value.maxDurationMs
  ) {
    throw trafficError(
      "invalid-config",
      "Minimum traffic duration cannot exceed the maximum.",
    );
  }
  if (value?.attemptCount !== undefined) {
    boundedInteger(value.attemptCount, 1, maxRetryAttempts, "Expected traffic attempt count");
  }
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw trafficError(
      "invalid-config",
      `${label} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}
