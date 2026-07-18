import { describe, expect, it } from "vitest";

import type { RunId, ScenarioId } from "@testy/shared-types";
import type { ScenarioActionContext } from "@testy/scenario-engine";
import type {
  GatewayAdminClient,
  GatewayRouteBinding,
} from "@testy/traffic-gateway";
import {
  FakeTargetAdapter,
  adapterRunContext,
  createGatewayTargetScenarioActionBundle,
  createGatewayTargetScenarioActions,
} from "../src/index.js";

describe("target adapter contract", () => {
  it("isolates two prepared tenant fixtures", async () => {
    const adapter = new FakeTargetAdapter();
    const left = adapterRunContext(
      "run-left" as RunId,
      "scenario" as ScenarioId,
      "fake",
      new Date().toISOString(),
    );
    const right = adapterRunContext(
      "run-right" as RunId,
      "scenario" as ScenarioId,
      "fake",
      new Date().toISOString(),
    );
    const leftPrepared = await adapter.prepareRun(left);
    const rightPrepared = await adapter.prepareRun(right);
    expect(leftPrepared.tenantId).not.toBe(rightPrepared.tenantId);
    await adapter.configureVendorEndpoints(left, {
      ipinfo: "http://run-left.vendor.test/ipinfo",
    });
    expect(adapter.snapshot(right.runId)?.vendorEndpoints).toEqual({});
    const outcome = await adapter.collectOutcome(left);
    expect(outcome.visibleTenantIds).toEqual([leftPrepared.tenantId]);
    expect(outcome.visibleTenantIds).not.toContain(
      leftPrepared.controlTenantId,
    );
  });

  it("registers an existing gateway route lease after a retry", async () => {
    const binding = routeBinding("run-retry" as RunId, "route-retry");
    let createCount = 0;
    const gateway = {
      createRoute: async () => {
        createCount += 1;
        return binding;
      },
      deleteRoute: async () => undefined,
      getLedger: async () => [],
    } as unknown as GatewayAdminClient;
    const actions = createGatewayTargetScenarioActions({
      gateway,
      adapter: new FakeTargetAdapter(),
    });
    let leaseAttempts = 0;
    const context: ScenarioActionContext = {
      runId: binding.runId,
      scenarioId: "scenario" as ScenarioId,
      target: "fake",
      variables: {},
      outputs: {},
      signal: new AbortController().signal,
      registerCleanup: () => undefined,
      registerResourceLease: async () => {
        leaseAttempts += 1;
        if (leaseAttempts === 1) {
          throw new Error("transient persistence failure");
        }
        return {
          leaseId: "lease-retry",
          runId: binding.runId,
          resourceType: "gateway-route",
          resourceKey: binding.routeId,
          expiresAt: binding.expiresAt,
        };
      },
    };
    const action = actions["gateway.create-route"];
    if (!action) throw new Error("gateway.create-route was not registered");

    await expect(
      action(
        {
          targetOrigin: "http://target.test",
          syntheticIp: "198.51.100.10",
        },
        context,
      ),
    ).rejects.toThrow(/transient/u);
    await expect(
      action(
        {
          targetOrigin: "http://target.test",
          syntheticIp: "198.51.100.10",
        },
        context,
      ),
    ).resolves.toMatchObject({ routeId: binding.routeId });

    expect(createCount).toBe(1);
    expect(leaseAttempts).toBe(2);
  });

  it("exposes the full route binding only through the internal bundle accessor", async () => {
    const binding = routeBinding("run-route" as RunId, "route-internal");
    const gateway = {
      createRoute: async () => binding,
      deleteRoute: async () => undefined,
      getLedger: async () => [],
    } as unknown as GatewayAdminClient;
    const bundle = createGatewayTargetScenarioActionBundle({
      gateway,
      adapter: new FakeTargetAdapter(),
    });
    const context = scenarioContext(binding.runId);
    const createRoute = bundle.actions["gateway.create-route"];
    if (!createRoute) throw new Error("gateway.create-route was not registered");

    const publicResult = await createRoute(
      {
        targetOrigin: "http://target.test",
        syntheticIp: "198.51.100.10",
      },
      context,
    );

    expect(JSON.stringify(publicResult)).not.toContain(binding.routeToken);
    expect(bundle.routeFor(context)).toBe(binding);
  });

  it("cleans target runs idempotently", async () => {
    const adapter = new FakeTargetAdapter();
    const context = adapterRunContext(
      "run-clean" as RunId,
      "scenario" as ScenarioId,
      "fake",
      new Date().toISOString(),
    );
    const prepared = await adapter.prepareRun(context);
    await adapter.cleanupTarget(prepared.targetRunId);
    await adapter.cleanupTarget(prepared.targetRunId);
    expect(adapter.snapshot(context.runId)).toBeUndefined();
  });
});

function routeBinding(runId: RunId, routeId: string): GatewayRouteBinding {
  return {
    routeId,
    runId,
    proxyBaseUrl: `http://gateway.test/v1/proxy/${routeId}`,
    routeToken: "synthetic-route-token",
    expiresAt: "2026-07-17T12:00:00.000Z",
    targetOriginFingerprint: "target-fingerprint",
    syntheticIpFingerprint: "ip-fingerprint",
  };
}

function scenarioContext(runId: RunId): ScenarioActionContext {
  return {
    runId,
    scenarioId: "scenario" as ScenarioId,
    target: "fake",
    variables: {},
    outputs: {},
    signal: new AbortController().signal,
    registerCleanup: () => undefined,
    registerResourceLease: async () => ({}) as never,
  };
}
