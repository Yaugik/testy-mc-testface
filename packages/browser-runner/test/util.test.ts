import { describe, expect, it } from "vitest";

import {
  fingerprintText,
  fingerprintUrl,
  matchesRequest,
  sanitizeArtifactName,
  sanitizePageUrl,
  selectFailedRequests,
  shouldCapture,
  summarizeExpectedRequests,
} from "../src/index.js";
import type { BrowserRequestEntry } from "../src/types.js";

describe("browser runner utilities", () => {
  it("applies artifact policies", () => {
    expect(shouldCapture("always", false)).toBe(true);
    expect(shouldCapture("on-failure", true)).toBe(true);
    expect(shouldCapture("on-failure", false)).toBe(false);
    expect(shouldCapture("never", true)).toBe(false);
  });

  it("sanitizes artifact names and report URLs", () => {
    expect(sanitizeArtifactName("Lead Capture / Failure")).toBe("lead-capture-failure");
    expect(sanitizePageUrl("https://customer.test/contact?value=alpha@example.test#lead"))
      .toBe("https://customer.test/contact");
    expect(fingerprintUrl("https://customer.test/contact?value=alpha@example.test"))
      .toBe(fingerprintUrl("https://customer.test/contact?value=beta@example.test"));
    expect(fingerprintText("alpha@example.test")).not.toContain("alpha@example.test");
  });

  it("only returns failed requests when policy enables capture", () => {
    const entries: BrowserRequestEntry[] = [
      {
        timestamp: "2026-07-17T00:00:00.000Z",
        method: "GET",
        urlFingerprint: "ok",
        status: 200,
        failed: false,
      },
      {
        timestamp: "2026-07-17T00:00:01.000Z",
        method: "POST",
        urlFingerprint: "failed",
        status: 503,
        failed: true,
      },
    ];

    expect(selectFailedRequests("never", true, entries)).toEqual([]);
    expect(selectFailedRequests("on-failure", false, entries)).toEqual([]);
    expect(selectFailedRequests("on-failure", true, entries)).toEqual([entries[1]]);
    expect(selectFailedRequests("always", false, entries)).toEqual([entries[1]]);
  });

  it("summarizes expected requests without retaining raw URLs", () => {
    const url = "https://tracking.example.test/script.js?site=alpha";
    const entries: BrowserRequestEntry[] = [
      {
        timestamp: "2026-07-17T00:00:00.000Z",
        method: "GET",
        urlFingerprint: fingerprintUrl(url),
        status: 200,
        failed: false,
      },
    ];
    const [summary] = summarizeExpectedRequests(
      [{ id: "target-tracking-script", url, method: "GET" }],
      entries,
    );
    expect(summary).toMatchObject({
      id: "target-tracking-script",
      matchedCount: 1,
      successfulCount: 1,
      failedCount: 0,
    });
    expect(JSON.stringify(summary)).not.toContain("site=alpha");
  });

  it("rejects duplicate expected request IDs", () => {
    expect(() => summarizeExpectedRequests([
      { id: "duplicate", url: "https://one.example.test" },
      { id: "duplicate", url: "https://two.example.test" },
    ], [])).toThrow(/duplicated/u);
  });

  it("matches method-constrained network expectations", () => {
    expect(matchesRequest("https://telemetry.example/collect", "POST", "https://telemetry.example/collect", "POST")).toBe(true);
    expect(matchesRequest("https://telemetry.example/collect", "GET", "https://telemetry.example/collect", "POST")).toBe(false);
  });
});
