import { GlEyeTargetAdapter } from "@testy/gl-eye-adapter";
import { createIntegratedPlatformActions } from "@testy/platform-actions";
import {
  createBuiltinScenarioActions,
  type ScenarioActionContext,
  type ScenarioActionHandler,
  type ScenarioActionRegistry,
  type ScenarioRunRepository,
  type ScenarioValue,
} from "@testy/scenario-engine";
import {
  createGatewayTargetResourceCleaners,
  createGatewayTargetScenarioActionBundle,
  mergeScenarioActionRegistries,
} from "@testy/target-adapter";
import {
  createTrafficScenarioActions,
  type TrafficEvidence,
} from "@testy/traffic-generator";
import { GatewayAdminClient } from "@testy/traffic-gateway";

import type { ControlPlaneConfig } from "./config.js";
import type { ResourceLeaseCleaner } from "./run-service.js";
import { deriveTargetOutcome } from "./target-outcome.js";

export interface PlatformActions {
  readonly actions: ScenarioActionRegistry;
  readonly resourceCleaners: Readonly<Record<string, ResourceLeaseCleaner>>;
}

export function createPlatformActions(
  config: ControlPlaneConfig,
  evidence: ScenarioRunRepository,
): PlatformActions {
  const builtins = createBuiltinScenarioActions();
  const target = config.targetIntegration
    ? createTargetActions(config, evidence)
    : undefined;
  const integrated = createIntegratedPlatformActions({
    vendorPackagesRoot: config.vendorPackagesDirectory,
    browserPackagesRoot: config.browserPackagesDirectory,
    generatedRoot: config.generatedRunsDirectory,
    evidence,
    browser: config.browser,
    headless: config.browserHeadless,
    ...(config.runtimeImage ? { runtimeImage: config.runtimeImage } : {}),
    ...(target
      ? {
          delegates: {
            configureVendorEndpoints: requireAction(
              target.actions,
              "target.configure-vendors",
            ),
            configureSyntheticSite: requireAction(
              target.actions,
              "target.configure-site",
            ),
          },
        }
      : {}),
  });

  return {
    actions: mergeScenarioActionRegistries(
      builtins,
      integrated.actions,
      ...(target ? [target.actions] : []),
    ),
    resourceCleaners: {
      synthetic: async () => undefined,
      ...integrated.resourceCleaners,
      ...(target?.resourceCleaners ?? {}),
    },
  };
}

function createTargetActions(
  config: ControlPlaneConfig,
  evidence: ScenarioRunRepository,
): PlatformActions {
  const integration = config.targetIntegration;
  if (!integration) throw new Error("Target integration is not configured.");
  const gateway = new GatewayAdminClient({
    baseUrl: integration.gatewayAdminUrl,
    adminToken: integration.gatewayAdminToken,
  });
  const adapter = new GlEyeTargetAdapter({
    baseUrl: integration.glEyeBaseUrl,
    environment: integration.glEyeEnvironment,
    authToken: integration.glEyeAuthToken,
    allowedOrigins: integration.glEyeAllowedOrigins,
  });
  const target = createGatewayTargetScenarioActionBundle({ gateway, adapter });
  const traffic = createTrafficScenarioActions({
    routeFor: target.routeFor,
    recordEvidence: async (selected, context) =>
      recordTrafficEvidence(selected, context, evidence),
  });
  const actions = mergeScenarioActionRegistries(target.actions, traffic);
  return {
    actions: recordTargetObservations(actions, evidence),
    resourceCleaners: createGatewayTargetResourceCleaners(gateway, adapter),
  };
}

async function recordTrafficEvidence(
  selected: TrafficEvidence,
  context: ScenarioActionContext,
  evidence: ScenarioRunRepository,
): Promise<void> {
  if (selected.kind === "request") {
    await evidence.recordObservation({
      observationId: `traffic-request-${selected.report.requestId}`,
      runId: context.runId,
      observationType: "traffic-request-summary",
      status: selected.report.status,
      value: selected.report as unknown as ScenarioValue,
      metadata: { sourceAction: "traffic-generator" },
      observedAt: selected.report.completedAt,
    });
    return;
  }
  const report = selected.report;
  await evidence.recordObservation({
    observationId: `traffic-batch-${report.batchId}`,
    runId: context.runId,
    observationType: "traffic-batch-summary",
    status: report.status,
    value: {
      batchId: report.batchId,
      status: report.status,
      durationMs: report.durationMs,
      requestCount: report.requestCount,
      passedCount: report.passedCount,
      failedCount: report.failedCount,
      timedOut: report.timedOut,
      concurrency: report.concurrency,
    },
    metadata: { sourceAction: "traffic-generator" },
    observedAt: report.completedAt,
  });
}

function recordTargetObservations(
  actions: ScenarioActionRegistry,
  evidence: ScenarioRunRepository,
): ScenarioActionRegistry {
  return {
    ...actions,
    "gateway.collect-ledger": wrapObservation(
      requireAction(actions, "gateway.collect-ledger"),
      evidence,
      "gateway-ledger-summary",
      () => "completed",
    ),
    "target.wait-for-completion": wrapObservation(
      requireAction(actions, "target.wait-for-completion"),
      evidence,
      "target-completion",
      (value) =>
        readBoolean(value, "completed") === true ? "completed" : "pending",
    ),
    "target.collect-outcome": wrapObservation(
      requireAction(actions, "target.collect-outcome"),
      evidence,
      "target-outcome",
      () => "completed",
      (value, context) => deriveTargetOutcome(value, context.outputs),
    ),
  };
}

function wrapObservation(
  action: ScenarioActionHandler,
  evidence: ScenarioRunRepository,
  observationType: string,
  status: (value: ScenarioValue | undefined) => string,
  transform?: (
    value: ScenarioValue | undefined,
    context: ScenarioActionContext,
  ) => ScenarioValue | undefined,
): ScenarioActionHandler {
  return async (input, context) => {
    const value = await action(input, context);
    const observed = transform ? transform(value, context) : value;
    await evidence.recordObservation({
      observationId: observationType,
      runId: context.runId,
      observationType,
      status: status(observed),
      ...(observed === undefined ? {} : { value: observed }),
      metadata: { sourceAction: observationType },
      observedAt: new Date().toISOString(),
    });
    return observed;
  };
}

function requireAction(
  actions: ScenarioActionRegistry,
  name: string,
): ScenarioActionHandler {
  const action = actions[name];
  if (!action) throw new Error(`Scenario action '${name}' is not registered.`);
  return action;
}

function readBoolean(
  value: ScenarioValue | undefined,
  key: string,
): boolean | undefined {
  const record = readOptionalRecord(value);
  const selected = record?.[key];
  return typeof selected === "boolean" ? selected : undefined;
}

function readOptionalRecord(
  value: ScenarioValue | undefined,
): Readonly<Record<string, ScenarioValue>> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, ScenarioValue>>)
    : undefined;
}
