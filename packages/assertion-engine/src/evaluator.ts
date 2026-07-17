import type { RunId } from "@testy/shared-types";

import type {
  ArtifactPresentAssertion,
  AssertionDefinition,
  AssertionEvaluator,
  AssertionResult,
  AssertionSnapshot,
  AssertionSnapshotProvider,
  AssertionValue,
  BrowserActionAssertion,
  BrowserJourneyPassedAssertion,
  NoUnexpectedExternalCallsAssertion,
  ObservationAssertion,
  ObservationCountAssertion,
  ProviderCallCountAssertion,
  ProviderCallOrderAssertion,
  ProviderCallSelector,
  StepPassedAssertion,
} from "./types.js";

const MAX_RESULT_STRING = 300;

export function createAssertionEvaluator(
  provider: AssertionSnapshotProvider,
): AssertionEvaluator {
  return async (definitions, context) => {
    throwIfAborted(context.signal);
    const snapshot = await provider.load(context.runId);
    throwIfAborted(context.signal);
    return definitions.map((definition) =>
      evaluateDefinition(definition, snapshot, context.runId),
    );
  };
}

export function evaluateAssertions(
  definitions: readonly AssertionDefinition[],
  snapshot: AssertionSnapshot,
): readonly AssertionResult[] {
  return definitions.map((definition) =>
    evaluateDefinition(definition, snapshot, snapshot.runId),
  );
}

function evaluateDefinition(
  definition: AssertionDefinition,
  snapshot: AssertionSnapshot,
  runId: RunId,
): AssertionResult {
  const evaluated = (() => {
    switch (definition.type) {
      case "provider-call-count": return evaluateProviderCallCount(definition, snapshot);
      case "provider-call-order": return evaluateProviderCallOrder(definition, snapshot);
      case "browser-journey-passed": return evaluateBrowserJourney(definition, snapshot);
      case "browser-action": return evaluateBrowserAction(definition, snapshot);
      case "observation": return evaluateObservation(definition, snapshot);
      case "observation-count": return evaluateObservationCount(definition, snapshot);
      case "step-passed": return evaluateStep(definition, snapshot);
      case "artifact-present": return evaluateArtifact(definition, snapshot);
      case "no-unexpected-external-calls": return evaluateNoUnexpectedCalls(definition, snapshot);
    }
  })();
  return {
    runId,
    assertionId: definition.id,
    type: definition.type,
    severity: definition.severity ?? "error",
    passed: evaluated.passed,
    message: sanitizeString(evaluated.message),
    ...(evaluated.expected === undefined ? {} : { expected: sanitizeValue(evaluated.expected) }),
    ...(evaluated.actual === undefined ? {} : { actual: sanitizeValue(evaluated.actual) }),
    metadata: definition.description ? { description: sanitizeString(definition.description) } : {},
    assertedAt: new Date().toISOString(),
  };
}

interface Evaluation { readonly passed: boolean; readonly message: string; readonly expected?: AssertionValue; readonly actual?: AssertionValue; }

function evaluateProviderCallCount(definition: ProviderCallCountAssertion, snapshot: AssertionSnapshot): Evaluation {
  const actual = snapshot.providerCalls.filter((record) => matchesProvider(record, definition)).length;
  const passed = matchesBounds(actual, definition.equals, definition.minimum, definition.maximum);
  return { passed, message: `Provider call count assertion '${definition.id}' ${passed ? "passed" : "failed"}.`, expected: boundsValue(definition.equals, definition.minimum, definition.maximum), actual };
}

function evaluateProviderCallOrder(definition: ProviderCallOrderAssertion, snapshot: AssertionSnapshot): Evaluation {
  const records = [...snapshot.providerCalls].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  const observed = records.map(providerLabel);
  let cursor = 0;
  for (const selector of definition.sequence) {
    const index = records.findIndex((record, recordIndex) => recordIndex >= cursor && matchesProvider(record, selector));
    if (index < 0) return { passed: false, message: `Provider call order assertion '${definition.id}' failed.`, expected: definition.sequence.map(selectorLabel), actual: observed };
    cursor = index + 1;
  }
  const passed = definition.exact !== true || records.length === definition.sequence.length;
  return { passed, message: `Provider call order assertion '${definition.id}' ${passed ? "passed" : "failed"}.`, expected: definition.sequence.map(selectorLabel), actual: observed };
}

