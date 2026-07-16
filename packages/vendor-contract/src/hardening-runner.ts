import type {
  ProviderCallLedgerEntry,
  RunningVendorRuntime,
  RuntimeStateSnapshot,
} from "@testy/vendor-runtime";

import { runVendorContractSuite } from "./runner.js";
import type {
  CountExpectation,
  NumericRangeExpectation,
  RunVendorContractOptions,
  VendorCallExpectations,
  VendorContractCase,
  VendorContractCheck,
  VendorContractReport,
  VendorContractSuite,
  VendorIsolationReport,
  VendorStateExpectation,
  VendorStepExpectation,
} from "./types.js";

export async function runHardenedVendorContractSuite(
  runtime: RunningVendorRuntime,
  suite: VendorContractSuite,
  options: RunVendorContractOptions = {},
): Promise<VendorContractReport> {
  const prefix =
    options.correlationPrefix ??
    `${suite.suiteId}-${runtime.bundle.bundleId.slice(0, 10)}`;
  const base = await runVendorContractSuite(runtime, suite, {
    ...options,
    correlationPrefix: prefix,
    resetAfter: false,
  });
  const ledger = await waitForSettledLedger(runtime, options);
  const checks = [...base.checks];

  for (const contractCase of suite.cases) {
    const entries = ledger.filter((entry) =>
      entry.correlationId?.startsWith(`${prefix}-${contractCase.id}-`),
    );
    addStepTimingChecks(checks, contractCase, entries, prefix);
    if (contractCase.expect?.calls) {
      addCallChecks(checks, contractCase, entries, contractCase.expect.calls);
    }
  }

  if (options.resetAfter ?? true) {
    await runtime.resetState();
  }

  return {
    ...base,
    passed: checks.every((check) => check.passed),
    completedAt: new Date().toISOString(),
    checks,
  };
}

export async function runVendorIsolationSuite(
  left: RunningVendorRuntime,
  right: RunningVendorRuntime,
  suite: VendorContractSuite,
  options: RunVendorContractOptions = {},
): Promise<VendorIsolationReport> {
  const definition = suite.isolation;
  if (!definition) {
    throw new Error(`Vendor contract suite '${suite.suiteId}' has no isolation definition.`);
  }

  const startedAt = new Date().toISOString();
  const checks: VendorContractCheck[] = [];
  const correlationId = `${options.correlationPrefix ?? `${suite.suiteId}-isolation`}-${definition.id}`;
  await Promise.all([left.resetState(), right.resetState()]);

  const sharedStores = physicalStores(left).filter((name) =>
    physicalStores(right).includes(name),
  );
  checks.push(
    makeCheck(
      `${definition.id}.physical-stores`,
      sharedStores.length === 0,
      sharedStores.length === 0
        ? "Generated physical store names are disjoint."
        : `Shared physical stores: ${sharedStores.join(", ")}.`,
      definition.id,
    ),
  );

  const result = await executeIsolationRequest(
    left,
    suite,
    definition.request,
    correlationId,
    options.fetcher ?? fetch,
  );
  addTransportChecks(
    checks,
    definition.id,
    correlationId,
    definition.expect,
    result,
  );

  const leftEntry = needsLedger(definition.expect)
    ? await waitForLedgerEntry(left, correlationId, options)
    : undefined;
  addLedgerExpectationChecks(
    checks,
    definition.id,
    correlationId,
    definition.expect,
    leftEntry,
  );

  const [leftSnapshot, rightSnapshot, rightLedger] = await Promise.all([
    left.stateSnapshot(),
    right.stateSnapshot(),
    right.collectLedger(),
  ]);
  addStateChecks(checks, definition.id, "mutated", definition.mutated, leftSnapshot);
  addStateChecks(
    checks,
    definition.id,
    "untouched",
    definition.untouched,
    rightSnapshot,
  );
  checks.push(
    makeCheck(
      `${definition.id}.ledger-isolation`,
      !rightLedger.some((entry) => entry.correlationId === correlationId),
      "Untouched runtime must not observe the mutating runtime correlation.",
      definition.id,
      undefined,
      correlationId,
    ),
  );

  if (options.resetAfter ?? true) {
    await Promise.all([left.resetState(), right.resetState()]);
  }

  return {
    schemaVersion: "1.0",
    suiteId: suite.suiteId,
    vendorId: left.bundle.manifest.vendor.id,
    bundleIds: [left.bundle.bundleId, right.bundle.bundleId],
    passed: checks.every((check) => check.passed),
    startedAt,
    completedAt: new Date().toISOString(),
    checks,
  };
}

