import { createHash } from "node:crypto";

import type { AssertionValue } from "@testy/assertion-engine";

import type { ReportingSource, RunReportDocument } from "./types.js";

export function buildRunReport(source: ReportingSource): RunReportDocument {
  const assertions = source.assertions.map((result) => ({
    ...result,
    message: sanitizeString(result.message),
    ...(result.expected === undefined
      ? {}
      : { expected: sanitizeValue(result.expected) }),
    ...(result.actual === undefined
      ? {}
      : { actual: sanitizeValue(result.actual) }),
    metadata: sanitizeRecord(result.metadata),
  }));
  const failedAssertions = assertions.filter(
    (result) => !result.passed && result.severity === "error",
  ).length;
  const warningFailures = assertions.filter(
    (result) => !result.passed && result.severity === "warning",
  ).length;
  const failedSteps = source.steps.filter(
    (step) => step.status === "FAILED" || step.status === "CANCELLED",
  ).length;
  const durationMs = durationBetween(
    source.run.startedAt,
    source.run.finishedAt,
  );
  const generatedAt =
    source.run.finishedAt ?? source.run.updatedAt ?? source.run.createdAt;
  const materialized = {
    schemaVersion: "1.0" as const,
    reportId: `report-${source.run.id}`,
    generatedAt,
    run: {
      runId: source.run.id,
      scenarioId: source.run.scenarioId,
      target: source.run.target,
      status: source.run.status,
      ...(source.run.outcomeStatus
        ? { outcomeStatus: source.run.outcomeStatus }
        : {}),
      scenarioHash: source.run.resolvedScenarioHash,
      createdAt: source.run.createdAt,
      ...(source.run.startedAt ? { startedAt: source.run.startedAt } : {}),
      ...(source.run.finishedAt ? { finishedAt: source.run.finishedAt } : {}),
      metadata: sanitizeRecord(source.run.metadata),
    },
    summary: {
      passed:
        source.run.outcomeStatus === "PASSED" &&
        failedAssertions === 0 &&
        failedSteps === 0,
      assertionCount: assertions.length,
      passedAssertions: assertions.filter((result) => result.passed).length,
      failedAssertions,
      warningFailures,
      stepCount: source.steps.length,
      failedSteps,
      providerCallCount: source.providerCalls.length,
      browserActionCount: source.browserActions.length,
      observationCount: source.observations.length,
      artifactCount: source.artifacts.length,
      ...(durationMs === undefined ? {} : { durationMs }),
    },
    assertions,
    steps: source.steps.map((step) => ({
      ...step,
      ...(step.error
        ? {
            error: {
              ...step.error,
              message: sanitizeString(step.error.message),
            },
          }
        : {}),
    })),
    timeline: source.timeline.map((event) => ({
      ...event,
      metadata: sanitizeRecord(event.metadata),
    })),
    providerCalls: source.providerCalls.map((record) => ({
      ...record,
      metadata: sanitizeRecord(record.metadata),
    })),
    browserActions: source.browserActions.map((record) => ({
      ...record,
      metadata: sanitizeRecord(record.metadata),
    })),
    observations: source.observations.map((record) => ({
      ...record,
      ...(record.value === undefined
        ? {}
        : { value: sanitizeValue(record.value) }),
      metadata: sanitizeRecord(record.metadata),
    })),
    artifacts: source.artifacts.map((artifact) => ({
      ...artifact,
      location: sanitizeArtifactLocation(artifact.location),
      metadata: sanitizeRecord(artifact.metadata),
    })),
  };
  return {
    ...materialized,
    contentHash: sha256(canonicalJson(materialized)),
  };
}

export function serializeRunReportJson(report: RunReportDocument): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }
  return value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function durationBetween(
  startedAt: string | undefined,
  finishedAt: string | undefined,
): number | undefined {
  if (!startedAt || !finishedAt) return undefined;
  const duration = Date.parse(finishedAt) - Date.parse(startedAt);
  return Number.isFinite(duration) && duration >= 0 ? duration : undefined;
}

function sanitizeArtifactLocation(value: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(value)) {
    return `urn:sha256:${sha256(value)}`;
  }
  return sanitizeString(value).replace(/\.\.(?:\/|\\)/gu, "");
}

function sanitizeRecord(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, AssertionValue>> {
  return sanitizeValue(value as AssertionValue) as Readonly<
    Record<string, AssertionValue>
  >;
}

function sanitizeValue(value: AssertionValue): AssertionValue {
  if (typeof value === "string") return sanitizeString(value);
  if (Array.isArray(value)) return value.slice(0, 200).map(sanitizeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 200)
        .map(([key, item]) => [
          sanitizeString(key),
          sensitiveKey(key) ? "[redacted]" : sanitizeValue(item),
        ]),
    );
  }
  return value;
}

function sensitiveKey(key: string): boolean {
  return /authorization|cookie|password|secret|token|api[-_]?key|email|requestbody|responsebody/iu.test(
    key,
  );
}

function sanitizeString(value: string): string {
  return value
    .replace(
      /(?:bearer\s+|api[_-]?key[=:]\s*|password[=:]\s*|token[=:]\s*)[^\s,;]+/giu,
      "[redacted]",
    )
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[redacted-email]")
    .slice(0, 1000);
}
