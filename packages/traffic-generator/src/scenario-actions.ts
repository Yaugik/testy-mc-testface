import type {
  ScenarioActionContext,
  ScenarioActionRegistry,
  ScenarioValue,
} from "@testy/scenario-engine";
import type { GatewayRouteBinding } from "@testy/traffic-gateway";

import { HttpTrafficGenerator } from "./runner.js";
import type {
  TrafficBatchDefinition,
  TrafficEvidence,
  TrafficExpectation,
  TrafficGenerator,
  TrafficJsonValue,
  TrafficMethod,
  TrafficRepeatDefinition,
  TrafficRequestBody,
  TrafficRequestDefinition,
  TrafficRetryPolicy,
} from "./types.js";

export interface TrafficScenarioActionsOptions {
  readonly routeFor: (context: ScenarioActionContext) => GatewayRouteBinding;
  readonly generator?: TrafficGenerator;
  readonly recordEvidence?: (
    evidence: TrafficEvidence,
    context: ScenarioActionContext,
  ) => Promise<void>;
}

export function createTrafficScenarioActions(
  options: TrafficScenarioActionsOptions,
): ScenarioActionRegistry {
  const generator = options.generator ?? new HttpTrafficGenerator();
  const persistBatch = async (
    report: Awaited<ReturnType<TrafficGenerator["burst"]>>,
    context: ScenarioActionContext,
  ): Promise<void> => {
    for (const result of report.results) {
      await options.recordEvidence?.({ kind: "request", report: result }, context);
    }
    await options.recordEvidence?.({ kind: "batch", report }, context);
  };
  return {
    "traffic.send": async (input, context) => {
      const route = routeForRun(options.routeFor(context), context);
      const report = await generator.send(route, readRequest(input), context.signal);
      await options.recordEvidence?.({ kind: "request", report }, context);
      if (report.status === "failed") {
        throw new Error(`Traffic request '${report.requestId}' did not meet its expectations.`);
      }
      return report as unknown as ScenarioValue;
    },
    "traffic.repeat": async (input, context) => {
      const route = routeForRun(options.routeFor(context), context);
      const report = await generator.repeat(route, readRepeat(input), context.signal);
      await persistBatch(report, context);
      if (report.status === "failed") {
        throw new Error(`Traffic batch '${report.batchId}' did not meet its expectations.`);
      }
      return report as unknown as ScenarioValue;
    },
    "traffic.burst": async (input, context) => {
      const route = routeForRun(options.routeFor(context), context);
      const report = await generator.burst(route, readBatch(input), context.signal);
      await persistBatch(report, context);
      if (report.status === "failed") {
        throw new Error(`Traffic batch '${report.batchId}' did not meet its expectations.`);
      }
      return report as unknown as ScenarioValue;
    },
  };
}

function routeForRun(
  route: GatewayRouteBinding,
  context: ScenarioActionContext,
): GatewayRouteBinding {
  if (route.runId !== context.runId) {
    throw new Error("Traffic gateway route belongs to another run.");
  }
  return route;
}

function readRequest(value: ScenarioValue | undefined): TrafficRequestDefinition {
  const record = readObject(value, "Traffic request");
  const method = readOptionalString(record, "method");
  return {
    id: readString(record, "id"),
    path: readString(record, "path"),
    ...(method ? { method: readMethod(method) } : {}),
    ...(record.headers === undefined
      ? {}
      : { headers: readStringMap(record.headers, "Traffic request headers") }),
    ...(record.body === undefined
      ? {}
      : { body: readBody(record.body) }),
    ...(readOptionalString(record, "idempotencyKey")
      ? { idempotencyKey: readString(record, "idempotencyKey") }
      : {}),
    ...(readOptionalNumber(record, "timeoutMs") === undefined
      ? {}
      : { timeoutMs: readNumber(record, "timeoutMs") }),
    ...(readOptionalNumber(record, "abortAfterMs") === undefined
      ? {}
      : { abortAfterMs: readNumber(record, "abortAfterMs") }),
    ...(readOptionalNumber(record, "delayBeforeMs") === undefined
      ? {}
      : { delayBeforeMs: readNumber(record, "delayBeforeMs") }),
    ...(record.retry === undefined ? {} : { retry: readRetry(record.retry) }),
    ...(record.expect === undefined
      ? {}
      : { expect: readExpectation(record.expect) }),
  };
}

function readBatch(value: ScenarioValue | undefined): TrafficBatchDefinition {
  const record = readObject(value, "Traffic batch");
  const requests = readArray(record.requests, "Traffic batch requests").map((item) =>
    readRequest(item),
  );
  return {
    batchId: readString(record, "batchId"),
    requests,
    ...(readOptionalNumber(record, "concurrency") === undefined
      ? {}
      : { concurrency: readNumber(record, "concurrency") }),
    ...(readOptionalNumber(record, "maxTotalDurationMs") === undefined
      ? {}
      : { maxTotalDurationMs: readNumber(record, "maxTotalDurationMs") }),
  };
}

function readRepeat(value: ScenarioValue | undefined): TrafficRepeatDefinition {
  const record = readObject(value, "Traffic repeat");
  return {
    batchId: readString(record, "batchId"),
    request: readRequest(record.request),
    count: readNumber(record, "count"),
    ...(readOptionalNumber(record, "concurrency") === undefined
      ? {}
      : { concurrency: readNumber(record, "concurrency") }),
    ...(readOptionalNumber(record, "maxTotalDurationMs") === undefined
      ? {}
      : { maxTotalDurationMs: readNumber(record, "maxTotalDurationMs") }),
  };
}

