import type { RunId } from "@testy/shared-types";
import { describe, expect, it } from "vitest";

import {
  executeScenario,
  resolveScenario,
  type ScenarioActionRegistry,
  type ScenarioConfig,
  type ScenarioStepRecord,
} from "../src/index.js";

const config: ScenarioConfig = {
  schemaVersion: "1.0",
  scenario: { id: "engine-smoke", displayName: "Engine smoke" },
  target: "local",
  variables: { enabled: true },
  fragments: {
    common: [{ id: "fragment-value", kind: "task", action: "value", input: "ok" }],
  },
  phases: {
    run: [
      { id: "fragment", kind: "fragment", useFragment: "common" },
      {
        id: "parallel",
        kind: "parallel",
        steps: [
          { id: "left", kind: "task", action: "delay", input: 5 },
          { id: "right", kind: "task", action: "value", input: "right" },
        ],
      },
      {
        id: "condition",
        kind: "condition",
        when: { path: "$.variables.enabled", equals: true },
        then: [{ id: "selected", kind: "task", action: "value", input: "yes" }],
      },
      {
        id: "poll",
        kind: "poll",
        action: "counter",
        intervalMs: 1,
        timeoutMs: 100,
        until: { path: "$", equals: 2 },
      },
    ],
  },
};

describe("executeScenario", () => {
  it("executes fragments, parallel steps, conditions, polling and cleanup", async () => {
    let counter = 0;
    let cleaned = false;
    const records: ScenarioStepRecord[] = [];
    const actions: ScenarioActionRegistry = {
      value: async (input, context) => {
        context.registerCleanup("value-cleanup", async () => {
          cleaned = true;
        });
        return input;
      },
      delay: async (input) => {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, Number(input)));
        return input;
      },
      counter: async () => (counter += 1),
    };
    const report = await executeScenario(resolveScenario(config), actions, {
      runId: "00000000-0000-4000-8000-000000000001" as RunId,
      observer: {
        async onStatus() {},
        async onTimeline() {},
        async onStep(record) {
          records.push(record);
        },
      },
    });

    expect(report.status).toBe("PASSED");
    expect(report.outputKeys).toContain("fragment.fragment-value");
    expect(report.outputKeys).toContain("condition.then.selected");
    expect(report.outputKeys).toContain("poll");
    expect(records.some((record) => record.stepId === "parallel.left")).toBe(true);
    expect(cleaned).toBe(true);
  });

  it("cancels active actions and still performs cleanup", async () => {
    const controller = new AbortController();
    let cleaned = false;
    const actions: ScenarioActionRegistry = {
      block: async (_input, context) => {
        context.registerCleanup("cancel-cleanup", async () => {
          cleaned = true;
        });
        await new Promise<void>((_resolve, reject) => {
          context.signal.addEventListener("abort", () => reject(context.signal.reason), {
            once: true,
          });
        });
        return undefined;
      },
    };
    const scenario = resolveScenario({
      schemaVersion: "1.0",
      scenario: { id: "cancel-smoke", displayName: "Cancel smoke" },
      target: "local",
      phases: { run: [{ id: "block", kind: "task", action: "block" }] },
    });
    const execution = executeScenario(scenario, actions, {
      runId: "00000000-0000-4000-8000-000000000002" as RunId,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(new Error("cancel")), 5);
    const report = await execution;

    expect(report.status).toBe("CANCELLED");
    expect(cleaned).toBe(true);
  });
});
