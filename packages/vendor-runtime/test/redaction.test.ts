import { describe, expect, it } from "vitest";

import { sanitizeRuntimeLogs } from "../src/redaction.js";

describe("sanitizeRuntimeLogs", () => {
  it("redacts visitor identifiers and credentials", () => {
    const raw =
      "GET http://localhost:8080/ipinfo/198.51.100.10?token=secret Authorization: Bearer abc.def visitor@example.test";

    expect(sanitizeRuntimeLogs(raw)).toBe(
      "GET http://localhost:8080/ipinfo/[ip-redacted]?[query-redacted] Authorization=[redacted] [email-redacted]",
    );
  });
});
