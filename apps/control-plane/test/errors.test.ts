import { describe, expect, it } from "vitest";

import { redactText, sanitizeError } from "../src/errors.js";

describe("error sanitization", () => {
  it("redacts secrets, contact data, and full IP addresses", () => {
    const input =
      "password=hunter2 token=abc123 user@example.test 203.0.113.10 postgresql://user:pass@db.test/testy";

    const redacted = redactText(input);

    expect(redacted).not.toContain("hunter2");
    expect(redacted).not.toContain("abc123");
    expect(redacted).not.toContain("user@example.test");
    expect(redacted).not.toContain("203.0.113.10");
    expect(redacted).not.toContain("user:pass");
  });

  it("does not expose non-Error values", () => {
    expect(sanitizeError({ secret: "value" })).toEqual({
      name: "UnknownError",
      message: "An unknown error occurred.",
    });
  });
});
