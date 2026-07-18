import type {
  ProviderCallLedgerEntry,
  RunningVendorRuntime,
  RuntimeStateSnapshot,
} from "@testy/vendor-runtime";
import { describe, expect, it } from "vitest";

import { runVendorContractSuite } from "../src/runner.js";
import type { VendorContractSuite } from "../src/types.js";

const suite: VendorContractSuite = {
  schemaVersion: "1.0",
  suiteId: "sample-contract",
  defaults: { headers: { Authorization: "Bearer test-token" } },
  cases: [
    {
      id: "recovery",
      steps: [
        {
          id: "unavailable",
          request: { method: "GET", path: "/resource" },
          expect: {
            status: 503,
            matchedCase: "recovery-sequence",
            sequenceIndex: 1,
          },
        },
        {
          id: "success",
          request: { method: "GET", path: "/resource" },
          expect: {
            status: 200,
            matchedCase: "recovery-sequence",
            sequenceIndex: 2,
          },
        },
      ],
      expect: {
        state: "healthy",
        stores: { recovery: { attempts: "2" } },
      },
    },
  ],
};

describe("runVendorContractSuite", () => {
  it("runs requests and verifies ledger and store expectations", async () => {
    const correlations: string[] = [];
    const fetcher = (async (_input, init) => {
      const correlation = new Headers(init?.headers).get(
        "X-Testy-Correlation-ID",
      );
      if (correlation) {
        correlations.push(correlation);
      }
      return new Response("{}", {
        status: correlations.length === 1 ? 503 : 200,
      });
    }) as typeof fetch;

    const runtime = fakeRuntime(
      () =>
        correlations.map(
          (correlationId, index): ProviderCallLedgerEntry => ({
            vendorId: "sample",
            operationId: "lookup",
            caseId: "recovery-sequence",
            unmatched: false,
            correlationId,
            sequenceIndex: index + 1,
          }),
        ),
      {
        currentState: "healthy",
        state: { currentState: "healthy" },
        counters: {},
        sequences: {},
        user: { recovery: { attempts: "2" } },
      },
    );

    const report = await runVendorContractSuite(runtime, suite, {
      fetcher,
      correlationPrefix: "contract-test",
      ledgerPollIntervalMs: 1,
      ledgerTimeoutMs: 20,
    });

    expect(report.passed).toBe(true);
    expect(report.checks).toHaveLength(8);
    expect(correlations).toEqual([
      "contract-test-recovery-unavailable",
      "contract-test-recovery-success",
    ]);
  });
});

function fakeRuntime(
  ledger: () => readonly ProviderCallLedgerEntry[],
  snapshot: RuntimeStateSnapshot,
): RunningVendorRuntime {
  return {
    containerId: "container",
    containerName: "container",
    baseUrl: "http://127.0.0.1:49152",
    providerBaseUrl: "http://127.0.0.1:49152/vendor",
    status: { status: "ok" },
    bundle: {
      bundleId: "bundle1234567890",
      manifest: { vendor: { id: "sample" } },
    } as RunningVendorRuntime["bundle"],
    logs: async () => "",
    collectLedger: async () => ledger(),
    readStore: async () => ({}),
    stateSnapshot: async () => snapshot,
    resetState: async () => undefined,
    stop: async () => undefined,
  };
}
