export { FakeTargetAdapter } from "./fake.js";
export {
  adapterRunContext,
  createGatewayTargetResourceCleaners,
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
  TargetOutcome,
  VendorEndpoints,
} from "./types.js";
export type { GatewayTargetScenarioActionsOptions } from "./scenario-actions.js";
