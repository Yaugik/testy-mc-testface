import type {
  ProviderCallLedgerEntry,
  RunningVendorRuntime,
  RuntimeStateSnapshot,
} from "./types.js";

export interface StatefulRuntimeSmokeFixture {
  readonly authenticationHeaders?: Readonly<Record<string, string>>;
  readonly recovery: {
    readonly path: string;
    readonly caseId: string;
    readonly logicalStore: string;
    readonly attemptsKey: string;
    readonly outcomeKey: string;
    readonly recoveredOutcome: string;
    readonly expectedSequenceIndexes: readonly number[];
  };
  readonly stateTransition: {
    readonly triggerPath: string;
    readonly triggerCaseId: string;
    readonly probePath: string;
    readonly probeCaseId: string;
    readonly unavailableState: string;
    readonly healthyState: string;
    readonly requestsBeforeRecovery: number;
  };
}

export interface StatefulRuntimeSmokeOptions {
  readonly fetcher?: typeof fetch;
  readonly requestTimeoutMs?: number;
  readonly correlationPrefix?: string;
  readonly resetAfter?: boolean;
}

export interface StatefulRuntimeSmokeCheck {
  readonly id: string;
  readonly passed: boolean;
  readonly message: string;
  readonly correlationId?: string;
  readonly statusCode?: number;
  readonly transportError?: string;
}

export interface StatefulRuntimeSmokeReport {
  readonly schemaVersion: "1.0";
  readonly vendorId: string;
  readonly bundleId: string;
  readonly passed: boolean;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly checks: readonly StatefulRuntimeSmokeCheck[];
  readonly ledgerEntries: number;
  readonly finalState?: RuntimeStateSnapshot;
}

interface RequestResult {
  readonly correlationId: string;
  readonly statusCode?: number;
  readonly transportError?: string;
}

