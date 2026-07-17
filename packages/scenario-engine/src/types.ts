import type {
  AssertionDefinition,
  AssertionResult,
  AssertionSnapshot,
  AssertionValue,
} from "@testy/assertion-engine";
import type {
  ResourceLease,
  RunId,
  RunStatus,
  SanitizedError,
  ScenarioId,
} from "@testy/shared-types";

export type ScenarioScalar = string | number | boolean | null;
export type ScenarioValue = AssertionValue;

export interface ScenarioConfig {
  readonly schemaVersion: "1.0";
  readonly scenario: {
    readonly id: string;
    readonly displayName: string;
  };
  readonly target: string;
  readonly timeoutMs?: number;
  readonly variables?: Readonly<Record<string, ScenarioValue>>;
  readonly fragments?: Readonly<
    Record<string, readonly ScenarioStepDefinition[]>
  >;
  readonly assertions?: readonly AssertionDefinition[];
  readonly phases: ScenarioPhaseConfig;
}

export interface ScenarioPhaseConfig {
  readonly allocate?: readonly ScenarioStepDefinition[];
  readonly compile?: readonly ScenarioStepDefinition[];
  readonly configure?: readonly ScenarioStepDefinition[];
  readonly run: readonly ScenarioStepDefinition[];
  readonly observe?: readonly ScenarioStepDefinition[];
  readonly assert?: readonly ScenarioStepDefinition[];
}

export interface RetryPolicy {
  readonly attempts: number;
  readonly delayMs?: number;
  readonly backoffFactor?: number;
}

export interface ScenarioCondition {
  readonly path: string;
  readonly equals: ScenarioValue;
}

interface BaseStep {
  readonly id: string;
  readonly timeoutMs?: number;
}

export interface TaskStep extends BaseStep {
  readonly kind: "task";
  readonly action: string;
  readonly input?: ScenarioValue;
  readonly retry?: RetryPolicy;
  readonly compensate?: {
    readonly action: string;
    readonly input?: ScenarioValue;
  };
}

export interface ParallelStep extends BaseStep {
  readonly kind: "parallel";
  readonly steps: readonly ScenarioStepDefinition[];
}

export interface RepeatStep extends BaseStep {
  readonly kind: "repeat";
  readonly times: number;
  readonly steps: readonly ScenarioStepDefinition[];
}

export interface ConditionStep extends BaseStep {
  readonly kind: "condition";
  readonly when: ScenarioCondition;
  readonly then: readonly ScenarioStepDefinition[];
  readonly else?: readonly ScenarioStepDefinition[];
}

export interface PollStep extends BaseStep {
  readonly kind: "poll";
  readonly action: string;
  readonly input?: ScenarioValue;
  readonly until: ScenarioCondition;
  readonly intervalMs: number;
  readonly retry?: RetryPolicy;
}

export interface FragmentStep extends BaseStep {
  readonly kind: "fragment";
  readonly useFragment: string;
}

export type ScenarioStepDefinition =
  | TaskStep
  | ParallelStep
  | RepeatStep
  | ConditionStep
  | PollStep
  | FragmentStep;

export type ResolvedTaskStep = TaskStep;
export type ResolvedPollStep = PollStep;
export interface ResolvedParallelStep extends Omit<ParallelStep, "steps"> {
  readonly steps: readonly ResolvedScenarioStep[];
}
export interface ResolvedRepeatStep extends Omit<RepeatStep, "steps"> {
  readonly steps: readonly ResolvedScenarioStep[];
}
export interface ResolvedConditionStep extends Omit<
  ConditionStep,
  "then" | "else"
> {
  readonly then: readonly ResolvedScenarioStep[];
  readonly else?: readonly ResolvedScenarioStep[];
}
export type ResolvedScenarioStep =
  | ResolvedTaskStep
  | ResolvedPollStep
  | ResolvedParallelStep
  | ResolvedRepeatStep
  | ResolvedConditionStep;

