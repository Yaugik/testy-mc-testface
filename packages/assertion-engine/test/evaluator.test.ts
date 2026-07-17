import { describe, expect, it } from "vitest";
import type { RunId } from "@testy/shared-types";
import { evaluateAssertions, type AssertionSnapshot } from "../src/index.js";
const runId = "00000000-0000-4000-8000-000000000001" as RunId;
const snapshot: AssertionSnapshot = {
  runId,
  providerCalls: [
    { vendorId: "ipinfo", operationId: "lookup-ip", caseId: "corporate", statusCode: 200, occurredAt: "2026-07-17T00:00:00.000Z" },
    { vendorId: "apollo", operationId: "company-match", caseId: "partial", statusCode: 200, occurredAt: "2026-07-17T00:00:01.000Z" },
  ],
  browserActions: [{ journeyId: "lead-capture", stepId: "open", action: "open", status: "PASSED", startedAt: "2026-07-17T00:00:00.000Z" }],
  observations: [
    { observationType: "target-outcome", status: "completed", value: { scoreCount: 1, visibleTenantIds: ["customer-alpha"] }, observedAt: "2026-07-17T00:00:02.000Z" },
    { observationType: "gateway-ledger-summary", status: "completed", value: { rejectedCount: 0, failedCount: 0 }, observedAt: "2026-07-17T00:00:03.000Z" },
  ],
  steps: [{ stepId: "browser-run", status: "PASSED", attempt: 1, startedAt: "2026-07-17T00:00:00.000Z" }],
  artifacts: [{ kind: "browser-trace" }],
};
describe("assertion evaluator", () => {
  it("evaluates persisted evidence", () => {
    const results = evaluateAssertions([
      { id: "ipinfo-once", type: "provider-call-count", vendorId: "ipinfo", equals: 1 },
      { id: "provider-order", type: "provider-call-order", sequence: [{ vendorId: "ipinfo" }, { vendorId: "apollo" }] },
      { id: "browser-passed", type: "browser-journey-passed", journeyId: "lead-capture" },
      { id: "score-once", type: "observation", observationType: "target-outcome", path: "scoreCount", operator: "equals", expected: 1 },
      { id: "no-egress", type: "no-unexpected-external-calls" },
    ], snapshot);
    expect(results.every((result) => result.passed)).toBe(true);
  });
  it("redacts sensitive display values", () => {
    const [result] = evaluateAssertions([{ id: "missing", type: "provider-call-count", vendorId: "hunter", equals: 1, description: "token=secret visitor@example.test" }], snapshot);
    expect(result?.passed).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("visitor@example.test");
  });
});