export async function runStatefulRuntimeSmoke(
  runtime: RunningVendorRuntime,
  fixture: StatefulRuntimeSmokeFixture,
  options: StatefulRuntimeSmokeOptions = {},
): Promise<StatefulRuntimeSmokeReport> {
  const fetcher = options.fetcher ?? fetch;
  const requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
  const correlationPrefix =
    options.correlationPrefix ?? `smoke-${runtime.bundle.bundleId.slice(0, 12)}`;
  const resetAfter = options.resetAfter ?? true;
  const startedAt = new Date().toISOString();
  const checks: StatefulRuntimeSmokeCheck[] = [];
  const expectedCorrelations = new Set<string>();

  await runtime.resetState();

  const recoveryExpectations = [
    { id: "recovery-timeout", transportError: true },
    { id: "recovery-unavailable", statusCode: 503 },
    { id: "recovery-success", statusCode: 200 },
    { id: "recovery-repeat-last", statusCode: 200 },
  ] as const;

  for (const expectation of recoveryExpectations) {
    const result = await requestProvider(
      runtime,
      fixture.recovery.path,
      expectation.id,
      correlationPrefix,
      fixture.authenticationHeaders ?? {},
      requestTimeoutMs,
      fetcher,
    );
    expectedCorrelations.add(result.correlationId);

    if ("transportError" in expectation) {
      checks.push({
        id: expectation.id,
        passed: result.transportError !== undefined,
        message:
          result.transportError !== undefined
            ? "Provider closed or timed out the connection as expected."
            : `Expected a transport error, received HTTP ${String(result.statusCode)}.`,
        correlationId: result.correlationId,
        ...(result.statusCode !== undefined
          ? { statusCode: result.statusCode }
          : {}),
        ...(result.transportError
          ? { transportError: result.transportError }
          : {}),
      });
    } else {
      checks.push(statusCheck(expectation.id, expectation.statusCode, result));
    }
  }

  const recoverySnapshot = await runtime.stateSnapshot();
  checks.push(
    snapshotValueCheck(
      "recovery-attempt-count",
      recoverySnapshot?.user[fixture.recovery.logicalStore]?.[
        fixture.recovery.attemptsKey
      ],
      "4",
    ),
  );
  checks.push(
    snapshotValueCheck(
      "recovery-outcome",
      recoverySnapshot?.user[fixture.recovery.logicalStore]?.[
        fixture.recovery.outcomeKey
      ],
      fixture.recovery.recoveredOutcome,
    ),
  );

  await runtime.resetState();

  const triggerResult = await requestProvider(
    runtime,
    fixture.stateTransition.triggerPath,
    "state-trigger",
    correlationPrefix,
    fixture.authenticationHeaders ?? {},
    requestTimeoutMs,
    fetcher,
  );
  expectedCorrelations.add(triggerResult.correlationId);
  checks.push(statusCheck("state-trigger", 503, triggerResult));

  const triggeredSnapshot = await runtime.stateSnapshot();
  checks.push(
    snapshotValueCheck(
      "state-entered-unavailable",
      triggeredSnapshot?.currentState,
      fixture.stateTransition.unavailableState,
    ),
  );

  for (
    let requestIndex = 1;
    requestIndex <= fixture.stateTransition.requestsBeforeRecovery;
    requestIndex += 1
  ) {
    const id = `state-unavailable-${requestIndex}`;
    const result = await requestProvider(
      runtime,
      fixture.stateTransition.probePath,
      id,
      correlationPrefix,
      fixture.authenticationHeaders ?? {},
      requestTimeoutMs,
      fetcher,
    );
    expectedCorrelations.add(result.correlationId);
    checks.push(statusCheck(id, 503, result));
  }

  const recoveredStateSnapshot = await runtime.stateSnapshot();
  checks.push(
    snapshotValueCheck(
      "state-transitioned-healthy",
      recoveredStateSnapshot?.currentState,
      fixture.stateTransition.healthyState,
    ),
  );

  const healthyResult = await requestProvider(
    runtime,
    fixture.stateTransition.probePath,
    "state-healthy-response",
    correlationPrefix,
    fixture.authenticationHeaders ?? {},
    requestTimeoutMs,
    fetcher,
  );
  expectedCorrelations.add(healthyResult.correlationId);
  checks.push(statusCheck("state-healthy-response", 200, healthyResult));

  const finalState = await runtime.stateSnapshot();
  const ledger = await runtime.collectLedger();
  addLedgerChecks(checks, ledger, expectedCorrelations, fixture);

  if (resetAfter) {
    await runtime.resetState();
  }

  return {
    schemaVersion: "1.0",
    vendorId: runtime.bundle.manifest.vendor.id,
    bundleId: runtime.bundle.bundleId,
    passed: checks.every((check) => check.passed),
    startedAt,
    completedAt: new Date().toISOString(),
    checks,
    ledgerEntries: ledger.length,
    ...(finalState ? { finalState } : {}),
  };
}

