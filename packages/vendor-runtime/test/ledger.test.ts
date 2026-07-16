import { describe, expect, it } from "vitest";

import { parseProviderCallLedger } from "../src/ledger.js";

describe("parseProviderCallLedger", () => {
  it("correlates privacy-safe match markers with structured summaries", () => {
    const logs = [
      "INFO TESTY_MATCH vendor=ipinfo operation=lookup-ip case=corporate-high-confidence correlation=run-123",
      JSON.stringify({
        timestamp: "2026-07-16T12:00:00.000Z",
        path: "/ipinfo/198.51.100.10?token=redacted",
        method: "GET",
        statusCode: "200",
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
        pathFingerprint: "cc0f0e044becd8fa87cfe39c8103a649c6e503b1d3f8f3578d2b60a9eac9de01",
        method: "GET",
        statusCode: 200,
        durationMs: 12.5,
      },
    ]);
  });
});
