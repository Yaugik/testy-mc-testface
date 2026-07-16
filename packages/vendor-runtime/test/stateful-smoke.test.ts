import { describe, expect, it } from "vitest";

import { runStatefulRuntimeSmoke } from "../src/stateful-smoke.js";
import type {
  ProviderCallLedgerEntry,
  RunningVendorRuntime,
  RuntimeStateSnapshot,
} from "../src/types.js";

const fixture = {
  authenticationHeaders: { Authorization: "Bearer test-token-valid" },
  recovery: {
    path: "/198.51.100.61",
    caseId: "transient-recovery",
    logicalStore: "recovery",
    attemptsKey: "attempts",
    outcomeKey: "last-outcome",
    recoveredOutcome: "recovered",
    expectedSequenceIndexes: [0, 1, 2, 2],
  },
  stateTransition: {
    triggerPath: "/198.51.100.70",
    triggerCaseId: "enter-unavailable",
    probePath: "/198.51.100.10",
    probeCaseId: "corporate-high-confidence",
    unavailableState: "unavailable",
    healthyState: "healthy",
    requestsBeforeRecovery: 3,
  },
} as const;

function snapshot(
  currentState: string,
  user: RuntimeStateSnapshot["user"] = {},
): RuntimeStateSnapshot {
  return {
    currentState,
    state: { currentState },
    counters: {},
    sequences: {},
    user,
  };
}

describe("runStatefulRuntimeSmoke", () => {
  it("verifies recovery, transitions, stores and ledger correlations", async () => {
    const statuses: readonly (number | "transport-error")[] = [
      "transport-error",
      503,
      200,
      200,
      503,
      503,
      503,
      503,
      200,
    ];
    const requests: { readonly url: string; readonly headers: Headers }[] = [];
    let requestIndex = 0;
    const fetcher = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      requests.push({
        url: String(input),
        headers: new Headers(init?.headers),
      });
      const next = statuses[requestIndex];
      requestIndex += 1;
      if (next === undefined) {
        throw new Error("No mocked response remains.");
      }
      if (next === "transport-error") {
        throw new TypeError("connection closed");
      }
      return new Response("", { status: next });
    }) as typeof fetch;

    const snapshots = [
      snapshot("healthy", {
        recovery: { attempts: "4", "last-outcome": "recovered" },
      }),
      snapshot("unavailable"),
      snapshot("healthy"),
      snapshot("healthy"),
    ];
    let snapshotIndex = 0;
    let resets = 0;
    const correlations = [
      "smoke-test-recovery-timeout",
      "smoke-test-recovery-unavailable",
      "smoke-test-recovery-success",
      "smoke-test-recovery-repeat-last",
      "smoke-test-state-trigger",
      "smoke-test-state-unavailable-1",
      "smoke-test-state-unavailable-2",
      "smoke-test-state-unavailable-3",
      "smoke-test-state-healthy-response",
    ];
    const ledger: ProviderCallLedgerEntry[] = correlations.map(
      (correlationId, index) => ({
        vendorId: "ipinfo",
        unmatched: false,
        correlationId,
        operationId: "lookup-ip",
        caseId:
          index < 4
            ? "transient-recovery"
            : index === 4
              ? "enter-unavailable"
              : "corporate-high-confidence",
        ...(index < 4 ? { sequenceIndex: [0, 1, 2, 2][index] } : {}),
        ...(index === 7 ? { stateAfter: "healthy" } : {}),
      }),
    );

    const runtime = {
      providerBaseUrl: "http://127.0.0.1:49152/ipinfo",
      bundle: {
        bundleId: "abcdef1234567890",
        manifest: { vendor: { id: "ipinfo" } },
      },
      resetState: async () => {
        resets += 1;
      },
      stateSnapshot: async () => snapshots[snapshotIndex++],
      collectLedger: async () => ledger,
    } as unknown as RunningVendorRuntime;

    const report = await runStatefulRuntimeSmoke(runtime, fixture, {
      fetcher,
      correlationPrefix: "smoke-test",
      requestTimeoutMs: 100,
    });

    expect(report.passed).toBe(true);
    expect(resets).toBe(3);
    expect(requests).toHaveLength(9);
    expect(requests[0]?.headers.get("authorization")).toBe(
      "Bearer test-token-valid",
    );
    expect(requests[0]?.headers.get("x-testy-correlation-id")).toBe(
      "smoke-test-recovery-timeout",
    );
    expect(
      report.checks.find((check) => check.id === "ledger-state-transition"),
    ).toMatchObject({ passed: true });
  });

  it("returns a failed report when an expected response is wrong", async () => {
    const statuses = [200, 500, 200, 200, 503, 503, 503, 503, 200];
    let requestIndex = 0;
    const fetcher = (async () => {
      const status = statuses[requestIndex];
      requestIndex += 1;
      if (status === undefined) {
        throw new Error("No mocked response remains.");
      }
      return new Response("", { status });
    }) as typeof fetch;
    const snapshots = [
      snapshot("healthy", {
        recovery: { attempts: "4", "last-outcome": "recovered" },
      }),
      snapshot("unavailable"),
      snapshot("healthy"),
      snapshot("healthy"),
    ];
    let snapshotIndex = 0;

    const runtime = {
      providerBaseUrl: "http://127.0.0.1:49152/ipinfo",
      bundle: {
        bundleId: "abcdef1234567890",
        manifest: { vendor: { id: "ipinfo" } },
      },
      resetState: async () => undefined,
      stateSnapshot: async () => snapshots[snapshotIndex++],
      collectLedger: async () => [],
    } as unknown as RunningVendorRuntime;

    const report = await runStatefulRuntimeSmoke(runtime, fixture, {
      fetcher,
      correlationPrefix: "smoke-failure",
      resetAfter: false,
    });

    expect(report.passed).toBe(false);
    expect(report.checks.some((check) => !check.passed)).toBe(true);
  });
});
