import type { RunId, ScenarioId } from "@testy/shared-types";
import type { ScenarioActionContext } from "@testy/scenario-engine";
import type { GatewayRouteBinding } from "@testy/traffic-gateway";
import { describe, expect, it, vi } from "vitest";

import {
  createTrafficScenarioActions,
  type TrafficEvidence,
  type TrafficGenerator,
} from "../src/index.js";

const runId = "00000000-0000-4000-8000-000000000410" as RunId;
const route: GatewayRouteBinding = {
  routeId: "route-actions",
  runId,
  proxyBaseUrl: "http://gateway.test/v1/proxy/route-actions",
  routeToken: "1234567890abcdef",
  expiresAt: "2026-07-17T12:00:00.000Z",
  targetOriginFingerprint: "a".repeat(64),
  syntheticIpFingerprint: "b".repeat(64),
};

describe("traffic scenario actions", () => {
  it("records sanitized request evidence", async () => {
    const evidence: TrafficEvidence[] = [];
    const generator = {
      send: vi.fn().mockResolvedValue(requestReport("single")),
      repeat: vi.fn(),
      burst: vi.fn(),
    } as unknown as TrafficGenerator;
    const actions = createTrafficScenarioActions({
      generator,
      routeFor: () => route,
      recordEvidence: async (selected) => void evidence.push(selected),
    });
    const action = actions["traffic.send"];
    if (!action) throw new Error("traffic.send was not registered");

    const result = await action(
      { id: "single", path: "/ingest", expect: { statusCodes: [202] } },
      context(runId),
    );

    expect(result).toMatchObject({ requestId: "single", status: "passed" });
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.kind).toBe("request");
  });


  it("persists evidence before failing an unmet expectation", async () => {
    const evidence: TrafficEvidence[] = [];
    const failed = {
      ...requestReport("failed-request"),
      status: "failed" as const,
      failureReasons: ["unexpected-status"],
    };
    const actions = createTrafficScenarioActions({
      routeFor: () => route,
      generator: {
        send: vi.fn().mockResolvedValue(failed),
        repeat: vi.fn(),
        burst: vi.fn(),
      } as unknown as TrafficGenerator,
      recordEvidence: async (selected) => void evidence.push(selected),
    });
    const action = actions["traffic.send"];
    if (!action) throw new Error("traffic.send was not registered");

    await expect(
      action({ id: "failed-request", path: "/ingest" }, context(runId)),
    ).rejects.toThrow(/did not meet/u);
    expect(evidence).toHaveLength(1);
  });

  it("rejects a gateway route belonging to another run", async () => {
    const actions = createTrafficScenarioActions({
      routeFor: () => route,
      generator: {
        send: vi.fn(),
        repeat: vi.fn(),
        burst: vi.fn(),
      } as unknown as TrafficGenerator,
    });
    const action = actions["traffic.send"];
    if (!action) throw new Error("traffic.send was not registered");

    await expect(
      action(
        { id: "wrong-run", path: "/ingest" },
        context("00000000-0000-4000-8000-000000000411" as RunId),
      ),
    ).rejects.toThrow(/another run/u);
  });
});

function context(selectedRunId: RunId): ScenarioActionContext {
  return {
    runId: selectedRunId,
    scenarioId: "traffic-suite" as ScenarioId,
    target: "gl-eye",
    variables: {},
    outputs: {},
    signal: new AbortController().signal,
    registerCleanup: () => undefined,
    registerResourceLease: async () => ({}) as never,
  };
}

function requestReport(requestId: string) {
  const now = "2026-07-17T00:00:00.000Z";
  return {
    requestId,
    status: "passed" as const,
    method: "POST" as const,
    pathFingerprint: "c".repeat(64),
    attemptCount: 1,
    totalDurationMs: 10,
    startedAt: now,
    completedAt: now,
    attempts: [],
    finalStatusCode: 202,
    failureReasons: [],
  };
}
