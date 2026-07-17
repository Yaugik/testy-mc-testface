import { GlEyeTargetAdapter } from "@testy/gl-eye-adapter";
import {
  createBuiltinScenarioActions,
  type ScenarioActionHandler,
  type ScenarioActionRegistry,
  type ScenarioRunRepository,
  type ScenarioValue,
} from "@testy/scenario-engine";
import {
  createGatewayTargetResourceCleaners,
  createGatewayTargetScenarioActions,
  mergeScenarioActionRegistries,
} from "@testy/target-adapter";
import { GatewayAdminClient } from "@testy/traffic-gateway";

import type { TargetIntegrationConfig } from "./config.js";
import type { ResourceLeaseCleaner } from "./run-service.js";

export interface PlatformActions {
  readonly actions: ScenarioActionRegistry;
  readonly resourceCleaners: Readonly<Record<string, ResourceLeaseCleaner>>;
}

export function createPlatformActions(
  integration: TargetIntegrationConfig | undefined,
  evidence?: ScenarioRunRepository,
): PlatformActions {
  const builtins = createBuiltinScenarioActions();
  if (!integration) {
    return {
      actions: builtins,
      resourceCleaners: { synthetic: async () => undefined },
    };
  }
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
  const targetActions = createGatewayTargetScenarioActions({ gateway, adapter });
  const actions = evidence ? recordTargetObservations(targetActions, evidence) : targetActions;
  return {
    actions: mergeScenarioActionRegistries(builtins, actions),
    resourceCleaners: {
      synthetic: async () => undefined,
      ...createGatewayTargetResourceCleaners(gateway, adapter),
    },
  };
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
      (value) => readBoolean(value, "completed") === true ? "completed" : "pending",
    ),
    "target.collect-outcome": wrapObservation(
      requireAction(actions, "target.collect-outcome"),
      evidence,
      "target-outcome",
      () => "completed",
    ),
  };
}

function wrapObservation(
  action: ScenarioActionHandler,
  evidence: ScenarioRunRepository,
  observationType: string,
  status: (value: ScenarioValue | undefined) => string,
): ScenarioActionHandler {
  return async (input, context) => {
    const value = await action(input, context);
    await evidence.recordObservation({
      observationId: observationType,
      runId: context.runId,
      observationType,
      status: status(value),
      ...(value === undefined ? {} : { value }),
      metadata: { sourceAction: observationType },
      observedAt: new Date().toISOString(),
    });
    return value;
  };
}

function requireAction(actions: ScenarioActionRegistry, name: string): ScenarioActionHandler {
  const action = actions[name];
  if (!action) throw new Error(`Scenario action '${name}' is not registered.`);
  return action;
}

function readBoolean(value: ScenarioValue | undefined, key: string): boolean | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const selected = (value as Readonly<Record<string, ScenarioValue>>)[key];
  return typeof selected === "boolean" ? selected : undefined;
}
