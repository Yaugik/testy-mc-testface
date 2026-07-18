import type { AssertionResult, AssertionValue } from "@testy/assertion-engine";
import type {
  PersistedArtifact,
  PersistedBrowserAction,
  PersistedObservation,
  PersistedProviderCall,
  PersistedRun,
  ScenarioStepRecord,
  ScenarioTimelineRecord,
} from "@testy/scenario-engine";

export interface ReportingSource {
  readonly run: PersistedRun;
  readonly steps: readonly ScenarioStepRecord[];
  readonly timeline: readonly ScenarioTimelineRecord[];
  readonly artifacts: readonly PersistedArtifact[];
  readonly assertions: readonly AssertionResult[];
  readonly providerCalls: readonly PersistedProviderCall[];
  readonly browserActions: readonly PersistedBrowserAction[];
  readonly observations: readonly PersistedObservation[];
}

export interface RunReportDocument {
  readonly schemaVersion: "1.0";
  readonly reportId: string;
  readonly generatedAt: string;
  readonly contentHash: string;
  readonly run: {
    readonly runId: string;
    readonly scenarioId: string;
    readonly target: string;
    readonly status: string;
    readonly outcomeStatus?: string;
    readonly scenarioHash: string;
    readonly createdAt: string;
    readonly startedAt?: string;
    readonly finishedAt?: string;
    readonly metadata: Readonly<Record<string, AssertionValue>>;
  };
  readonly summary: {
    readonly passed: boolean;
    readonly assertionCount: number;
    readonly passedAssertions: number;
    readonly failedAssertions: number;
    readonly warningFailures: number;
    readonly stepCount: number;
    readonly failedSteps: number;
    readonly providerCallCount: number;
    readonly browserActionCount: number;
    readonly observationCount: number;
    readonly artifactCount: number;
    readonly durationMs?: number;
  };
  readonly assertions: readonly AssertionResult[];
  readonly steps: readonly ScenarioStepRecord[];
  readonly timeline: readonly ScenarioTimelineRecord[];
  readonly providerCalls: readonly PersistedProviderCall[];
  readonly browserActions: readonly PersistedBrowserAction[];
  readonly observations: readonly PersistedObservation[];
  readonly artifacts: readonly PersistedArtifact[];
}
