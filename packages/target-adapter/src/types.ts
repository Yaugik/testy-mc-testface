import type { RunContext, RunId } from "@testy/shared-types";

export interface AdapterRunContext extends RunContext {
  readonly signal?: AbortSignal;
}

export interface PreparedTarget {
  readonly targetRunId: string;
  readonly tenantId: string;
  readonly controlTenantId?: string;
  readonly trackingScriptUrl: string;
  readonly siteId: string;
  readonly targetOrigin: string;
}

export type VendorEndpoints = Readonly<Record<string, string>>;

export interface GatewaySiteBinding {
  readonly proxyBaseUrl: string;
  readonly routeToken: string;
  readonly runIdHeader: RunId;
}

export interface SiteDefinition {
  readonly siteId: string;
  readonly hostname: string;
  readonly trackingScriptUrl?: string;
  readonly gateway?: GatewaySiteBinding;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface ObservationHandle {
  readonly observationId: string;
  readonly targetRunId: string;
}

export interface CompletionCondition {
  readonly timeoutMs: number;
  readonly pollIntervalMs: number;
  readonly expectedState?: string;
  readonly signal?: AbortSignal;
}

export interface ObservationResult {
  readonly completed: boolean;
  readonly state: string;
  readonly observedAt: string;
  readonly detailsFingerprint?: string;
}

export interface TargetOutcome {
  readonly targetRunId: string;
  readonly tenantId: string;
  readonly visibleTenantIds: readonly string[];
  readonly scoreCount: number;
  readonly companyCount: number;
  readonly detailsFingerprint?: string;
}

export interface TargetAdapter {
  prepareRun(context: AdapterRunContext): Promise<PreparedTarget>;
  configureVendorEndpoints(
    context: AdapterRunContext,
    endpoints: VendorEndpoints,
  ): Promise<void>;
  configureSyntheticSite(
    context: AdapterRunContext,
    site: SiteDefinition,
  ): Promise<SiteDefinition>;
  startObservation(context: AdapterRunContext): Promise<ObservationHandle>;
  waitForCompletion(
    context: AdapterRunContext,
    condition: CompletionCondition,
  ): Promise<ObservationResult>;
  collectOutcome(context: AdapterRunContext): Promise<TargetOutcome>;
  cleanupRun(context: AdapterRunContext): Promise<void>;
  cleanupTarget(targetRunId: string): Promise<void>;
}
