import type {
  ProviderCallLedgerEntry,
  RunningVendorRuntime,
  RuntimeStateSnapshot,
} from "@testy/vendor-runtime";

import type {
  RunVendorContractOptions,
  VendorContractCase,
  VendorContractCheck,
  VendorContractReport,
  VendorContractStep,
  VendorContractSuite,
} from "./types.js";

interface RequestResult {
  readonly statusCode?: number;
  readonly transportError?: string;
}

export async function runVendorContractSuite(
  runtime: RunningVendorRuntime,
  suite: VendorContractSuite,
  options: RunVendorContractOptions = {},
): Promise<VendorContractReport> {
  const startedAt = new Date().toISOString();
  const checks: VendorContractCheck[] = [];
  const fetcher = options.fetcher ?? fetch;
  const prefix =
    options.correlationPrefix ??
    `${suite.suiteId}-${runtime.bundle.bundleId.slice(0, 10)}`;

  for (const contractCase of suite.cases) {
    if (contractCase.resetBefore ?? true) {
      await runtime.resetState();
    }

    for (const step of contractCase.steps) {
      const correlationId = `${prefix}-${contractCase.id}-${step.id}`;
      const result = await executeRequest(
        runtime,
        suite,
        step,
        correlationId,
        fetcher,
      );
      addTransportChecks(checks, contractCase, step, correlationId, result);

      if (
        step.expect.matchedCase !== undefined ||
        step.expect.sequenceIndex !== undefined ||
        step.expect.stateBefore !== undefined ||
        step.expect.stateAfter !== undefined
      ) {
        const ledgerEntry = await waitForLedgerEntry(
          runtime,
          correlationId,
          options,
        );
        addLedgerChecks(
          checks,
          contractCase,
          step,
          correlationId,
          ledgerEntry,
        );
      }
    }

    if (contractCase.expect) {
      const snapshot = await runtime.stateSnapshot();
      addSnapshotChecks(checks, contractCase, snapshot);
    }
  }

  if (options.resetAfter ?? true) {
    await runtime.resetState();
  }

  return {
    schemaVersion: "1.0",
    suiteId: suite.suiteId,
    vendorId: runtime.bundle.manifest.vendor.id,
    bundleId: runtime.bundle.bundleId,
    passed: checks.every((candidate) => candidate.passed),
    startedAt,
    completedAt: new Date().toISOString(),
    checks,
  };
}

