import { describe, expect, it } from "vitest";

import {
  fingerprintText,
  fingerprintUrl,
  matchesRequest,
  sanitizeArtifactName,
  sanitizePageUrl,
  selectFailedRequests,
  shouldCapture,
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
    expect(sanitizePageUrl("https://customer.test/contact?email=secret@example.test#lead"))
      .toBe("https://customer.test/contact");
    expect(fingerprintUrl("https://customer.test/contact?email=secret@example.test"))
      .toBe(fingerprintUrl("https://customer.test/contact?email=other@example.test"));
    expect(fingerprintText("secret@example.test")).not.toContain("secret");
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

  it("matches method-constrained network expectations", () => {
    expect(matchesRequest("https://telemetry.example/collect", "POST", "https://telemetry.example/collect", "POST")).toBe(true);
    expect(matchesRequest("https://telemetry.example/collect", "GET", "https://telemetry.example/collect", "POST")).toBe(false);
  });
});