function addStepTimingChecks(
  checks: VendorContractCheck[],
  contractCase: VendorContractCase,
  entries: readonly ProviderCallLedgerEntry[],
  prefix: string,
): void {
  for (const step of contractCase.steps) {
    if (!step.expect.durationMs) {
      continue;
    }
    const correlationId = `${prefix}-${contractCase.id}-${step.id}`;
    const entry = entries.find(
      (candidate) => candidate.correlationId === correlationId,
    );
    checks.push(
      makeRangeCheck(
        `${contractCase.id}.${step.id}.duration-ms`,
        entry?.durationMs,
        step.expect.durationMs,
        "provider duration",
        contractCase.id,
        step.id,
        correlationId,
      ),
    );
  }
}

function addCallChecks(
  checks: VendorContractCheck[],
  contractCase: VendorContractCase,
  entries: readonly ProviderCallLedgerEntry[],
  expectation: VendorCallExpectations,
): void {
  if (expectation.total) {
    checks.push(
      makeCountCheck(
        `${contractCase.id}.calls.total`,
        entries.length,
        expectation.total,
        "total provider calls",
        contractCase.id,
      ),
    );
  }

  for (const [caseId, expected] of Object.entries(expectation.byCase ?? {})) {
    checks.push(
      makeCountCheck(
        `${contractCase.id}.calls.case.${caseId}`,
        entries.filter((entry) => entry.caseId === caseId).length,
        expected,
        `calls matching '${caseId}'`,
        contractCase.id,
      ),
    );
  }

  for (const caseId of expectation.absentCases ?? []) {
    const count = entries.filter((entry) => entry.caseId === caseId).length;
    checks.push(
      makeCheck(
        `${contractCase.id}.calls.absent.${caseId}`,
        count === 0,
        `Expected no calls matching '${caseId}', observed ${count}.`,
        contractCase.id,
      ),
    );
  }

  if (expectation.orderedCases) {
    const actual = entries.map((entry) => entry.caseId ?? "unmatched");
    checks.push(
      makeCheck(
        `${contractCase.id}.calls.order`,
        equal(actual, expectation.orderedCases),
        `Expected ${JSON.stringify(expectation.orderedCases)}, observed ${JSON.stringify(actual)}.`,
        contractCase.id,
      ),
    );
  }

  if (expectation.durationMs) {
    const durations = entries.map((entry) => entry.durationMs);
    checks.push(
      makeCheck(
        `${contractCase.id}.calls.duration-ms`,
        entries.length > 0 &&
          durations.every(
            (value) =>
              value !== undefined && within(value, expectation.durationMs as NumericRangeExpectation),
          ),
        `Observed durations: ${durations.join(", ") || "none"}.`,
        contractCase.id,
      ),
    );
  }

  if (expectation.retryIntervalMs) {
    const times = entries.map((entry) =>
      entry.timestamp ? Date.parse(entry.timestamp) : Number.NaN,
    );
    const intervals = times.slice(1).map((time, index) => {
      const previous = times[index];
      return previous === undefined ? Number.NaN : time - previous;
    });
    checks.push(
      makeCheck(
        `${contractCase.id}.calls.retry-interval-ms`,
        intervals.length > 0 &&
          intervals.every(
            (value) =>
              Number.isFinite(value) &&
              within(value, expectation.retryIntervalMs as NumericRangeExpectation),
          ),
        `Observed retry intervals: ${intervals.join(", ") || "none"}.`,
        contractCase.id,
      ),
    );
  }
}

async function waitForSettledLedger(
  runtime: RunningVendorRuntime,
  options: RunVendorContractOptions,
): Promise<readonly ProviderCallLedgerEntry[]> {
  const timeoutMs = options.ledgerTimeoutMs ?? 2_000;
  const intervalMs = options.ledgerPollIntervalMs ?? 50;
  const requiredStablePolls = options.ledgerSettlePolls ?? 2;
  const deadline = Date.now() + timeoutMs;
  let previous = "";
  let stable = 0;
  let latest: readonly ProviderCallLedgerEntry[] = [];

  while (Date.now() <= deadline) {
    latest = await runtime.collectLedger();
    const signature = latest
      .map((entry) => `${entry.correlationId ?? ""}:${entry.timestamp ?? ""}`)
      .join("|");
    stable = signature === previous ? stable + 1 : 0;
    previous = signature;
    if (stable >= requiredStablePolls) {
      return latest;
    }
    await sleep(intervalMs);
  }
  return latest;
}

interface IsolationRequestResult {
  readonly status?: number;
  readonly transportError?: string;
}

