import type { RunContext } from "@testy/shared-types";

export interface VendorEndpoints {
  readonly ipinfo: URL;
  readonly apollo?: URL;
  readonly hunter?: URL;
}

export interface SiteDefinition {
  readonly customerId: string;
  readonly siteId: string;
  readonly hostname: string;
  readonly trackingScriptUrl: URL;
}

export interface PreparedTarget {
  readonly tenantIds: readonly string[];
  readonly siteIds: readonly string[];
  readonly testEnvironment: string;
  readonly expiresAt: string;
}

export interface SiteBinding {
  readonly customerId: string;
  readonly siteId: string;
  readonly publicUrl: URL;
}

export interface CompletionCondition {
  readonly correlationId: string;
  readonly timeoutMs: number;
  readonly expectedState: string;
}

export interface ObservationHandle {
  readonly observationId: string;
  readonly startedAt: string;
}

export interface ObservationResult {
  readonly completed: boolean;
  readonly state: string;
  readonly observedAt: string;
  readonly safeMetadata: Readonly<Record<string, string | number | boolean | null>>;
}

export interface TargetOutcome {
  readonly identifiedCompanyId?: string;
  readonly scoreCount: number;
  readonly visibleTenantIds: readonly string[];
  readonly providerCorrelationIds: readonly string[];
  readonly safeMetadata: Readonly<Record<string, string | number | boolean | null>>;
}

export interface TargetAdapter {
  prepareRun(context: RunContext): Promise<PreparedTarget>;
  configureVendorEndpoints(
    context: RunContext,
    endpoints: VendorEndpoints,
  ): Promise<void>;
  configureSyntheticSite(
    context: RunContext,
    site: SiteDefinition,
  ): Promise<SiteBinding>;
  startObservation(context: RunContext): Promise<ObservationHandle>;
  waitForCompletion(
    context: RunContext,
    condition: CompletionCondition,
  ): Promise<ObservationResult>;
  collectOutcome(context: RunContext): Promise<TargetOutcome>;
  cleanupRun(context: RunContext): Promise<void>;
}

export const TARGET_ADAPTER_VERSION = "1.0" as const;
