import { createHash } from "node:crypto";

import type { ProviderCallLedgerEntry } from "./types.js";

interface MatchEvent {
  readonly vendorId: string;
  readonly operationId?: string;
  readonly caseId?: string;
  readonly unmatched: boolean;
  readonly correlationId?: string;
}

interface StateEvent {
  readonly operationId?: string;
  readonly caseId?: string;
  readonly correlationId?: string;
  readonly stateBefore?: string;
  readonly stateAfter?: string;
  readonly stateRequestCount?: number;
  readonly sequenceIndex?: number;
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
  const stateEvents: StateEvent[] = [];
  const summaries: SummaryEvent[] = [];

  for (const line of logs.split(/\r?\n/u)) {
    const matchEvent = parseMatchEvent(line);
    if (matchEvent) {
      matchEvents.push(matchEvent);
      continue;
    }

    const stateEvent = parseStateEvent(line);
    if (stateEvent) {
      stateEvents.push(stateEvent);
      continue;
    }

    const summary = parseSummaryEvent(line);
    if (summary) {
      summaries.push(summary);
    }
  }

  const summariesByCorrelation = groupByCorrelation(summaries);
  const statesByCorrelation = groupByCorrelation(stateEvents);
  const statesByCase = new Map<string, StateEvent[]>();
  for (const stateEvent of stateEvents) {
    const key = caseKey(stateEvent.operationId, stateEvent.caseId);
    if (!key) {
      continue;
    }
    const values = statesByCase.get(key) ?? [];
    values.push(stateEvent);
    statesByCase.set(key, values);
  }

  const uncorrelated = summaries.filter((summary) => !summary.correlationId);
  let uncorrelatedIndex = 0;

  return matchEvents.map((matchEvent) => {
    let summary: SummaryEvent | undefined;
    let state: StateEvent | undefined;

    if (matchEvent.correlationId) {
      summary = summariesByCorrelation.get(matchEvent.correlationId)?.shift();
      state = statesByCorrelation.get(matchEvent.correlationId)?.shift();
    }

    if (!summary) {
      summary = uncorrelated[uncorrelatedIndex];
      if (summary) {
        uncorrelatedIndex += 1;
      }
    }

    if (!state) {
      const key = caseKey(matchEvent.operationId, matchEvent.caseId);
      state = key ? statesByCase.get(key)?.shift() : undefined;
    }

    return {
      ...matchEvent,
      ...(summary ?? {}),
      ...(state ?? {}),
      ...(matchEvent.correlationId
        ? { correlationId: matchEvent.correlationId }
        : summary?.correlationId
          ? { correlationId: summary.correlationId }
          : state?.correlationId
            ? { correlationId: state.correlationId }
            : {}),
    };
  });
}

function parseMatchEvent(line: string): MatchEvent | undefined {
  const marker = markerText(line);
  if (!marker) {
    return undefined;
  }

  const type = marker.startsWith("TESTY_MATCH")
    ? "match"
    : marker.startsWith("TESTY_UNMATCHED")
      ? "unmatched"
      : undefined;
  if (!type) {
    return undefined;
  }

  const fields = parseMarkerFields(marker);
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

function parseStateEvent(line: string): StateEvent | undefined {
  const marker = markerText(line);
  if (!marker?.startsWith("TESTY_STATE")) {
    return undefined;
  }

  const fields = parseMarkerFields(marker);
  const stateRequestCount = toNumber(fields.stateRequestCount);
  const sequenceIndex = fields.sequenceIndex === "none"
    ? undefined
    : toNumber(fields.sequenceIndex);

  return {
    ...(fields.operation ? { operationId: fields.operation } : {}),
    ...(fields.case ? { caseId: fields.case } : {}),
    ...(isUsefulCorrelation(fields.correlation)
      ? { correlationId: fields.correlation }
      : {}),
    ...(fields.state ? { stateBefore: fields.state } : {}),
    ...(fields.nextState ? { stateAfter: fields.nextState } : {}),
    ...(stateRequestCount !== undefined ? { stateRequestCount } : {}),
    ...(sequenceIndex !== undefined ? { sequenceIndex } : {}),
  };
}

function markerText(line: string): string | undefined {
  const markerIndex = line.indexOf("TESTY_");
  return markerIndex === -1 ? undefined : line.slice(markerIndex).trim();
}

function parseMarkerFields(marker: string): Readonly<Record<string, string>> {
  return Object.fromEntries(
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

function groupByCorrelation<T extends { readonly correlationId?: string }>(
  values: readonly T[],
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values) {
    if (!value.correlationId) {
      continue;
    }
    const group = grouped.get(value.correlationId) ?? [];
    group.push(value);
    grouped.set(value.correlationId, group);
  }
  return grouped;
}

function caseKey(
  operationId: string | undefined,
  caseId: string | undefined,
): string | undefined {
  return operationId && caseId ? `${operationId}\u0000${caseId}` : undefined;
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
  return Boolean(
    value &&
      !value.includes("${") &&
      value !== "null" &&
      value !== "undefined" &&
      value !== "none",
  );
}

function fingerprintPath(path: string): string {
  return createHash("sha256").update(path).digest("hex");
}