function evaluateBrowserJourney(definition: BrowserJourneyPassedAssertion, snapshot: AssertionSnapshot): Evaluation {
  const records = snapshot.browserActions.filter((record) => record.journeyId === definition.journeyId);
  const failed = records.filter((record) => record.status !== "PASSED");
  const passed = records.length > 0 && failed.length === 0;
  return { passed, message: `Browser journey '${definition.journeyId}' ${passed ? "passed" : "did not pass"}.`, expected: { minimumActions: 1, failedActions: 0 }, actual: { actions: records.length, failedActions: failed.length } };
}

function evaluateBrowserAction(definition: BrowserActionAssertion, snapshot: AssertionSnapshot): Evaluation {
  const expectedStatus = definition.expectedStatus ?? "PASSED";
  const records = snapshot.browserActions.filter((record) => record.journeyId === definition.journeyId && (definition.stepId === undefined || record.stepId === definition.stepId) && (definition.action === undefined || record.action === definition.action) && record.status === expectedStatus);
  const minimum = definition.minimum ?? 1;
  const passed = records.length >= minimum;
  return { passed, message: `Browser action assertion '${definition.id}' ${passed ? "passed" : "failed"}.`, expected: { status: expectedStatus, minimum }, actual: records.length };
}

function evaluateObservation(definition: ObservationAssertion, snapshot: AssertionSnapshot): Evaluation {
  const records = snapshot.observations.filter((record) => record.observationType === definition.observationType && (definition.status === undefined || record.status === definition.status));
  const selected = definition.latest === false ? records[0] : records.at(-1);
  const actual = selected ? readPath(selected.value, definition.path) : undefined;
  const passed = compareObservation(definition.operator, actual, definition.expected);
  return { passed, message: `Observation assertion '${definition.id}' ${passed ? "passed" : "failed"}.`, expected: definition.operator === "present" || definition.operator === "absent" ? definition.operator : (definition.expected ?? null), actual: actual ?? null };
}

function evaluateObservationCount(definition: ObservationCountAssertion, snapshot: AssertionSnapshot): Evaluation {
  const actual = snapshot.observations.filter((record) => record.observationType === definition.observationType && (definition.status === undefined || record.status === definition.status)).length;
  const passed = matchesBounds(actual, definition.equals, definition.minimum, definition.maximum);
  return { passed, message: `Observation count assertion '${definition.id}' ${passed ? "passed" : "failed"}.`, expected: boundsValue(definition.equals, definition.minimum, definition.maximum), actual };
}

function evaluateStep(definition: StepPassedAssertion, snapshot: AssertionSnapshot): Evaluation {
  const latest = snapshot.steps.filter((record) => record.stepId === definition.stepId).sort((left, right) => left.attempt - right.attempt).at(-1);
  const passed = latest?.status === "PASSED";
  return { passed, message: `Step '${definition.stepId}' ${passed ? "passed" : "did not pass"}.`, expected: "PASSED", actual: latest?.status ?? "MISSING" };
}

function evaluateArtifact(definition: ArtifactPresentAssertion, snapshot: AssertionSnapshot): Evaluation {
  const actual = snapshot.artifacts.filter((artifact) => artifact.kind === definition.kind).length;
  const minimum = definition.minimum ?? 1;
  const passed = actual >= minimum;
  return { passed, message: `Artifact assertion '${definition.id}' ${passed ? "passed" : "failed"}.`, expected: { kind: definition.kind, minimum }, actual };
}

function evaluateNoUnexpectedCalls(definition: NoUnexpectedExternalCallsAssertion, snapshot: AssertionSnapshot): Evaluation {
  const observationType = definition.observationType ?? "gateway-ledger-summary";
  const latest = snapshot.observations.filter((record) => record.observationType === observationType).at(-1);
  const rejected = numberAt(latest?.value, "rejectedCount");
  const failed = numberAt(latest?.value, "failedCount");
  const passed = latest !== undefined && rejected === 0 && failed === 0;
  return { passed, message: `Unexpected external call assertion '${definition.id}' ${passed ? "passed" : "failed"}.`, expected: { rejectedCount: 0, failedCount: 0 }, actual: { observationPresent: latest !== undefined, rejectedCount: rejected, failedCount: failed } };
}

