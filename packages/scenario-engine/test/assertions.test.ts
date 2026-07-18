import { describe, expect, it } from "vitest";

import { resolveScenario, ScenarioValidationError } from "../src/index.js";

describe("scenario assertions", () => {
  it("materializes assertions into the resolved assert phase and content hash", () => {
    const scenario = resolveScenario({
      schemaVersion: "1.0",
      scenario: { id: "assertion-smoke", displayName: "Assertion smoke" },
      target: "local",
      variables: { vendor: "ipinfo" },
      phases: {
        run: [{ id: "execute", kind: "task", action: "noop" }],
      },
      assertions: [
        {
          id: "provider-called",
          type: "provider-call-count",
          vendorId: "{{vendor}}",
          equals: 1,
        },
      ],
    });

    expect(scenario.assertions).toEqual([
      {
        id: "provider-called",
        type: "provider-call-count",
        vendorId: "ipinfo",
        equals: 1,
      },
    ]);
    expect(scenario.phases.assert.at(-1)).toMatchObject({
      id: "system-assertions",
      action: "assertions-evaluate",
    });
    expect(scenario.contentHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rejects duplicate IDs and incomplete count bounds", () => {
    expect(() =>
      resolveScenario({
        schemaVersion: "1.0",
        scenario: { id: "invalid-assertions", displayName: "Invalid assertions" },
        target: "local",
        phases: { run: [] },
        assertions: [
          {
            id: "duplicate",
            type: "provider-call-count",
            vendorId: "ipinfo",
            equals: 1,
          },
          {
            id: "duplicate",
            type: "observation-count",
            observationType: "target-outcome",
          },
        ],
      }),
    ).toThrow(ScenarioValidationError);
  });
});
