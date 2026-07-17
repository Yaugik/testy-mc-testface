import { describe, expect, it } from "vitest";

import { controlPlaneUrl, parseCommand } from "../src/index.js";

describe("testy CLI", () => {
  it("parses lifecycle commands", () => {
    expect(parseCommand(["run", "orchestration-smoke"])).toEqual({
      name: "run",
      scenarioId: "orchestration-smoke",
    });
    expect(parseCommand(["cancel", "run-id"])).toEqual({
      name: "cancel",
      runId: "run-id",
    });
  });

  it("builds Control Plane URLs without discarding a base path", () => {
    expect(controlPlaneUrl("http://127.0.0.1:3000/api/", "/v1/health")).toBe(
      "http://127.0.0.1:3000/api/v1/health",
    );
  });
});
