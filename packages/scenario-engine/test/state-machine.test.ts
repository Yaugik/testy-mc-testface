import { describe, expect, it } from "vitest";

import { RunStateMachine } from "../src/index.js";

describe("RunStateMachine", () => {
  it("accepts the complete passing lifecycle including cleanup", () => {
    const state = new RunStateMachine();
    for (const status of [
      "VALIDATING",
      "ALLOCATING",
      "COMPILING",
      "CONFIGURING",
      "RUNNING",
      "OBSERVING",
      "ASSERTING",
      "PASSED",
      "CLEANUP",
      "PASSED",
    ] as const) {
      expect(state.transition(status)).toBe(status);
    }
  });

  it("rejects skipped lifecycle transitions", () => {
    const state = new RunStateMachine();
    expect(() => state.transition("RUNNING")).toThrow("Invalid run status transition");
  });
});
