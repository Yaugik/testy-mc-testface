import { createHash } from "node:crypto";

import type { ProviderCallLedgerEntry } from "./types.js";

interface MatchEvent {
  readonly vendorId: string;
  readonly operationId?: string;
  readonly caseId?: string;
  readonly unmatched: boolean;
  readonly correlationId?: string;
}

interface SummaryEvent {
  readonly timestamp?: string;
  readonly method?: string;
  readonly pathFingerprint?: string;
  readonly statusCode?: number;
  readonly durationMs?: number;
  readonly correlationId?: string;
}

export function parseProviderCallLedger(
  logs: string,
): readonly ProviderCallLedgerEntry[] {
  const matchEvents: MatchEvent[] = [];
  const summaries: SummaryEvent[] = [];

  for (const line of logs.split(/\r?\n/u)) {
    const matchEvent = parseMatchEvent(line);
    if (matchEvent) {
      matchEvents.push(matchEvent);
      continue;
    }

    const summary = parseSummaryEvent(line);
    if (summary) {
      summaries.push(summary);
    }
  }

  const summariesByCorrelation = new Map<string, SummaryEvent[]>();
  const uncorrelated = summaries.filter((summary) => !summary.correlationId);
  for (const summary of summaries) {
    if (!summary.correlationId) {
      continue;
    }
    const values = summariesByCorrelation.get(summary.correlationId) ?? [];
    values.push(summary);
    summariesByCorrelation.set(summary.correlationId, values);
  }

  let uncorrelatedIndex = 0;
  return matchEvents.map((matchEvent) => {
    let summary: SummaryEvent | undefined;
    if (matchEvent.correlationId) {
      const candidates = summariesByCorrelation.get(matchEvent.correlationId);
      summary = candidates?.shift();
    }
    if (!summary) {
      summary = uncorrelated[uncorrelatedIndex];
      if (summary) {
        uncorrelatedIndex += 1;
      }
    }

    return {
      ...matchEvent,
      ...(summary ?? {}),
      ...(matchEvent.correlationId
        ? { correlationId: matchEvent.correlationId }
        : summary?.correlationId
          ? { correlationId: summary.correlationId }
          : {}),
    };
  });
}

function parseMatchEvent(line: string): MatchEvent | undefined {
  const markerIndex = line.indexOf("TESTY_");
  if (markerIndex === -1) {
    return undefined;
  }

  const marker = line.slice(markerIndex).trim();
  const type = marker.startsWith("TESTY_MATCH")
    ? "match"
    : marker.startsWith("TESTY_UNMATCHED")
      ? "unmatched"
      : undefined;
  if (!type) {
    return undefined;
  }

  const fields = Object.fromEntries(
    marker
      .split(/\s+/u)
      .slice(1)
      .map((part) => {
        const separator = part.indexOf("=");
        return separator === -1
          ? [part, ""]
          : [part.slice(0, separator), part.slice(separator + 1)];
      }),
  );

  if (!fields.vendor) {
    return undefined;
  }

  return {
    vendorId: fields.vendor,
    ...(fields.operation ? { operationId: fields.operation } : {}),
    ...(fields.case ? { caseId: fields.case } : {}),
    unmatched: type === "unmatched",
    ...(isUsefulCorrelation(fields.correlation)
      ? { correlationId: fields.correlation }
      : {}),
  };
}

function parseSummaryEvent(line: string): SummaryEvent | undefined {
  const start = line.indexOf("{");
  if (start === -1) {
    return undefined;
  }

  try {
    const value = JSON.parse(line.slice(start)) as Record<string, unknown>;
    if (typeof value.method !== "string" || value.statusCode === undefined) {
      return undefined;
    }

    const statusCode = toNumber(value.statusCode);
    const durationMs = toNumber(value.duration);
    return {
      ...(typeof value.timestamp === "string" ? { timestamp: value.timestamp } : {}),
      method: value.method,
      ...(typeof value.path === "string"
        ? { pathFingerprint: fingerprintPath(stripQuery(value.path)) }
        : {}),
      ...(statusCode !== undefined ? { statusCode } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(typeof value["x-testy-correlation-id"] === "string"
        ? { correlationId: value["x-testy-correlation-id"] }
        : {}),
    };
  } catch {
    return undefined;
  }
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function stripQuery(path: string): string {
  return path.split("?", 1)[0] ?? path;
}

function isUsefulCorrelation(value: string | undefined): value is string {
  return Boolean(value && !value.includes("${") && value !== "null" && value !== "undefined");
}

function fingerprintPath(path: string): string {
  return createHash("sha256").update(path).digest("hex");
}
