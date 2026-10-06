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

    const prepare = bundle.actions["target.prepare-run"];
    if (!prepare) throw new Error("target.prepare-run was not registered");
    const preparedOutput = await prepare(undefined, context);
    expect(JSON.stringify(preparedOutput)).not.toContain("fake-ingestion-");

    const browserTarget = bundle.browserTargetFor(context);
    expect(browserTarget.gateway).toBe(binding);
    expect(browserTarget.ingestionToken).toMatch(/^fake-ingestion-/u);
  });


  it("replaces an interactive gateway route without mutating the original binding", async () => {
    const first = routeBinding("run-switch" as RunId, "route-first");
    const second = {
      ...routeBinding("run-switch" as RunId, "route-second"),
      syntheticIpFingerprint: "ip-fingerprint-second",
    };
    const created: GatewayRouteBinding[] = [];
    const deleted: string[] = [];
    const gateway = {
      createRoute: async () => {
        const next = created.length === 0 ? first : second;
        created.push(next);
        return next;
      },
      deleteRoute: async (routeId: string) => {
        deleted.push(routeId);
      },
      getLedger: async () => [],
    } as unknown as GatewayAdminClient;
    const bundle = createGatewayTargetScenarioActionBundle({
      gateway,
      adapter: new FakeTargetAdapter(),
    });
    const leases: string[] = [];
    const context: ScenarioActionContext = {
      ...scenarioContext(first.runId),
      registerResourceLease: async (_resourceType, resourceKey, expiresAt) => {
        leases.push(resourceKey);
        return {
          leaseId: `lease-${leases.length}`,
          runId: first.runId,
          resourceType: "gateway-route",
          resourceKey,
          expiresAt,
        };
      },
    };

    const createRoute = bundle.actions["gateway.create-route"];
    const replaceRoute = bundle.actions["gateway.replace-route"];
    if (!createRoute || !replaceRoute) {
      throw new Error("Gateway route actions were not registered");
    }

    await createRoute(
      {
        targetOrigin: "http://target.test",
        syntheticIp: "198.51.100.10",
      },
      context,
    );
    const replaced = await replaceRoute(
      {
        targetOrigin: "http://target.test",
        syntheticIp: "198.51.100.11",
      },
      context,
    );

    expect(replaced).toMatchObject({
      routeId: "route-second",
      syntheticIpFingerprint: "ip-fingerprint-second",
    });
    expect(bundle.routeFor(context)).toBe(second);
    expect(deleted).toContain("route-first");
    expect(leases).toEqual(["route-first", "route-second"]);
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
  it("allows a synthetic site beneath an explicitly approved remote demo suffix", async () => {
    const binding = routeBinding("run-remote-demo" as RunId, "route-remote-demo");
    const gateway = {
      createRoute: async () => binding,
      deleteRoute: async () => undefined,
      getLedger: async () => [],
    } as unknown as GatewayAdminClient;
    const adapter = new FakeTargetAdapter();
    const bundle = createGatewayTargetScenarioActionBundle({
      gateway,
      adapter,
      approvedSyntheticHostnameSuffixes: [
        "testy.129.213.107.15.sslip.io",
      ],
    });
    const context = scenarioContext(binding.runId);

    await bundle.actions["gateway.create-route"]?.(
      {
        targetOrigin: "http://target.test",
        syntheticIp: "198.51.100.10",
      },
      context,
    );
    await bundle.actions["target.prepare-run"]?.(undefined, context);

    await expect(
      bundle.actions["target.configure-site"]?.(
        {
          hostname:
            "demo-0123456789abcdef.testy.129.213.107.15.sslip.io",
          origin:
            "https://demo-0123456789abcdef.testy.129.213.107.15.sslip.io",
        },
        context,
      ),
    ).resolves.toMatchObject({
      hostname:
        "demo-0123456789abcdef.testy.129.213.107.15.sslip.io",
    });
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
