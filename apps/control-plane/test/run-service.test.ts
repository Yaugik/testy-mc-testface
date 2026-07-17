import { resolve } from "node:path";

import type { RunId } from "@testy/shared-types";
import {
  MemoryScenarioRunRepository,
  type PersistedRun,
  type ScenarioActionRegistry,
} from "@testy/scenario-engine";
import { describe, expect, it } from "vitest";

import { FileScenarioCatalog } from "../src/scenario-catalog.js";
import { ScenarioRunService } from "../src/run-service.js";

describe("ScenarioRunService", () => {
  it("runs a catalog scenario and persists a regenerable report", async () => {
    const repository = new MemoryScenarioRunRepository();
    const service = new ScenarioRunService(
      repository,
      undefined,
      undefined,
      new FileScenarioCatalog(resolve("../../scenarios")),
    );

    const { run } = await service.create({ scenarioId: "orchestration-smoke" });
    const completed = await waitForTerminal(repository, run.id);
    const report = await service.report(run.id);

    expect(completed.status).toBe("PASSED");
    expect(report?.run.scenarioHash).toBe(run.resolvedScenarioHash);
    expect(report?.steps.length).toBeGreaterThan(0);
    expect(report?.timeline.some((event) => event.name === "cleanup")).toBe(
      true,
    );
    expect(await repository.listActiveResourceLeases(run.id)).toEqual([]);
    await service.shutdown();
  });

  it("fails a run when a required declarative assertion fails", async () => {
    const repository = new MemoryScenarioRunRepository();
    const service = new ScenarioRunService(repository);
    const { run } = await service.create({
      schemaVersion: "1.0",
      scenario: { id: "assertion-failure", displayName: "Assertion failure" },
      target: "local",
      phases: {
        run: [{ id: "execute", kind: "task", action: "noop" }],
      },
      assertions: [
        {
          id: "missing-provider",
          type: "provider-call-count",
          vendorId: "ipinfo",
          equals: 1,
        },
        {
          id: "warning-only",
          type: "artifact-present",
          kind: "trace",
          severity: "warning",
        },
      ],
    });
    const completed = await waitForTerminal(repository, run.id);
    const results = await repository.listAssertionResults(run.id);
    const report = await service.report(run.id);

    expect(completed.status).toBe("FAILED");
    expect(results).toHaveLength(2);
    expect(
      results.find((result) => result.assertionId === "missing-provider")
        ?.passed,
    ).toBe(false);
    expect(report?.summary.failedAssertions).toBe(1);
    expect(report?.summary.warningFailures).toBe(1);
    await service.shutdown();
  });

  it("cancels an active run and executes registered cleanup", async () => {
    const repository = new MemoryScenarioRunRepository();
    let cleaned = false;
    const actions: ScenarioActionRegistry = {
      block: async (_input, context) => {
        context.registerCleanup("block-cleanup", async () => {
          cleaned = true;
        });
        await new Promise<void>((_resolve, reject) => {
          context.signal.addEventListener(
            "abort",
            () => reject(context.signal.reason),
            {
              once: true,
            },
          );
        });
        return undefined;
      },
    };
    const service = new ScenarioRunService(repository, actions);
    const { run } = await service.create({
      schemaVersion: "1.0",
      scenario: { id: "cancel-service", displayName: "Cancel service" },
      target: "local",
      phases: {
        run: [{ id: "block", kind: "task", action: "block" }],
      },
    });
    await waitForStatus(repository, run.id, "RUNNING");
    expect(await service.cancel(run.id)).toBe(true);
    const completed = await waitForTerminal(repository, run.id);

    expect(completed.status).toBe("CANCELLED");
    expect(cleaned).toBe(true);
    await service.shutdown();
  });
});

async function waitForTerminal(
  repository: MemoryScenarioRunRepository,
  runId: RunId,
): Promise<PersistedRun> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const run = await repository.getRun(runId);
    if (run && ["PASSED", "FAILED", "CANCELLED"].includes(run.status))
      return run;
    await new Promise((resolveWait) => setTimeout(resolveWait, 5));
  }
  throw new Error(`Run '${runId}' did not reach a terminal state.`);
}

async function waitForStatus(
  repository: MemoryScenarioRunRepository,
  runId: RunId,
  status: PersistedRun["status"],
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if ((await repository.getRun(runId))?.status === status) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 5));
  }
  throw new Error(`Run '${runId}' did not reach status '${status}'.`);
}
