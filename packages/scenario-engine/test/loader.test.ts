import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadScenarioConfig,
  resolveScenario,
  ScenarioValidationError,
} from "../src/index.js";

describe("scenario loading and resolution", () => {
  it("loads and deterministically resolves the orchestration fixture", async () => {
    const config = await loadScenarioConfig(
      resolve("../../scenarios/orchestration-smoke.yaml"),
    );
    const first = resolveScenario(config);
    const second = resolveScenario(config);

    expect(first.contentHash).toBe(second.contentHash);
    expect(first.phases.allocate[0]?.id).toBe("allocate-resource.register");
    expect(first.phases.run.length).toBeGreaterThan(0);
  });

  it("rejects unknown fragments", () => {
    expect(() =>
      resolveScenario({
        schemaVersion: "1.0",
        scenario: { id: "invalid-fragment", displayName: "Invalid" },
        target: "local",
        phases: {
          run: [{ id: "missing", kind: "fragment", useFragment: "missing" }],
        },
      }),
    ).toThrow(ScenarioValidationError);
  });
});
