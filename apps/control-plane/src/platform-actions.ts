import { GlEyeTargetAdapter } from "@testy/gl-eye-adapter";
import {
  createBuiltinScenarioActions,
  type ScenarioActionRegistry,
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
  return {
    actions: mergeScenarioActionRegistries(
      builtins,
      createGatewayTargetScenarioActions({ gateway, adapter }),
    ),
    resourceCleaners: {
      synthetic: async () => undefined,
      ...createGatewayTargetResourceCleaners(gateway, adapter),
    },
  };
}