async function executeRequest(
  runtime: RunningVendorRuntime,
  suite: VendorContractSuite,
  step: VendorContractStep,
  correlationId: string,
  fetcher: typeof fetch,
): Promise<RequestResult> {
  const timeoutMs =
    step.request.timeoutMs ??
    suite.defaults?.requestTimeoutMs ??
    10_000;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Request exceeded ${timeoutMs}ms.`)),
    timeoutMs,
  );

  try {
    const headers: Record<string, string> = {
      ...(suite.defaults?.headers ?? {}),
      ...(step.request.headers ?? {}),
      "X-Testy-Correlation-ID": correlationId,
    };
    if (step.request.jsonBody !== undefined) {
      headers["content-type"] ??= "application/json";
    }

    const response = await fetcher(
      buildRequestUrl(
        runtime.providerBaseUrl,
        step.request.path,
        suite.defaults?.query,
        step.request.query,
      ),
      {
        method: step.request.method,
        headers,
        ...(step.request.jsonBody !== undefined
          ? { body: JSON.stringify(step.request.jsonBody) }
          : {}),
        signal: controller.signal,
      },
    );
    await response.arrayBuffer();
    return { statusCode: response.status };
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
  contractCase: VendorContractCase,
  step: VendorContractStep,
  correlationId: string,
  result: RequestResult,
): void {
  if (step.expect.transportError) {
    const passed = result.transportError !== undefined;
    checks.push(
      check(
        `${contractCase.id}.${step.id}.transport`,
        passed,
        passed
          ? "Observed the expected transport error."
          : `Expected a transport error, received HTTP ${String(result.statusCode)}.`,
        contractCase,
        step,
        correlationId,
      ),
    );
  }

  if (step.expect.status !== undefined) {
    const passed = result.statusCode === step.expect.status;
    checks.push(
      check(
        `${contractCase.id}.${step.id}.status`,
        passed,
        passed
          ? `Received expected HTTP ${step.expect.status}.`
          : result.transportError
            ? `Expected HTTP ${step.expect.status}, received transport error: ${result.transportError}`
            : `Expected HTTP ${step.expect.status}, received HTTP ${String(result.statusCode)}.`,
        contractCase,
        step,
        correlationId,
      ),
    );
  }
}

async function waitForLedgerEntry(
  runtime: RunningVendorRuntime,
  correlationId: string,
  options: RunVendorContractOptions,
): Promise<ProviderCallLedgerEntry | undefined> {
  const timeoutMs = options.ledgerTimeoutMs ?? 2_000;
  const intervalMs = options.ledgerPollIntervalMs ?? 50;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const entry = (await runtime.collectLedger()).find(
      (candidate) => candidate.correlationId === correlationId,
    );
    if (entry) {
      return entry;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, intervalMs));
  }
  return undefined;
}

function addLedgerChecks(
  checks: VendorContractCheck[],
  contractCase: VendorContractCase,
  step: VendorContractStep,
  correlationId: string,
  entry: ProviderCallLedgerEntry | undefined,
): void {
  if (!entry) {
    checks.push(
      check(
        `${contractCase.id}.${step.id}.ledger`,
        false,
        "No provider ledger entry was observed for the request correlation.",
        contractCase,
        step,
        correlationId,
      ),
    );
    return;
  }

  addExpectedCheck(
    checks,
    contractCase,
    step,
    correlationId,
    "matched-case",
    entry.caseId,
    step.expect.matchedCase,
  );
  addExpectedCheck(
    checks,
    contractCase,
    step,
    correlationId,
    "sequence-index",
    entry.sequenceIndex,
    step.expect.sequenceIndex,
  );
  addExpectedCheck(
    checks,
    contractCase,
    step,
    correlationId,
    "state-before",
    entry.stateBefore,
    step.expect.stateBefore,
  );
  addExpectedCheck(
    checks,
    contractCase,
    step,
    correlationId,
    "state-after",
    entry.stateAfter,
    step.expect.stateAfter,
  );
}

function addSnapshotChecks(
  checks: VendorContractCheck[],
  contractCase: VendorContractCase,
  snapshot: RuntimeStateSnapshot | undefined,
): void {
  if (contractCase.expect?.state !== undefined) {
    const actual = snapshot?.currentState;
    checks.push(
      check(
        `${contractCase.id}.state`,
        actual === contractCase.expect.state,
        `Expected state '${contractCase.expect.state}', observed '${String(actual)}'.`,
        contractCase,
      ),
    );
  }

  for (const [storeName, expectedValues] of Object.entries(
    contractCase.expect?.stores ?? {},
  )) {
    for (const [key, expected] of Object.entries(expectedValues)) {
      const actual = snapshot?.user[storeName]?.[key];
      checks.push(
        check(
          `${contractCase.id}.store.${storeName}.${key}`,
          valuesEqual(actual, expected),
          `Expected store '${storeName}.${key}' to equal ${JSON.stringify(expected)}, observed ${JSON.stringify(actual)}.`,
          contractCase,
        ),
      );
    }
  }
}

function addExpectedCheck(
  checks: VendorContractCheck[],
  contractCase: VendorContractCase,
  step: VendorContractStep,
  correlationId: string,
  suffix: string,
  actual: unknown,
  expected: unknown,
): void {
  if (expected === undefined) {
    return;
  }
  checks.push(
    check(
      `${contractCase.id}.${step.id}.${suffix}`,
      valuesEqual(actual, expected),
      `Expected ${suffix} ${JSON.stringify(expected)}, observed ${JSON.stringify(actual)}.`,
      contractCase,
      step,
      correlationId,
    ),
  );
}

function check(
  id: string,
  passed: boolean,
  message: string,
  contractCase: VendorContractCase,
  step?: VendorContractStep,
  correlationId?: string,
): VendorContractCheck {
  return {
    id,
    passed,
    message,
    caseId: contractCase.id,
    ...(step ? { stepId: step.id } : {}),
    ...(correlationId ? { correlationId } : {}),
  };
}

function buildRequestUrl(
  baseUrl: string,
  path: string,
  defaultQuery: Readonly<Record<string, string>> | undefined,
  stepQuery: Readonly<Record<string, string>> | undefined,
): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL(path.replace(/^\/+/, ""), normalizedBase);
  for (const [name, value] of Object.entries({
    ...(defaultQuery ?? {}),
    ...(stepQuery ?? {}),
  })) {
    url.searchParams.set(name, value);
  }
  return url.toString();
}

function valuesEqual(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}
