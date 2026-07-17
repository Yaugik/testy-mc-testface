import type { RunContext, RunId } from "@testy/shared-types";
import type {
  PersistedResourceLease,
  ScenarioActionContext,
  ScenarioActionRegistry,
  ScenarioValue,
} from "@testy/scenario-engine";
import type {
  GatewayAdminClient,
  GatewayRouteBinding,
} from "@testy/traffic-gateway";

import type {
  AdapterRunContext,
  ObservationHandle,
  PreparedTarget,
  SiteDefinition,
  TargetAdapter,
  VendorEndpoints,
} from "./types.js";

interface RunIntegrationState {
  readonly createdAt: string;
  gateway?: GatewayRouteBinding;
  gatewayLeaseRegistered?: boolean;
  prepared?: PreparedTarget;
  observation?: ObservationHandle;
  targetLeaseRegistered?: boolean;
}

export interface GatewayTargetScenarioActionsOptions {
  readonly gateway: GatewayAdminClient;
  readonly adapter: TargetAdapter;
  readonly defaultRouteTtlMs?: number;
  readonly defaultTargetLeaseTtlMs?: number;
}

export interface GatewayTargetScenarioActionBundle {
  readonly actions: ScenarioActionRegistry;
  routeFor(context: ScenarioActionContext): GatewayRouteBinding;
}

export function createGatewayTargetScenarioActionBundle(
  options: GatewayTargetScenarioActionsOptions,
): GatewayTargetScenarioActionBundle {
  const states = new Map<RunId, RunIntegrationState>();
  const stateFor = (context: ScenarioActionContext): RunIntegrationState => {
    const existing = states.get(context.runId);
    if (existing) return existing;
    const created: RunIntegrationState = {
      createdAt: new Date().toISOString(),
    };
    states.set(context.runId, created);
    return created;
  };
  const adapterContext = (
    context: ScenarioActionContext,
  ): AdapterRunContext => {
    const state = stateFor(context);
    return {
      runId: context.runId,
      scenarioId: context.scenarioId,
      target: context.target,
      createdAt: state.createdAt,
      signal: context.signal,
    };
  };

  const actions: ScenarioActionRegistry = {
    "gateway.create-route": async (input, context) => {
      const state = stateFor(context);
      if (!state.gateway) {
        const value = readObject(input);
        const targetOrigin = readString(value, "targetOrigin");
        const syntheticIp = readString(value, "syntheticIp");
        const ttlMs =
          readOptionalNumber(value, "ttlMs") ??
          options.defaultRouteTtlMs ??
          15 * 60 * 1000;
        state.gateway = await options.gateway.createRoute({
          runId: context.runId,
          targetOrigin,
          syntheticIp,
          ttlMs,
        });
      }
      if (!state.gatewayLeaseRegistered) {
        const binding = state.gateway;
        await context.registerResourceLease(
          "gateway-route",
          binding.routeId,
          binding.expiresAt,
          async () => options.gateway.deleteRoute(binding.routeId),
        );
        state.gatewayLeaseRegistered = true;
      }
      return safeGatewayBinding(state.gateway);
    },
    "gateway.collect-ledger": async (_input, context) => {
      const binding = requireGateway(stateFor(context));
      const entries = await options.gateway.getLedger(binding.routeId);
      return {
        routeId: binding.routeId,
        callCount: entries.length,
        forwardedCount: entries.filter(
          (entry) => entry.outcome === "forwarded",
        ).length,
        rejectedCount: entries.filter(
          (entry) => entry.outcome === "rejected",
        ).length,
        failedCount: entries.filter((entry) => entry.outcome === "failed")
          .length,
      };
    },
    "target.prepare-run": async (_input, context) => {
      const state = stateFor(context);
      if (!state.prepared) {
        state.prepared = await options.adapter.prepareRun(
          adapterContext(context),
        );
      }
      if (!state.targetLeaseRegistered) {
        const prepared = state.prepared;
        const expiresAt = new Date(
          Date.now() +
            (options.defaultTargetLeaseTtlMs ?? 24 * 60 * 60 * 1000),
        ).toISOString();
        await context.registerResourceLease(
          "target-run",
          prepared.targetRunId,
          expiresAt,
          async () => options.adapter.cleanupRun(adapterContext(context)),
        );
        state.targetLeaseRegistered = true;
      }
      return safePreparedTarget(state.prepared);
    },
    "target.configure-vendors": async (input, context) => {
      const state = stateFor(context);
      requirePrepared(state);
      const endpoints = readStringMap(readObject(input), "endpoints");
      assertSafeVendorEndpoints(endpoints);
      await options.adapter.configureVendorEndpoints(
        adapterContext(context),
        endpoints,
      );
      return { configuredVendorIds: Object.keys(endpoints).sort() };
    },
    "target.configure-site": async (input, context) => {
      const state = stateFor(context);
      const prepared = requirePrepared(state);
      const value = readObject(input);
      const gateway = requireGateway(state);
      const site: SiteDefinition = {
        siteId: readOptionalString(value, "siteId") ?? prepared.siteId,
        hostname: assertSyntheticHostname(readString(value, "hostname")),
        trackingScriptUrl:
          readOptionalString(value, "trackingScriptUrl") ??
          prepared.trackingScriptUrl,
        gateway: {
          proxyBaseUrl: gateway.proxyBaseUrl,
          routeToken: gateway.routeToken,
          runIdHeader: context.runId,
        },
      };
      const configured = await options.adapter.configureSyntheticSite(
        adapterContext(context),
        site,
      );
      return {
        siteId: configured.siteId,
        hostname: configured.hostname,
        gatewayRouteId: gateway.routeId,
      };
    },
    "target.start-observation": async (_input, context) => {
      const state = stateFor(context);
      requirePrepared(state);
      state.observation = await options.adapter.startObservation(
        adapterContext(context),
      );
      return {
        observationId: state.observation.observationId,
        targetRunId: state.observation.targetRunId,
      };
    },
    "target.wait-for-completion": async (input, context) => {
      const state = stateFor(context);
      if (!state.observation) {
        throw new Error("Target observation has not been started.");
      }
      const value = readObject(input);
      const expectedState = readOptionalString(value, "expectedState");
      const result = await options.adapter.waitForCompletion(
        adapterContext(context),
        {
          timeoutMs: readOptionalNumber(value, "timeoutMs") ?? 60_000,
          pollIntervalMs:
            readOptionalNumber(value, "pollIntervalMs") ?? 2_000,
          ...(expectedState ? { expectedState } : {}),
          signal: context.signal,
        },
      );
      return {
        completed: result.completed,
        state: result.state,
        observedAt: result.observedAt,
        ...(result.detailsFingerprint
          ? { detailsFingerprint: result.detailsFingerprint }
          : {}),
      };
    },
    "target.collect-outcome": async (_input, context) => {
      const outcome = await options.adapter.collectOutcome(
        adapterContext(context),
      );
      return {
        targetRunId: outcome.targetRunId,
        tenantId: outcome.tenantId,
        visibleTenantIds: outcome.visibleTenantIds,
        scoreCount: outcome.scoreCount,
        companyCount: outcome.companyCount,
        ...(outcome.detailsFingerprint
          ? { detailsFingerprint: outcome.detailsFingerprint }
          : {}),
      };
    },
    "target.cleanup-run": async (_input, context) => {
      const state = stateFor(context);
      await options.adapter.cleanupRun(adapterContext(context));
      if (state.gateway) {
        await options.gateway.deleteRoute(state.gateway.routeId);
      }
      states.delete(context.runId);
      return { cleaned: true };
    },
  };

  return {
    actions,
    routeFor: (context) => requireGateway(stateFor(context)),
  };
}

