import type { RunContext, RunId } from "@testy/shared-types";

export interface DemoCredentialContext {
  readonly mode: "shared" | "generated";
  readonly email: string;
  readonly password: string;
}

export interface AdapterRunContext extends RunContext {
  readonly signal?: AbortSignal;
  readonly demoSessionId?: string;
  readonly demoCredential?: DemoCredentialContext;
  readonly shareSeededDemoAccounts?: boolean;
}

export interface PreparedTarget {
  readonly targetRunId: string;
  readonly tenantId: string;
  readonly controlTenantId?: string;
  readonly trackingScriptUrl: string;
  readonly siteId: string;
  readonly targetOrigin: string;
  readonly ingestionToken?: string;
  readonly contractVersion?: string;
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
  readonly origin?: string;
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

export type TargetCompanyOutcome = Readonly<Record<string, string | number>> & {
  readonly domain: string;
  readonly displayName: string;
  readonly score: number;
  readonly confidence: string;
  readonly visibility: string;
};

export interface TargetOutcome {
  readonly targetRunId: string;
  readonly tenantId: string;
  readonly visibleTenantIds: readonly string[];
  readonly scoreCount: number;
  readonly companyCount: number;
  readonly enrichedCompanyCount?: number;
  readonly contactCount?: number;
  readonly processedEventCount?: number;
  readonly duplicateEventCount?: number;
  readonly companyFingerprint?: string;
  readonly companies?: readonly TargetCompanyOutcome[];
  readonly scoreFingerprints?: readonly string[];
  readonly providerProvenance?: readonly string[];
  readonly confidence?: "low" | "medium" | "high";
  readonly suppressionStatus?: "allowed" | "suppressed";
  readonly processingWarnings?: readonly string[];
  readonly detailsFingerprint?: string;
}

export interface TargetCapabilities {
  readonly contractVersion: string;
  readonly target: string;
  readonly features: Readonly<Record<string, boolean>>;
}

export interface DemoWorkspaceAccount {
  readonly id: string;
  readonly userId: string;
  readonly email: string;
  readonly role: "admin" | "sales" | "read_only";
  readonly kind: "seeded" | "protected_admin" | "managed" | "external";
  readonly removable: boolean;
}

export interface DemoWorkspaceAccounts {
  readonly targetRunId: string;
  readonly shareSeededDemoAccounts: boolean;
  readonly hibernated: boolean;
  readonly accounts: readonly DemoWorkspaceAccount[];
}

export interface GeneratedDemoWorkspaceAccount {
  readonly account: DemoWorkspaceAccount;
  readonly credentials: { readonly email: string; readonly password: string };
}

export interface TargetAdapter {
  capabilities?(): Promise<TargetCapabilities>;
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
  triggerEnrichment?(
    context: AdapterRunContext,
    options?: { readonly since?: string },
  ): Promise<void>;
  waitForCompletion(
    context: AdapterRunContext,
    condition: CompletionCondition,
  ): Promise<ObservationResult>;
  collectOutcome(
    context: AdapterRunContext,
    options?: { readonly since?: string },
  ): Promise<TargetOutcome>;
  cleanupRun(context: AdapterRunContext): Promise<void>;
  cleanupTarget(targetRunId: string): Promise<void>;
  hibernateTarget?(targetRunId: string): Promise<void>;
  resumeTarget?(targetRunId: string): Promise<void>;
  listDemoUsers?(targetRunId: string): Promise<DemoWorkspaceAccounts>;
  createDemoUser?(targetRunId: string, role: "admin" | "sales" | "read_only"): Promise<GeneratedDemoWorkspaceAccount>;
  revokeDemoUser?(targetRunId: string, accountId: string): Promise<void>;
}
