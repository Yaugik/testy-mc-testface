import type {
  ProviderCallLedgerEntry,
  RunningVendorRuntime,
  RuntimeStateSnapshot,
} from "@testy/vendor-runtime";
import { describe, expect, it } from "vitest";

import {
  runHardenedVendorContractSuite,
  runVendorIsolationSuite,
} from "../src/hardening-runner.js";
import type { VendorContractSuite } from "../src/types.js";

describe("provider hardening assertions", () => {
  it("verifies call counts, ordering, absence and timing", async () => {
    const correlations: string[] = [];
    const cases = ["first-case", "second-case", "first-case"];
    const fetcher = (async (_input, init) => {
      const correlation = new Headers(init?.headers).get(
        "X-Testy-Correlation-ID",
      );
      if (correlation) {
        correlations.push(correlation);
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const runtime = fakeRuntime({
      storePrefix: "single",
      ledger: () =>
        correlations.map((correlationId, index) => ({
          vendorId: "sample",
          operationId: "lookup",
          caseId: cases[index],
          unmatched: false,
          correlationId,
          timestamp: `2026-07-16T00:00:00.${String(index * 100).padStart(3, "0")}Z`,
          durationMs: 10 + index,
        })),
    });
    const suite: VendorContractSuite = {
      schemaVersion: "1.0",
      suiteId: "call-assertions",
      cases: [
        {
          id: "ordered",
          steps: [
            requestStep("one", "first-case"),
            requestStep("two", "second-case"),
            requestStep("three", "first-case"),
          ],
          expect: {
            calls: {
              total: { exact: 3 },
              byCase: {
                "first-case": { exact: 2 },
                "second-case": { min: 1, max: 1 },
              },
              orderedCases: ["first-case", "second-case", "first-case"],
              absentCases: ["forbidden-case"],
              durationMs: { min: 1, max: 100 },
              retryIntervalMs: { min: 0, max: 500 },
            },
          },
        },
      ],
    };

    const report = await runHardenedVendorContractSuite(runtime, suite, {
      fetcher,
      ledgerPollIntervalMs: 1,
      ledgerTimeoutMs: 50,
      ledgerSettlePolls: 1,
    });

    expect(report.passed).toBe(true);
    expect(report.checks.some((check) => check.id.endsWith("calls.order"))).toBe(
      true,
    );
  });

  it("proves separately namespaced runtimes do not share state or ledgers", async () => {
    let leftState: RuntimeStateSnapshot = snapshot("healthy", {});
    let rightState: RuntimeStateSnapshot = snapshot("healthy", {});
    const leftLedger: ProviderCallLedgerEntry[] = [];
    const rightLedger: ProviderCallLedgerEntry[] = [];
    const left = fakeRuntime({
      storePrefix: "left",
      ledger: () => leftLedger,
      snapshot: () => leftState,
      reset: () => {
        leftState = snapshot("healthy", {});
        leftLedger.length = 0;
      },
    });
    const right = fakeRuntime({
      storePrefix: "right",
      ledger: () => rightLedger,
      snapshot: () => rightState,
      reset: () => {
        rightState = snapshot("healthy", {});
        rightLedger.length = 0;
      },
    });
    const fetcher = (async (_input, init) => {
      const correlationId = new Headers(init?.headers).get(
        "X-Testy-Correlation-ID",
      );
      leftState = snapshot("unavailable", {
        scenario: { "last-trigger": "enter-unavailable" },
      });
      leftLedger.push({
        vendorId: "sample",
        operationId: "lookup",
        caseId: "enter-unavailable",
        unmatched: false,
        ...(correlationId ? { correlationId } : {}),
        stateBefore: "healthy",
        stateAfter: "unavailable",
      });
      return new Response("{}", { status: 503 });
    }) as typeof fetch;
    const suite: VendorContractSuite = {
      schemaVersion: "1.0",
      suiteId: "isolation-contract",
      cases: [{ id: "placeholder", steps: [requestStep("request", "unused")] }],
      isolation: {
        id: "state-isolated",
        request: { method: "GET", path: "/trigger" },
        expect: {
          status: 503,
          matchedCase: "enter-unavailable",
          stateAfter: "unavailable",
        },
        mutated: {
          state: "unavailable",
          stores: { scenario: { "last-trigger": "enter-unavailable" } },
        },
        untouched: {
          state: "healthy",
          absentStoreKeys: { scenario: ["last-trigger"] },
        },
      },
    };

    const report = await runVendorIsolationSuite(left, right, suite, {
      fetcher,
      ledgerPollIntervalMs: 1,
      ledgerTimeoutMs: 20,
      resetAfter: false,
    });

    expect(report.passed).toBe(true);
    expect(rightState.currentState).toBe("healthy");
    expect(rightLedger).toEqual([]);
  });
});

function requestStep(id: string, matchedCase: string) {
  return {
    id,
    request: { method: "GET" as const, path: "/resource" },
    expect: { status: 200, matchedCase },
  };
}

function snapshot(
  currentState: string,
  user: RuntimeStateSnapshot["user"],
): RuntimeStateSnapshot {
  return {
    currentState,
    state: { currentState },
    counters: {},
    sequences: {},
    user,
  };
}

function fakeRuntime(options: {
  readonly storePrefix: string;
  readonly ledger?: () => readonly ProviderCallLedgerEntry[];
  readonly snapshot?: () => RuntimeStateSnapshot;
  readonly reset?: () => void;
}): RunningVendorRuntime {
  const defaultSnapshot = snapshot("healthy", {});
  return {
    containerId: options.storePrefix,
    containerName: options.storePrefix,
    baseUrl: `http://127.0.0.1/${options.storePrefix}`,
    providerBaseUrl: `http://127.0.0.1/${options.storePrefix}/vendor`,
    status: { status: "ok" },
    bundle: {
      bundleId: `${options.storePrefix}-bundle`,
      manifest: {
        vendor: { id: "sample" },
        state: {
          initialState: "healthy",
          stores: {
            state: `${options.storePrefix}-state`,
            counters: `${options.storePrefix}-counters`,
            sequences: `${options.storePrefix}-sequences`,
            user: { scenario: `${options.storePrefix}-scenario` },
          },
        },
      },
    } as RunningVendorRuntime["bundle"],
    logs: async () => "",
    collectLedger: async () => options.ledger?.() ?? [],
    readStore: async () => ({}),
    stateSnapshot: async () => options.snapshot?.() ?? defaultSnapshot,
    resetState: async () => {
      options.reset?.();
    },
    stop: async () => undefined,
  };
}