export interface ResolvedScenario {
  readonly schemaVersion: "1.0";
  readonly scenarioId: string;
  readonly displayName: string;
  readonly target: string;
  readonly timeoutMs: number;
  readonly variables: Readonly<Record<string, ScenarioValue>>;
  readonly phases: {
    readonly allocate: readonly ResolvedScenarioStep[];
    readonly compile: readonly ResolvedScenarioStep[];
    readonly configure: readonly ResolvedScenarioStep[];
    readonly run: readonly ResolvedScenarioStep[];
    readonly observe: readonly ResolvedScenarioStep[];
    readonly assert: readonly ResolvedScenarioStep[];
  };
  readonly assertions?: readonly AssertionDefinition[];
  readonly contentHash: string;
}

export interface ScenarioActionContext {
  readonly runId: RunId;
  readonly scenarioId: ScenarioId;
  readonly target: string;
  readonly variables: Readonly<Record<string, ScenarioValue>>;
  readonly outputs: Readonly<Record<string, ScenarioValue>>;
  readonly signal: AbortSignal;
  registerCleanup(name: string, cleanup: () => Promise<void>): void;
  registerResourceLease(
    resourceType: string,
    resourceKey: string,
    expiresAt: string,
    cleanup: () => Promise<void>,
  ): Promise<ResourceLease>;
}

export type ScenarioActionHandler = (
  input: ScenarioValue | undefined,
  context: ScenarioActionContext,
) => Promise<ScenarioValue | undefined>;

export type ScenarioActionRegistry = Readonly<
  Record<string, ScenarioActionHandler>
>;

export interface ScenarioStepRecord {
  readonly runId: RunId;
  readonly stepId: string;
  readonly kind: ResolvedScenarioStep["kind"];
  readonly phase: RunStatus;
  readonly status: "RUNNING" | "PASSED" | "FAILED" | "CANCELLED" | "SKIPPED";
  readonly attempt: number;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly durationMs?: number;
  readonly outputFingerprint?: string;
  readonly error?: SanitizedError;
}

export interface ScenarioTimelineRecord {
  readonly occurredAt: string;
  readonly runId: RunId;
  readonly category: "lifecycle" | "step" | "cleanup" | "engine" | "assertion";
  readonly name: string;
  readonly metadata: Readonly<Record<string, ScenarioValue>>;
}

export interface ScenarioExecutionObserver {
  onStatus(status: RunStatus): Promise<void>;
  onStep(record: ScenarioStepRecord): Promise<void>;
  onTimeline(record: ScenarioTimelineRecord): Promise<void>;
  onResourceLease?(lease: ResourceLease): Promise<void>;
  onResourceReleased?(leaseId: string, releasedAt: string): Promise<void>;
}

export interface ScenarioExecutionOptions {
  readonly runId: RunId;
  readonly signal?: AbortSignal;
  readonly observer?: ScenarioExecutionObserver;
}

export interface ScenarioExecutionReport {
  readonly schemaVersion: "1.0";
  readonly runId: RunId;
  readonly scenarioId: string;
  readonly contentHash: string;
  readonly status: "PASSED" | "FAILED" | "CANCELLED";
  readonly startedAt: string;
  readonly completedAt: string;
  readonly outputKeys: readonly string[];
  readonly outputFingerprints: Readonly<Record<string, string>>;
  readonly cleanupErrors: readonly SanitizedError[];
  readonly error?: SanitizedError;
}

export interface PersistedRun {
  readonly id: RunId;
  readonly scenarioId: string;
  readonly target: string;
  readonly status: RunStatus;
  readonly outcomeStatus?: "PASSED" | "FAILED" | "CANCELLED";
  readonly resolvedScenarioHash: string;
  readonly resolvedScenario: ResolvedScenario;
  readonly metadata: Readonly<Record<string, ScenarioValue>>;
  readonly cancelRequestedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
}

export interface PersistedProviderCall {
  readonly runId: RunId;
  readonly vendorId: string;
  readonly operationId?: string;
  readonly caseId?: string;
  readonly correlationId?: string;
  readonly sequenceIndex?: number;
  readonly statusCode?: number;
  readonly durationMs?: number;
  readonly metadata: Readonly<Record<string, ScenarioValue>>;
  readonly occurredAt: string;
}