function readRetry(value: ScenarioValue): TrafficRetryPolicy {
  const record = readObject(value, "Traffic retry policy");
  return {
    attempts: readNumber(record, "attempts"),
    ...(readOptionalNumber(record, "delayMs") === undefined
      ? {}
      : { delayMs: readNumber(record, "delayMs") }),
    ...(readOptionalNumber(record, "backoffFactor") === undefined
      ? {}
      : { backoffFactor: readNumber(record, "backoffFactor") }),
    ...(record.retryOnStatuses === undefined
      ? {}
      : {
          retryOnStatuses: readArray(
            record.retryOnStatuses,
            "Traffic retry statuses",
          ).map((item) => readStandaloneNumber(item, "Traffic retry status")),
        }),
    ...(readOptionalBoolean(record, "retryOnNetworkError") === undefined
      ? {}
      : {
          retryOnNetworkError: readBoolean(record, "retryOnNetworkError"),
        }),
  };
}

function readExpectation(value: ScenarioValue): TrafficExpectation {
  const record = readObject(value, "Traffic expectation");
  return {
    ...(record.statusCodes === undefined
      ? {}
      : {
          statusCodes: readArray(
            record.statusCodes,
            "Expected traffic statuses",
          ).map((item) => readStandaloneNumber(item, "Expected traffic status")),
        }),
    ...(readOptionalBoolean(record, "networkFailure") === undefined
      ? {}
      : { networkFailure: readBoolean(record, "networkFailure") }),
    ...(readOptionalNumber(record, "minDurationMs") === undefined
      ? {}
      : { minDurationMs: readNumber(record, "minDurationMs") }),
    ...(readOptionalNumber(record, "maxDurationMs") === undefined
      ? {}
      : { maxDurationMs: readNumber(record, "maxDurationMs") }),
    ...(readOptionalNumber(record, "attemptCount") === undefined
      ? {}
      : { attemptCount: readNumber(record, "attemptCount") }),
  };
}

function readBody(value: ScenarioValue): TrafficRequestBody {
  const record = readObject(value, "Traffic request body");
  const kind = readString(record, "kind");
  if (kind === "json") {
    if (!("value" in record)) throw new Error("JSON traffic body requires 'value'.");
    return { kind, value: record.value as TrafficJsonValue };
  }
  if (kind === "malformed-json") {
    return { kind, value: readString(record, "value") };
  }
  if (kind === "form") {
    return {
      kind,
      fields: readStringMap(record.fields, "Traffic form fields"),
    };
  }
  if (kind === "raw") {
    const contentType = readOptionalString(record, "contentType");
    return {
      kind,
      value: readString(record, "value"),
      ...(contentType ? { contentType } : {}),
    };
  }
  throw new Error("Traffic request body kind is unsupported.");
}

function readMethod(value: string): TrafficMethod {
  const normalized = value.toUpperCase();
  if (
    normalized === "GET" ||
    normalized === "POST" ||
    normalized === "PUT" ||
    normalized === "PATCH" ||
    normalized === "DELETE" ||
    normalized === "HEAD" ||
    normalized === "OPTIONS"
  ) {
    return normalized;
  }
  throw new Error("Traffic request method is unsupported.");
}

function readObject(
  value: ScenarioValue | undefined,
  label: string,
): Readonly<Record<string, ScenarioValue>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Readonly<Record<string, ScenarioValue>>;
}

function readArray(
  value: ScenarioValue | undefined,
  label: string,
): readonly ScenarioValue[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function readString(
  value: Readonly<Record<string, ScenarioValue>>,
  key: string,
): string {
  const selected = value[key];
  if (typeof selected !== "string" || selected.length === 0) {
    throw new Error(`Traffic action input '${key}' must be a non-empty string.`);
  }
  return selected;
}

function readOptionalString(
  value: Readonly<Record<string, ScenarioValue>>,
  key: string,
): string | undefined {
  const selected = value[key];
  if (selected === undefined) return undefined;
  if (typeof selected !== "string" || selected.length === 0) {
    throw new Error(`Traffic action input '${key}' must be a non-empty string.`);
  }
  return selected;
}

function readNumber(
  value: Readonly<Record<string, ScenarioValue>>,
  key: string,
): number {
  const selected = value[key];
  return readStandaloneNumber(selected, `Traffic action input '${key}'`);
}

function readStandaloneNumber(
  value: ScenarioValue | undefined,
  label: string,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function readOptionalNumber(
  value: Readonly<Record<string, ScenarioValue>>,
  key: string,
): number | undefined {
  const selected = value[key];
  if (selected === undefined) return undefined;
  if (typeof selected !== "number" || !Number.isFinite(selected)) {
    throw new Error(`Traffic action input '${key}' must be a finite number.`);
  }
  return selected;
}

function readBoolean(
  value: Readonly<Record<string, ScenarioValue>>,
  key: string,
): boolean {
  const selected = value[key];
  if (typeof selected !== "boolean") {
    throw new Error(`Traffic action input '${key}' must be a boolean.`);
  }
  return selected;
}

function readOptionalBoolean(
  value: Readonly<Record<string, ScenarioValue>>,
  key: string,
): boolean | undefined {
  const selected = value[key];
  if (selected === undefined) return undefined;
  if (typeof selected !== "boolean") {
    throw new Error(`Traffic action input '${key}' must be a boolean.`);
  }
  return selected;
}

function readStringMap(
  value: ScenarioValue | undefined,
  label: string,
): Readonly<Record<string, string>> {
  const record = readObject(value, label);
  const result: Record<string, string> = {};
  for (const [key, selected] of Object.entries(record)) {
    if (typeof selected !== "string") {
      throw new Error(`${label} values must be strings.`);
    }
    result[key] = selected;
  }
  return result;
}
