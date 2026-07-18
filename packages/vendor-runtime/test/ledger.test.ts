import { describe, expect, it } from "vitest";
import { sanitizeProviderCall } from "../src/index.js";

describe("provider call ledger", () => {
  it("stores a stable fingerprint without sensitive request values", () => {
    const record = sanitizeProviderCall({
      runId: "run-1",
      provider: "ipinfo",
      operation: "lookup",
      matchedCase: "corporate-ip",
      attempt: 1,
      method: "GET",
      path: "/ipinfo/203.0.113.10",
      query: { token: "secret", mode: "company" },
      headers: {
        authorization: "Bearer secret",
        cookie: "session=secret",
        "x-contact-email": "alice@example.com",
      },
      body: { email: "alice@example.com", ip: "203.0.113.10" },
      status: 200,
      durationMs: 12,
    });

    expect(record.requestFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(record)).not.toContain("secret");
    expect(JSON.stringify(record)).not.toContain("alice@example.com");
    expect(JSON.stringify(record)).not.toContain("203.0.113.10");
  });
});
