import { describe, expect, it } from "vitest";

import { fingerprintUrl, matchesRequest, sanitizeArtifactName, shouldCapture } from "../src/index.js";

describe("browser runner utilities", () => {
  it("applies artifact policies", () => {
    expect(shouldCapture("always", false)).toBe(true);
    expect(shouldCapture("on-failure", true)).toBe(true);
    expect(shouldCapture("on-failure", false)).toBe(false);
    expect(shouldCapture("never", true)).toBe(false);
  });

  it("sanitizes artifact names and fingerprints URLs without query values", () => {
    expect(sanitizeArtifactName("Lead Capture / Failure")).toBe("lead-capture-failure");
    expect(fingerprintUrl("https://customer.test/contact?email=secret@example.test"))
      .toBe(fingerprintUrl("https://customer.test/contact?email=other@example.test"));
  });

  it("matches method-constrained network expectations", () => {
    expect(matchesRequest("https://telemetry.example/collect", "POST", "https://telemetry.example/collect", "POST")).toBe(true);
    expect(matchesRequest("https://telemetry.example/collect", "GET", "https://telemetry.example/collect", "POST")).toBe(false);
  });
});
