import { describe, expect, it } from "vitest";
import type { RunId } from "@testy/shared-types";

import { buildRunReport, renderRunReportHtml, serializeRunReportJson } from "../src/index.js";

const runId = "00000000-0000-4000-8000-000000000002" as RunId;

describe("reporting", () => {
  it("builds deterministic privacy-safe JSON and HTML", () => {
    const source = {
      run: {
        id: runId,
        scenarioId: "report-smoke",
        target: "fake-target",
        status: "PASSED" as const,
        outcomeStatus: "PASSED" as const,
        resolvedScenarioHash: "a".repeat(64),
        resolvedScenario: {
          schemaVersion: "1.0" as const,
          scenarioId: "report-smoke",
          displayName: "Report smoke",
          target: "fake-target",
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
        },
        metadata: { token: "do-not-show", safe: "ok" },
        createdAt: "2026-07-17T00:00:00.000Z",
        updatedAt: "2026-07-17T00:00:01.000Z",
        startedAt: "2026-07-17T00:00:00.000Z",
        finishedAt: "2026-07-17T00:00:01.000Z",
      },
      steps: [],
      timeline: [],
      artifacts: [],
      assertions: [
        {
          runId,
          assertionId: "passed",
          type: "step-passed" as const,
          severity: "error" as const,
          passed: true,
          message: "Step passed.",
          metadata: {},
          assertedAt: "2026-07-17T00:00:01.000Z",
        },
      ],
      providerCalls: [],
      browserActions: [],
      observations: [],
    };
    const first = buildRunReport(source);
    const second = buildRunReport(source);
    expect(first.contentHash).toBe(second.contentHash);
    expect(first.summary.passed).toBe(true);
    expect(serializeRunReportJson(first)).not.toContain("do-not-show");
    expect(renderRunReportHtml(first)).toContain("<!doctype html>");
    expect(renderRunReportHtml(first)).not.toContain("do-not-show");
  });
});