function matchesProvider(record: { readonly vendorId: string; readonly operationId?: string; readonly caseId?: string; readonly statusCode?: number }, selector: ProviderCallSelector): boolean {
  return record.vendorId === selector.vendorId && (selector.operationId === undefined || record.operationId === selector.operationId) && (selector.caseId === undefined || record.caseId === selector.caseId) && (selector.statusCode === undefined || record.statusCode === selector.statusCode);
}
function providerLabel(record: { readonly vendorId: string; readonly operationId?: string; readonly caseId?: string; readonly statusCode?: number }): string { return [record.vendorId, record.operationId ?? "*", record.caseId ?? "*", record.statusCode === undefined ? "*" : String(record.statusCode)].join(":"); }
function selectorLabel(selector: ProviderCallSelector): string { return providerLabel(selector); }
function matchesBounds(value: number, equals: number | undefined, minimum: number | undefined, maximum: number | undefined): boolean { if (equals !== undefined) return value === equals; if (minimum !== undefined && value < minimum) return false; if (maximum !== undefined && value > maximum) return false; return minimum !== undefined || maximum !== undefined; }
function boundsValue(equals: number | undefined, minimum: number | undefined, maximum: number | undefined): AssertionValue { return equals !== undefined ? { equals } : { ...(minimum === undefined ? {} : { minimum }), ...(maximum === undefined ? {} : { maximum }) }; }
function compareObservation(operator: ObservationAssertion["operator"], actual: AssertionValue | undefined, expected: AssertionValue | undefined): boolean { switch (operator) { case "present": return actual !== undefined && actual !== null; case "absent": return actual === undefined || actual === null; case "equals": return canonical(actual) === canonical(expected); case "not-equals": return canonical(actual) !== canonical(expected); case "contains": return contains(actual, expected); case "greater-than-or-equal": return typeof actual === "number" && typeof expected === "number" && actual >= expected; case "less-than-or-equal": return typeof actual === "number" && typeof expected === "number" && actual <= expected; } }
function contains(actual: AssertionValue | undefined, expected: AssertionValue | undefined): boolean { if (typeof actual === "string" && typeof expected === "string") return actual.includes(expected); if (Array.isArray(actual)) return actual.some((value) => canonical(value) === canonical(expected)); return false; }
function readPath(value: AssertionValue | undefined, path: string | undefined): AssertionValue | undefined { if (!path) return value; let current = value; for (const segment of path.split(".")) { if (Array.isArray(current)) { const index = Number.parseInt(segment, 10); current = Number.isInteger(index) ? current[index] : undefined; } else if (current && typeof current === "object") current = (current as Readonly<Record<string, AssertionValue>>)[segment]; else return undefined; } return current; }
function numberAt(value: AssertionValue | undefined, path: string): number { const selected = readPath(value, path); return typeof selected === "number" ? selected : -1; }
function canonical(value: AssertionValue | undefined): string { return JSON.stringify(sortValue(value)); }
function sortValue(value: AssertionValue | undefined): unknown { if (Array.isArray(value)) return value.map(sortValue); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, sortValue(item)])); return value; }
function sanitizeValue(value: AssertionValue): AssertionValue { if (typeof value === "string") return sanitizeString(value); if (Array.isArray(value)) return value.slice(0, 50).map(sanitizeValue); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 50).map(([key, item]) => [key, sensitiveKey(key) ? "[redacted]" : sanitizeValue(item)])); return value; }
function sensitiveKey(key: string): boolean { return /authorization|cookie|password|secret|token|api[-_]?key|email|body/iu.test(key); }
function sanitizeString(value: string): string { return value.replace(/(?:bearer\s+|api[_-]?key[=:]\s*|password[=:]\s*|token[=:]\s*)[^\s,;]+/giu, "[redacted]").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[redacted-email]").slice(0, MAX_RESULT_STRING); }
function throwIfAborted(signal: AbortSignal | undefined): void { if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Assertion evaluation cancelled."); }