export interface PersistedBrowserAction {
  readonly runId: RunId;
  readonly journeyId: string;
  readonly stepId: string;
  readonly action: string;
  readonly status: "PASSED" | "FAILED" | "CANCELLED";
  readonly durationMs?: number;
  readonly pageFingerprint?: string;
  readonly metadata: Readonly<Record<string, ScenarioValue>>;
  readonly startedAt: string;
  readonly completedAt?: string;
}

export interface PersistedObservation {
  readonly observationId: string;
  readonly runId: RunId;
  readonly observationType: string;
  readonly status: string;
  readonly value?: ScenarioValue;
  readonly metadata: Readonly<Record<string, ScenarioValue>>;
  readonly observedAt: string;
}

export interface ScenarioRunReport {
  readonly run: PersistedRun;
  readonly steps: readonly ScenarioStepRecord[];
  readonly timeline: readonly ScenarioTimelineRecord[];
  readonly artifacts: readonly PersistedArtifact[];
  readonly assertions: readonly AssertionResult[];
  readonly providerCalls: readonly PersistedProviderCall[];
  readonly browserActions: readonly PersistedBrowserAction[];
  readonly observations: readonly PersistedObservation[];
}

export interface PersistedArtifact {
  readonly artifactId: string;
  readonly runId: RunId;
  readonly kind: string;
  readonly mediaType: string;
  readonly location: string;
  readonly sha256: string;
  readonly metadata: Readonly<Record<string, ScenarioValue>>;
  readonly createdAt: string;
}

export interface PersistedResourceLease extends ResourceLease {
  readonly status: "ACTIVE" | "RELEASED";
  readonly releasedAt?: string;
}

export interface ScenarioRunRepository {
  createRun(run: PersistedRun): Promise<void>;
  updateRunStatus(
    runId: RunId,
    status: RunStatus,
    options?: {
      readonly outcomeStatus?: "PASSED" | "FAILED" | "CANCELLED";
      readonly startedAt?: string;
      readonly finishedAt?: string;
      readonly metadata?: Readonly<Record<string, ScenarioValue>>;
    },
  ): Promise<void>;
  requestCancellation(runId: RunId, requestedAt: string): Promise<boolean>;
  getRun(runId: RunId): Promise<PersistedRun | undefined>;
  listActiveRuns(): Promise<readonly PersistedRun[]>;
  recordStep(record: ScenarioStepRecord): Promise<void>;
  appendTimeline(record: ScenarioTimelineRecord): Promise<void>;
  listTimeline(runId: RunId): Promise<readonly ScenarioTimelineRecord[]>;
  listSteps(runId: RunId): Promise<readonly ScenarioStepRecord[]>;
  addArtifact(artifact: PersistedArtifact): Promise<void>;
  listArtifacts(runId: RunId): Promise<readonly PersistedArtifact[]>;
  recordAssertionResult(result: AssertionResult): Promise<void>;
  listAssertionResults(runId: RunId): Promise<readonly AssertionResult[]>;
  recordProviderCall(record: PersistedProviderCall): Promise<void>;
  listProviderCalls(runId: RunId): Promise<readonly PersistedProviderCall[]>;
  recordBrowserAction(record: PersistedBrowserAction): Promise<void>;
  listBrowserActions(runId: RunId): Promise<readonly PersistedBrowserAction[]>;
  recordObservation(record: PersistedObservation): Promise<void>;
  listObservations(runId: RunId): Promise<readonly PersistedObservation[]>;
  createResourceLease(lease: ResourceLease): Promise<void>;
  releaseResourceLease(leaseId: string, releasedAt: string): Promise<void>;
  listActiveResourceLeases(
    runId: RunId,
  ): Promise<readonly PersistedResourceLease[]>;
  buildAssertionSnapshot(runId: RunId): Promise<AssertionSnapshot>;
  buildReport(runId: RunId): Promise<ScenarioRunReport | undefined>;
}
