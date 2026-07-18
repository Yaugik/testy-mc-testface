import { describe, expect, it } from "vitest";

import { parseProviderCallLedger } from "../src/ledger.js";

describe("parseProviderCallLedger", () => {
  it("correlates match, state and structured-summary events", () => {
    const logs = [
      "INFO TESTY_MATCH vendor=ipinfo operation=lookup-ip case=corporate-high-confidence correlation=run-123",
      "INFO TESTY_STATE vendor=ipinfo operation=lookup-ip case=corporate-high-confidence correlation=run-123 state=unavailable nextState=healthy stateRequestCount=3 sequenceIndex=none",
      JSON.stringify({
        timestamp: "2026-07-16T12:00:00.000Z",
        path: "/ipinfo/198.51.100.10?token=redacted",
        method: "GET",
        statusCode: "503",
        duration: "12.5",
        "x-testy-correlation-id": "run-123",
      }),
    ].join("\n");

    expect(parseProviderCallLedger(logs)).toEqual([
      {
        vendorId: "ipinfo",
        operationId: "lookup-ip",
        caseId: "corporate-high-confidence",
        unmatched: false,
        correlationId: "run-123",
        timestamp: "2026-07-16T12:00:00.000Z",
        pathFingerprint:
          "cc0f0e044becd8fa87cfe39c8103a649c6e503b1d3f8f3578d2b60a9eac9de01",
        method: "GET",
        statusCode: 503,
        durationMs: 12.5,
        stateBefore: "unavailable",
        stateAfter: "healthy",
        stateRequestCount: 3,
      },
    ]);
  });

  it("records sequence positions without retaining request values", () => {
    const logs = [
      "INFO TESTY_MATCH vendor=ipinfo operation=lookup-ip case=transient-recovery correlation=run-456",
      "INFO TESTY_STATE vendor=ipinfo operation=lookup-ip case=transient-recovery correlation=run-456 state=healthy nextState=healthy stateRequestCount=1 sequenceIndex=0",
    ].join("\n");

    expect(parseProviderCallLedger(logs)).toEqual([
      {
        vendorId: "ipinfo",
        operationId: "lookup-ip",
        caseId: "transient-recovery",
        unmatched: false,
        correlationId: "run-456",
        stateBefore: "healthy",
        stateAfter: "healthy",
        stateRequestCount: 1,
        sequenceIndex: 0,
      },
    ]);
  });
});
