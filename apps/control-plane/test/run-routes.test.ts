import type { RunId } from "@testy/shared-types";
import type { PersistedRun, ResolvedScenario } from "@testy/scenario-engine";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import type { RunService } from "../src/run-service.js";

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

const resolved: ResolvedScenario = {
  schemaVersion: "1.0",
  scenarioId: "api-smoke",
  displayName: "API smoke",
  target: "local",
  timeoutMs: 1000,
  variables: {},
  phases: {
    allocate: [],
    compile: [],
    configure: [],
    run: [],
    observe: [],
    assert: [],
  },
  assertions: [],
  contentHash: "a".repeat(64),
};
const run: PersistedRun = {
  id: "00000000-0000-4000-8000-000000000010" as RunId,
  scenarioId: "api-smoke",
  target: "local",
  status: "PASSED",
  outcomeStatus: "PASSED",
  resolvedScenarioHash: resolved.contentHash,
  resolvedScenario: resolved,
  metadata: {},
  createdAt: "2026-07-17T00:00:00.000Z",
  updatedAt: "2026-07-17T00:00:01.000Z",
  finishedAt: "2026-07-17T00:00:01.000Z",
};

function fakeService(): RunService {
  return {
    validate: vi.fn(async () => resolved),
    listScenarios: vi.fn(async () => [resolved]),
    getScenario: vi.fn(async () => resolved),
    create: vi.fn(async () => ({ run })),
    get: vi.fn(async () => run),
    cancel: vi.fn(async () => true),
    timeline: vi.fn(async () => []),
    report: vi.fn(async () => ({
      schemaVersion: "1.0",
      reportId: `report-${run.id}`,
      generatedAt: run.finishedAt ?? run.updatedAt,
      contentHash: "b".repeat(64),
      run: {
        runId: run.id,
        scenarioId: run.scenarioId,
        target: run.target,
        status: run.status,
        outcomeStatus: run.outcomeStatus,
        scenarioHash: run.resolvedScenarioHash,
        createdAt: run.createdAt,
        finishedAt: run.finishedAt,
        metadata: {},
      },
      summary: {
        passed: true,
        assertionCount: 0,
        passedAssertions: 0,
        failedAssertions: 0,
        warningFailures: 0,
        stepCount: 0,
        failedSteps: 0,
        providerCallCount: 0,
        browserActionCount: 0,
        observationCount: 0,
        artifactCount: 0,
      },
      assertions: [],
      steps: [],
      timeline: [],
      providerCalls: [],
      browserActions: [],
      observations: [],
      artifacts: [],
    })),
    reportHtml: vi.fn(async () => "<!doctype html><title>report</title>"),
    artifacts: vi.fn(async () => []),
    recoverInterruptedRuns: vi.fn(async () => undefined),
    shutdown: vi.fn(async () => undefined),
  };
}

describe("run lifecycle routes", () => {
  it("validates and creates a persisted run", async () => {
    const runs = fakeService();
    const app = buildApp({ runs, database: { check: async () => undefined } });
    apps.push(app);

    const catalog = await app.inject({ method: "GET", url: "/v1/scenarios" });
    const validation = await app.inject({
      method: "POST",
      url: "/v1/scenarios/validate",
      payload: { schemaVersion: "1.0" },
    });
    const created = await app.inject({
      method: "POST",
      url: "/v1/runs",
      payload: { schemaVersion: "1.0" },
    });

    expect(catalog.statusCode).toBe(200);
    expect(catalog.json()).toMatchObject({
      scenarios: [{ scenarioId: "api-smoke" }],
    });
    expect(validation.statusCode).toBe(200);
    expect(validation.json()).toMatchObject({
      valid: true,
      contentHash: resolved.contentHash,
    });
    expect(created.statusCode).toBe(202);
    expect(created.json()).toMatchObject({ id: run.id, status: "PASSED" });
  });

  it("returns status, timeline, JSON/HTML reports, artifacts and cancellation", async () => {
    const runs = fakeService();
    const app = buildApp({ runs, database: { check: async () => undefined } });
    apps.push(app);
    const base = `/v1/runs/${run.id}`;

    const responses = await Promise.all([
      app.inject({ method: "GET", url: base }),
      app.inject({ method: "GET", url: `${base}/timeline` }),
      app.inject({ method: "GET", url: `${base}/report` }),
      app.inject({ method: "GET", url: `${base}/report?format=html` }),
      app.inject({ method: "GET", url: `${base}/artifacts` }),
      app.inject({ method: "POST", url: `${base}/cancel` }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([
      200, 200, 200, 200, 200, 202,
    ]);
    expect(responses[3]?.headers["content-type"]).toContain("text/html");
  });
});
