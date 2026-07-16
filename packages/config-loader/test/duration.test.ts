import { describe, expect, it } from "vitest";

import { parseDuration } from "../src/duration.js";

describe("parseDuration", () => {
  it.each([
    ["250ms", 250],
    ["5s", 5_000],
    ["2m", 120_000],
  ] as const)("parses %s", (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });
});