async function executeIsolationRequest(
  runtime: RunningVendorRuntime,
  suite: VendorContractSuite,
  request: NonNullable<VendorContractSuite["isolation"]>["request"],
  correlationId: string,
  fetcher: typeof fetch,
): Promise<IsolationRequestResult> {
  const controller = new AbortController();
  const timeoutMs = request.timeoutMs ?? suite.defaults?.requestTimeoutMs ?? 10_000;
  const timer = setTimeout(
    () => controller.abort(new Error(`Request exceeded ${timeoutMs}ms.`)),
    timeoutMs,
  );
  try {
    const headers: Record<string, string> = {
      ...(suite.defaults?.headers ?? {}),
      ...(request.headers ?? {}),
      "X-Testy-Correlation-ID": correlationId,
    };
    if (request.jsonBody !== undefined) {
      headers["content-type"] ??= "application/json";
    }
    const url = buildUrl(
      runtime.providerBaseUrl,
      request.path,
      suite.defaults?.query,
      request.query,
    );
    const response = await fetcher(url, {
      method: request.method,
      headers,
      ...(request.jsonBody !== undefined
        ? { body: JSON.stringify(request.jsonBody) }
        : {}),
      signal: controller.signal,
    });
    await response.arrayBuffer();
    return { status: response.status };
  } catch (error) {
    return {
      transportError: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function addTransportChecks(
  checks: VendorContractCheck[],
  caseId: string,
  correlationId: string,
  expectation: VendorStepExpectation,
  result: IsolationRequestResult,
): void {
  if (expectation.status !== undefined) {
    checks.push(
      makeCheck(
        `${caseId}.status`,
        result.status === expectation.status,
        `Expected HTTP ${expectation.status}, observed ${String(result.status)}.`,
        caseId,
        "mutate-left-runtime",
        correlationId,
      ),
    );
  }
  if (expectation.transportError) {
    checks.push(
      makeCheck(
        `${caseId}.transport`,
        result.transportError !== undefined,
        result.transportError
          ? "Observed expected transport error."
          : `Expected transport error, observed HTTP ${String(result.status)}.`,
        caseId,
        "mutate-left-runtime",
        correlationId,
      ),
    );
  }
}

function needsLedger(expectation: VendorStepExpectation): boolean {
  return (
    expectation.matchedCase !== undefined ||
    expectation.sequenceIndex !== undefined ||
    expectation.stateBefore !== undefined ||
    expectation.stateAfter !== undefined ||
    expectation.durationMs !== undefined
  );
}

async function waitForLedgerEntry(
  runtime: RunningVendorRuntime,
  correlationId: string,
  options: RunVendorContractOptions,
): Promise<ProviderCallLedgerEntry | undefined> {
  const deadline = Date.now() + (options.ledgerTimeoutMs ?? 2_000);
  const interval = options.ledgerPollIntervalMs ?? 50;
  while (Date.now() <= deadline) {
    const entry = (await runtime.collectLedger()).find(
      (candidate) => candidate.correlationId === correlationId,
    );
    if (entry) {
      return entry;
    }
    await sleep(interval);
  }
  return undefined;
}

function addLedgerExpectationChecks(
  checks: VendorContractCheck[],
  caseId: string,
  correlationId: string,
  expectation: VendorStepExpectation,
  entry: ProviderCallLedgerEntry | undefined,
): void {
  if (!needsLedger(expectation)) {
    return;
  }
  if (!entry) {
    checks.push(
      makeCheck(
        `${caseId}.ledger`,
        false,
        "No correlated provider ledger entry was observed.",
        caseId,
        "mutate-left-runtime",
        correlationId,
      ),
    );
    return;
  }
  addValueCheck(checks, caseId, correlationId, "matched-case", entry.caseId, expectation.matchedCase);
  addValueCheck(checks, caseId, correlationId, "sequence-index", entry.sequenceIndex, expectation.sequenceIndex);
  addValueCheck(checks, caseId, correlationId, "state-before", entry.stateBefore, expectation.stateBefore);
  addValueCheck(checks, caseId, correlationId, "state-after", entry.stateAfter, expectation.stateAfter);
  if (expectation.durationMs) {
    checks.push(
      makeRangeCheck(
        `${caseId}.duration-ms`,
        entry.durationMs,
        expectation.durationMs,
        "provider duration",
        caseId,
        "mutate-left-runtime",
        correlationId,
      ),
    );
  }
}

function addValueCheck(
  checks: VendorContractCheck[],
  caseId: string,
  correlationId: string,
  suffix: string,
  actual: unknown,
  expected: unknown,
): void {
  if (expected === undefined) {
    return;
  }
  checks.push(
    makeCheck(
      `${caseId}.${suffix}`,
      equal(actual, expected),
      `Expected ${JSON.stringify(expected)}, observed ${JSON.stringify(actual)}.`,
      caseId,
      "mutate-left-runtime",
      correlationId,
    ),
  );
}

function addStateChecks(
  checks: VendorContractCheck[],
  caseId: string,
  qualifier: string,
  expectation: VendorStateExpectation,
  snapshot: RuntimeStateSnapshot | undefined,
): void {
  if (expectation.state !== undefined) {
    checks.push(
      makeCheck(
        `${caseId}.${qualifier}.state`,
        snapshot?.currentState === expectation.state,
        `Expected '${expectation.state}', observed '${String(snapshot?.currentState)}'.`,
        caseId,
      ),
    );
  }
  for (const [storeName, values] of Object.entries(expectation.stores ?? {})) {
    for (const [key, expected] of Object.entries(values)) {
      const actual = snapshot?.user[storeName]?.[key];
      checks.push(
        makeCheck(
          `${caseId}.${qualifier}.store.${storeName}.${key}`,
          equal(actual, expected),
          `Expected ${JSON.stringify(expected)}, observed ${JSON.stringify(actual)}.`,
          caseId,
        ),
      );
    }
  }
  for (const [storeName, keys] of Object.entries(
    expectation.absentStoreKeys ?? {},
  )) {
    for (const key of keys) {
      const store = snapshot?.user[storeName];
      const present = store !== undefined && Object.hasOwn(store, key);
      checks.push(
        makeCheck(
          `${caseId}.${qualifier}.absent.${storeName}.${key}`,
          !present,
          `Expected '${storeName}.${key}' to be absent.`,
          caseId,
        ),
      );
    }
  }
}

function physicalStores(runtime: RunningVendorRuntime): readonly string[] {
  const stores = runtime.bundle.manifest.state.stores;
  return stores
    ? [stores.state, stores.counters, stores.sequences, ...Object.values(stores.user)].sort()
    : [];
}

function makeCountCheck(
  id: string,
  actual: number,
  expectation: CountExpectation,
  label: string,
  caseId: string,
): VendorContractCheck {
  const passed =
    expectation.exact !== undefined
      ? actual === expectation.exact
      : (expectation.min === undefined || actual >= expectation.min) &&
        (expectation.max === undefined || actual <= expectation.max);
  return makeCheck(
    id,
    passed,
    `Expected ${label} ${formatCount(expectation)}, observed ${actual}.`,
    caseId,
  );
}

function makeRangeCheck(
  id: string,
  actual: number | undefined,
  expectation: NumericRangeExpectation,
  label: string,
  caseId: string,
  stepId?: string,
  correlationId?: string,
): VendorContractCheck {
  return makeCheck(
    id,
    actual !== undefined && within(actual, expectation),
    `Expected ${label} ${formatRange(expectation)}, observed ${String(actual)}.`,
    caseId,
    stepId,
    correlationId,
  );
}

function makeCheck(
  id: string,
  passed: boolean,
  message: string,
  caseId: string,
  stepId?: string,
  correlationId?: string,
): VendorContractCheck {
  return {
    id,
    passed,
    message,
    caseId,
    ...(stepId ? { stepId } : {}),
    ...(correlationId ? { correlationId } : {}),
  };
}

function within(value: number, range: NumericRangeExpectation): boolean {
  return (
    (range.min === undefined || value >= range.min) &&
    (range.max === undefined || value <= range.max)
  );
}

function formatCount(value: CountExpectation): string {
  return value.exact !== undefined ? `to equal ${value.exact}` : formatRange(value);
}

function formatRange(value: NumericRangeExpectation): string {
  if (value.min !== undefined && value.max !== undefined) {
    return `between ${value.min} and ${value.max}`;
  }
  return value.min !== undefined
    ? `to be at least ${value.min}`
    : `to be at most ${String(value.max)}`;
}

function buildUrl(
  baseUrl: string,
  path: string,
  defaultQuery: Readonly<Record<string, string>> | undefined,
  requestQuery: Readonly<Record<string, string>> | undefined,
): string {
  const url = new URL(path.replace(/^\/+/, ""), baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  for (const [key, value] of Object.entries({
    ...(defaultQuery ?? {}),
    ...(requestQuery ?? {}),
  })) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function sleep(durationMs: number): Promise<void> {
  await new Promise<void>((resolveSleep) => setTimeout(resolveSleep, durationMs));
}
