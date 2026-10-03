export { FakeTargetAdapter } from "./fake.js";
export {
  adapterRunContext,
  createGatewayTargetResourceCleaners,
  createGatewayTargetScenarioActionBundle,
  createGatewayTargetScenarioActions,
  mergeScenarioActionRegistries,
} from "./scenario-actions.js";
export type {
  AdapterRunContext,
  CompletionCondition,
  GatewaySiteBinding,
  ObservationHandle,
  ObservationResult,
  PreparedTarget,
  SiteDefinition,
  TargetAdapter,
  TargetCapabilities,
  TargetOutcome,
  VendorEndpoints,
} from "./types.js";
export type {
  BrowserTargetRunContext,
  GatewayTargetScenarioActionBundle,
  GatewayTargetScenarioActionsOptions,
} from "./scenario-actions.js";
