import { describe, expect, it } from "vitest";

import { scanStructuredValue } from "../src/scanner.js";

describe("scanStructuredValue", () => {
  it("accepts synthetic fixture values", () => {
    expect(
      scanStructuredValue(
        {
          ip: "198.51.100.10",
          domain: "nordlicht.example",
          email: "owner@nordlicht.example",
          authorization: "Bearer test-token-valid",
          body: "responses/corporate.json",
        },
        "fixture.json",
      ),
    ).toEqual([]);
  });

  it("rejects public identifiers and live-looking credentials", () => {
    const issues = scanStructuredValue(
      {
        ip: "8.8.8.8",
        domain: "example.com",
        email: "person@gmail.com",
        apiKey: "prod_1234567890abcdef",
      },
      "fixture.json",
    );

    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "unsafe-ip-address",
        "unsafe-domain",
        "real-email-address",
        "credential-like-value",
      ]),
    );
    expect(issues.every((issue) => issue.fingerprint !== undefined)).toBe(true);
  });
});