export function createGatewayTargetScenarioActions(
  options: GatewayTargetScenarioActionsOptions,
): ScenarioActionRegistry {
  return createGatewayTargetScenarioActionBundle(options).actions;
}

export function createGatewayTargetResourceCleaners(
  gateway: GatewayAdminClient,
  adapter: TargetAdapter,
): Readonly<Record<string, (lease: PersistedResourceLease) => Promise<void>>> {
  return {
    "gateway-route": async (lease) => gateway.deleteRoute(lease.resourceKey),
    "target-run": async (lease) => adapter.cleanupTarget(lease.resourceKey),
  };
}

export function mergeScenarioActionRegistries(
  ...registries: readonly ScenarioActionRegistry[]
): ScenarioActionRegistry {
  const merged: Record<string, ScenarioActionRegistry[string]> = {};
  for (const registry of registries) {
    for (const [name, handler] of Object.entries(registry)) {
      if (merged[name]) {
        throw new Error(`Scenario action '${name}' was registered twice.`);
      }
      merged[name] = handler;
    }
  }
  return merged;
}

const blockedProviderHosts = [
  "ipinfo.io",
  "api.ipinfo.io",
  "hunter.io",
  "api.hunter.io",
  "apollo.io",
  "api.apollo.io",
] as const;

function assertSafeVendorEndpoints(endpoints: VendorEndpoints): void {
  for (const [vendorId, endpoint] of Object.entries(endpoints)) {
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new Error(`Vendor endpoint '${vendorId}' must be an absolute URL.`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(
        `Vendor endpoint '${vendorId}' must use HTTP or HTTPS.`,
      );
    }
    if (url.username || url.password || url.hash) {
      throw new Error(
        `Vendor endpoint '${vendorId}' cannot contain credentials or a fragment.`,
      );
    }
    const hostname = url.hostname.toLowerCase();
    if (
      blockedProviderHosts.some(
        (blocked) => hostname === blocked || hostname.endsWith(`.${blocked}`),
      )
    ) {
      throw new Error(
        `Vendor endpoint '${vendorId}' cannot target a real provider host.`,
      );
    }
    if (!isSyntheticRuntimeHostname(hostname)) {
      throw new Error(
        `Vendor endpoint '${vendorId}' must target an isolated synthetic runtime.`,
      );
    }
  }
}

