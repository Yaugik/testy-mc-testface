import type { RunId } from "@testy/shared-types";

export type AssertionScalar = string | number | boolean | null;
export type AssertionValue =
  | AssertionScalar
  | readonly AssertionValue[]
  | { readonly [key: string]: AssertionValue };

export type AssertionSeverity = "error" | "warning";

interface BaseAssertionDefinition {
  readonly id: string;
  readonly type: string;
  readonly severity?: AssertionSeverity;
  readonly description?: string;
}

export interface ProviderCallSelector {
  readonly vendorId: string;
  readonly operationId?: string;
  readonly caseId?: string;
  readonly statusCode?: number;
}

export interface ProviderCallCountAssertion extends BaseAssertionDefinition {
  readonly type: "provider-call-count";
  readonly vendorId: string;
  readonly operationId?: string;
  readonly caseId?: string;
  readonly statusCode?: number;
  readonly equals?: number;
  readonly minimum?: number;
  readonly maximum?: number;
}

export interface ProviderCallOrderAssertion extends BaseAssertionDefinition {
  readonly type: "provider-call-order";
  readonly sequence: readonly ProviderCallSelector[];
  readonly exact?: boolean;
}

export interface BrowserJourneyPassedAssertion extends BaseAssertionDefinition {
  readonly type: "browser-journey-passed";
  readonly journeyId: string;
}

export interface BrowserActionAssertion extends BaseAssertionDefinition {
  readonly type: "browser-action";
  readonly journeyId: string;
  readonly stepId?: string;
  readonly action?: string;
  readonly expectedStatus?: "PASSED" | "FAILED" | "CANCELLED";
  readonly minimum?: number;
}

export interface ObservationAssertion extends BaseAssertionDefinition {
  readonly type: "observation";
  readonly observationType: string;
  readonly path?: string;
  readonly operator:
    | "equals"
    | "not-equals"
    | "contains"
    | "present"
    | "absent"
    | "greater-than-or-equal"
    | "less-than-or-equal";
  readonly expected?: AssertionValue;
  readonly status?: string;
  readonly latest?: boolean;
}

export interface ObservationCountAssertion extends BaseAssertionDefinition {
  readonly type: "observation-count";
  readonly observationType: string;
  readonly status?: string;
  readonly equals?: number;
  readonly minimum?: number;
  readonly maximum?: number;
}

export interface StepPassedAssertion extends BaseAssertionDefinition {
  readonly type: "step-passed";
  readonly stepId: string;
}

export interface ArtifactPresentAssertion extends BaseAssertionDefinition {
  readonly type: "artifact-present";
  readonly kind: string;
  readonly minimum?: number;
}

export interface NoUnexpectedExternalCallsAssertion extends BaseAssertionDefinition {
  readonly type: "no-unexpected-external-calls";
  readonly observationType?: string;
}

export type AssertionDefinition =
  | ProviderCallCountAssertion
  | ProviderCallOrderAssertion
  | BrowserJourneyPassedAssertion
  | BrowserActionAssertion
  | ObservationAssertion
  | ObservationCountAssertion
  | StepPassedAssertion
  | ArtifactPresentAssertion
  | NoUnexpectedExternalCallsAssertion;

export interface AssertionResult {
  readonly runId: RunId;
  readonly assertionId: string;
  readonly type: AssertionDefinition["type"];
  readonly severity: AssertionSeverity;
  readonly passed: boolean;
  readonly message: string;
  readonly expected?: AssertionValue;
  readonly actual?: AssertionValue;
  readonly metadata: Readonly<Record<string, AssertionValue>>;
  readonly assertedAt: string;
}

export interface AssertionProviderCallRecord {
  readonly vendorId: string;
  readonly operationId?: string;
  readonly caseId?: string;
  readonly correlationId?: string;
  readonly sequenceIndex?: number;
  readonly statusCode?: number;
  readonly durationMs?: number;
  readonly occurredAt: string;
}

export interface AssertionBrowserActionRecord {
  readonly journeyId: string;
  readonly stepId: string;
  readonly action: string;
  readonly status: string;
  readonly durationMs?: number;
  readonly startedAt: string;
  readonly completedAt?: string;
}

export interface AssertionObservationRecord {
  readonly observationType: string;
  readonly status: string;
  readonly value?: AssertionValue;
  readonly observedAt: string;
}

export interface AssertionStepRecord {
  readonly stepId: string;
  readonly status: string;
  readonly attempt: number;
  readonly startedAt: string;
}

export interface AssertionArtifactRecord {
  readonly kind: string;
}

export interface AssertionSnapshot {
  readonly runId: RunId;
  readonly providerCalls: readonly AssertionProviderCallRecord[];
  readonly browserActions: readonly AssertionBrowserActionRecord[];
  readonly observations: readonly AssertionObservationRecord[];
  readonly steps: readonly AssertionStepRecord[];
  readonly artifacts: readonly AssertionArtifactRecord[];
}

export interface AssertionSnapshotProvider {
  load(runId: RunId): Promise<AssertionSnapshot>;
}

export interface AssertionEvaluationContext {
  readonly runId: RunId;
  readonly signal?: AbortSignal;
}

export type AssertionEvaluator = (
  definitions: readonly AssertionDefinition[],
  context: AssertionEvaluationContext,
) => Promise<readonly AssertionResult[]>;