async function requestProvider(
  runtime: RunningVendorRuntime,
  path: string,
  stepId: string,
  correlationPrefix: string,
  authenticationHeaders: Readonly<Record<string, string>>,
  timeoutMs: number,
  fetcher: typeof fetch,
): Promise<RequestResult> {
  const correlationId = `${correlationPrefix}-${stepId}`;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Request exceeded ${timeoutMs}ms.`)),
    timeoutMs,
  );

  try {
    const response = await fetcher(
      joinProviderUrl(runtime.providerBaseUrl, path),
      {
        method: "GET",
        headers: {
          ...authenticationHeaders,
          "X-Testy-Correlation-ID": correlationId,
        },
        signal: controller.signal,
      },
    );
    await response.arrayBuffer();
    return { correlationId, statusCode: response.status };
  } catch (error) {
    return {
      correlationId,
      transportError: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function statusCheck(
  id: string,
  expectedStatus: number,
  result: RequestResult,
): StatefulRuntimeSmokeCheck {
  const passed = result.statusCode === expectedStatus;
  return {
    id,
    passed,
    message: passed
      ? `Received expected HTTP ${expectedStatus}.`
      : result.transportError
        ? `Expected HTTP ${expectedStatus}, received transport error: ${result.transportError}`
        : `Expected HTTP ${expectedStatus}, received HTTP ${String(result.statusCode)}.`,
    correlationId: result.correlationId,
    ...(result.statusCode !== undefined
      ? { statusCode: result.statusCode }
      : {}),
    ...(result.transportError
      ? { transportError: result.transportError }
      : {}),
  };
}

function snapshotValueCheck(
  id: string,
  actual: unknown,
  expected: unknown,
): StatefulRuntimeSmokeCheck {
  const passed = actual === expected;
  return {
    id,
    passed,
    message: passed
      ? `Observed expected value '${String(expected)}'.`
      : `Expected '${String(expected)}', observed '${String(actual)}'.`,
  };
}

function addLedgerChecks(
  checks: StatefulRuntimeSmokeCheck[],
  ledger: readonly ProviderCallLedgerEntry[],
  expectedCorrelations: ReadonlySet<string>,
  fixture: StatefulRuntimeSmokeFixture,
): void {
  const ledgerCorrelations = new Set(
    ledger.flatMap((entry) =>
      entry.correlationId ? [entry.correlationId] : [],
    ),
  );
  const missing = [...expectedCorrelations].filter(
    (correlationId) => !ledgerCorrelations.has(correlationId),
  );
  checks.push({
    id: "ledger-correlation",
    passed: missing.length === 0,
    message:
      missing.length === 0
        ? `Ledger contains all ${expectedCorrelations.size} smoke-test correlations.`
        : `Ledger is missing correlations: ${missing.join(", ")}.`,
  });

  const recoveryEntries = ledger.filter(
    (entry) =>
      entry.caseId === fixture.recovery.caseId &&
      entry.correlationId !== undefined &&
      expectedCorrelations.has(entry.correlationId),
  );
  const observedSequenceIndexes = recoveryEntries.flatMap((entry) =>
    entry.sequenceIndex === undefined ? [] : [entry.sequenceIndex],
  );
  checks.push({
    id: "ledger-sequence-indexes",
    passed:
      observedSequenceIndexes.length >=
        fixture.recovery.expectedSequenceIndexes.length &&
      fixture.recovery.expectedSequenceIndexes.every(
        (index, position) => observedSequenceIndexes[position] === index,
      ),
    message: `Observed recovery sequence indexes: ${observedSequenceIndexes.join(", ") || "none"}.`,
  });

  const transitionEntry = ledger.find(
    (entry) =>
      entry.caseId === fixture.stateTransition.probeCaseId &&
      entry.correlationId !== undefined &&
      expectedCorrelations.has(entry.correlationId) &&
      entry.stateAfter === fixture.stateTransition.healthyState,
  );
  const triggerEntry = ledger.find(
    (entry) =>
      entry.caseId === fixture.stateTransition.triggerCaseId &&
      entry.correlationId !== undefined &&
      expectedCorrelations.has(entry.correlationId),
  );
  checks.push({
    id: "ledger-state-trigger",
    passed: triggerEntry !== undefined,
    message:
      triggerEntry !== undefined
        ? "Ledger recorded the explicit unavailable-state trigger."
        : "Ledger did not record the explicit unavailable-state trigger.",
  });

  checks.push({
    id: "ledger-state-transition",
    passed: transitionEntry !== undefined,
    message:
      transitionEntry !== undefined
        ? `Ledger recorded transition to '${fixture.stateTransition.healthyState}'.`
        : `Ledger did not record transition to '${fixture.stateTransition.healthyState}'.`,
  });
}

function joinProviderUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(path.replace(/^\/+/, ""), normalizedBase).toString();
}