function isSyntheticRuntimeHostname(hostname: string): boolean {
  if (
    hostname === "localhost" ||
    hostname === "[::1]" ||
    !hostname.includes(".")
  ) {
    return true;
  }
  if (/\.(?:test|example|invalid|internal)$/iu.test(hostname)) return true;
  const octets = hostname.split(".").map((value) => Number(value));
  if (
    octets.length !== 4 ||
    octets.some(
      (value) =>
        !Number.isInteger(value) || value < 0 || value > 255,
    )
  ) {
    return false;
  }
  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 &&
      (octets[1] ?? 0) >= 16 &&
      (octets[1] ?? 0) <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 192 && octets[1] === 0 && octets[2] === 2) ||
    (octets[0] === 198 && octets[1] === 51 && octets[2] === 100) ||
    (octets[0] === 203 && octets[1] === 0 && octets[2] === 113)
  );
}

function assertSyntheticHostname(value: string): string {
  const hostname = value.toLowerCase();
  if (
    hostname === "localhost" ||
    !hostname.includes(".") ||
    /\.(?:test|example|invalid|internal)$/iu.test(hostname)
  ) {
    return value;
  }
  throw new Error(
    "Synthetic site hostname must use an approved test namespace.",
  );
}

function safeGatewayBinding(
  binding: GatewayRouteBinding | undefined,
): ScenarioValue {
  if (!binding) throw new Error("Gateway route is not available.");
  return {
    routeId: binding.routeId,
    proxyBaseUrl: binding.proxyBaseUrl,
    expiresAt: binding.expiresAt,
    targetOriginFingerprint: binding.targetOriginFingerprint,
    syntheticIpFingerprint: binding.syntheticIpFingerprint,
  };
}

function safePreparedTarget(
  prepared: PreparedTarget | undefined,
): ScenarioValue {
  if (!prepared) throw new Error("Target run is not prepared.");
  return {
    targetRunId: prepared.targetRunId,
    tenantId: prepared.tenantId,
    ...(prepared.controlTenantId
      ? { controlTenantId: prepared.controlTenantId }
      : {}),
    trackingScriptUrl: prepared.trackingScriptUrl,
    siteId: prepared.siteId,
  };
}

function requireGateway(state: RunIntegrationState): GatewayRouteBinding {
  if (!state.gateway) throw new Error("Gateway route has not been created.");
  return state.gateway;
}

function requirePrepared(state: RunIntegrationState): PreparedTarget {
  if (!state.prepared) throw new Error("Target run has not been prepared.");
  return state.prepared;
}

function readObject(
  input: ScenarioValue | undefined,
): Readonly<Record<string, ScenarioValue>> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Scenario action input must be an object.");
  }
  return input as Readonly<Record<string, ScenarioValue>>;
}

function readString(
  value: Readonly<Record<string, ScenarioValue>>,
  key: string,
): string {
  const result = value[key];
  if (typeof result !== "string" || result.length === 0) {
    throw new Error(
      `Scenario action input '${key}' must be a non-empty string.`,
    );
  }
  return result;
}

function readOptionalString(
  value: Readonly<Record<string, ScenarioValue>>,
  key: string,
): string | undefined {
  const result = value[key];
  return typeof result === "string" && result.length > 0
    ? result
    : undefined;
}

function readOptionalNumber(
  value: Readonly<Record<string, ScenarioValue>>,
  key: string,
): number | undefined {
  const result = value[key];
  return typeof result === "number" && Number.isFinite(result)
    ? result
    : undefined;
}

function readStringMap(
  value: Readonly<Record<string, ScenarioValue>>,
  key: string,
): VendorEndpoints {
  const candidate = value[key];
  if (
    !candidate ||
    typeof candidate !== "object" ||
    Array.isArray(candidate)
  ) {
    throw new Error(`Scenario action input '${key}' must be an object.`);
  }
  const result: Record<string, string> = {};
  for (const [name, endpoint] of Object.entries(candidate)) {
    if (typeof endpoint !== "string") {
      throw new Error(`Vendor endpoint '${name}' must be a string.`);
    }
    result[name] = endpoint;
  }
  return result;
}

export function adapterRunContext(
  runId: RunId,
  scenarioId: RunContext["scenarioId"],
  target: string,
  createdAt: string,
): AdapterRunContext {
  return { runId, scenarioId, target, createdAt };
}
