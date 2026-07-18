import type { AssertionResult, AssertionSnapshot } from "@testy/assertion-engine";
import type { Pool } from "pg";
import type { ResourceLease, RunId, RunStatus } from "@testy/shared-types";
import type {
  PersistedArtifact,
  PersistedBrowserAction,
  PersistedObservation,
  PersistedProviderCall,
  PersistedResourceLease,
  PersistedRun,
  ScenarioRunReport,
  ScenarioRunRepository,
  ScenarioStepRecord,
  ScenarioTimelineRecord,
  ScenarioValue,
} from "@testy/scenario-engine";

import type {
  MaintenanceClaimOptions,
  RunMaintenanceRepository,
} from "./maintenance.js";
import { PostgresRunEvidenceStore } from "./run-repository-evidence.js";
import { PostgresRunLifecycleStore } from "./run-repository-lifecycle.js";
import { PostgresRunObservationStore } from "./run-repository-observations.js";

export class PostgresScenarioRunRepository
  implements ScenarioRunRepository, RunMaintenanceRepository
{
  private readonly lifecycle: PostgresRunLifecycleStore;
  private readonly evidence: PostgresRunEvidenceStore;
  private readonly observations: PostgresRunObservationStore;

  public constructor(pool: Pool) {
    this.lifecycle = new PostgresRunLifecycleStore(pool);
    this.evidence = new PostgresRunEvidenceStore(pool);
    this.observations = new PostgresRunObservationStore(pool);
  }

  public createRun(run: PersistedRun): Promise<void> {
    return this.lifecycle.createRun(run);
  }

  public updateRunStatus(
    runId: RunId,
    status: RunStatus,
    options: {
      readonly outcomeStatus?: "PASSED" | "FAILED" | "CANCELLED";
      readonly startedAt?: string;
      readonly finishedAt?: string;
      readonly metadata?: Readonly<Record<string, ScenarioValue>>;
    } = {},
  ): Promise<void> {
    return this.lifecycle.updateRunStatus(runId, status, options);
  }

  public requestCancellation(runId: RunId, requestedAt: string): Promise<boolean> {
    return this.lifecycle.requestCancellation(runId, requestedAt);
  }

  public getRun(runId: RunId): Promise<PersistedRun | undefined> {
    return this.lifecycle.getRun(runId);
  }

  public listActiveRuns(): Promise<readonly PersistedRun[]> {
    return this.lifecycle.listActiveRuns();
  }

  public recordStep(record: ScenarioStepRecord): Promise<void> {
    return this.lifecycle.recordStep(record);
  }

  public appendTimeline(record: ScenarioTimelineRecord): Promise<void> {
    return this.lifecycle.appendTimeline(record);
  }

  public listTimeline(runId: RunId): Promise<readonly ScenarioTimelineRecord[]> {
    return this.lifecycle.listTimeline(runId);
  }

  public listSteps(runId: RunId): Promise<readonly ScenarioStepRecord[]> {
    return this.lifecycle.listSteps(runId);
  }

  public addArtifact(record: PersistedArtifact): Promise<void> {
    return this.evidence.addArtifact(record);
  }

  public listArtifacts(runId: RunId): Promise<readonly PersistedArtifact[]> {
    return this.evidence.listArtifacts(runId);
  }

  public claimExpiredArtifacts(
    options: MaintenanceClaimOptions,
  ): Promise<readonly PersistedArtifact[]> {
    return this.evidence.claimExpiredArtifacts(options);
  }

  public recordArtifactDeletionFailure(
    artifactId: string,
    attemptedAt: string,
    errorFingerprint: string,
  ): Promise<void> {
    return this.evidence.recordArtifactDeletionFailure(
      artifactId,
      attemptedAt,
      errorFingerprint,
    );
  }

  public deleteArtifactRecord(artifactId: string): Promise<void> {
    return this.evidence.deleteArtifactRecord(artifactId);
  }

  public recordAssertionResult(record: AssertionResult): Promise<void> {
    return this.evidence.recordAssertionResult(record);
  }

  public listAssertionResults(runId: RunId): Promise<readonly AssertionResult[]> {
    return this.evidence.listAssertionResults(runId);
  }

  public recordProviderCall(record: PersistedProviderCall): Promise<void> {
    return this.evidence.recordProviderCall(record);
  }

  public listProviderCalls(runId: RunId): Promise<readonly PersistedProviderCall[]> {
    return this.evidence.listProviderCalls(runId);
  }

  public recordBrowserAction(record: PersistedBrowserAction): Promise<void> {
    return this.observations.recordBrowserAction(record);
  }

  public listBrowserActions(runId: RunId): Promise<readonly PersistedBrowserAction[]> {
    return this.observations.listBrowserActions(runId);
  }

  public recordObservation(record: PersistedObservation): Promise<void> {
    return this.observations.recordObservation(record);
  }

  public listObservations(runId: RunId): Promise<readonly PersistedObservation[]> {
    return this.observations.listObservations(runId);
  }

  public createResourceLease(record: ResourceLease): Promise<void> {
    return this.observations.createResourceLease(record);
  }

  public releaseResourceLease(leaseId: string, releasedAt: string): Promise<void> {
    return this.observations.releaseResourceLease(leaseId, releasedAt);
  }

  public listActiveResourceLeases(
    runId: RunId,
  ): Promise<readonly PersistedResourceLease[]> {
    return this.observations.listActiveResourceLeases(runId);
  }

  public claimExpiredResourceLeases(
    options: MaintenanceClaimOptions,
  ): Promise<readonly PersistedResourceLease[]> {
    return this.observations.claimExpiredResourceLeases(options);
  }

  public recordResourceLeaseCleanupFailure(
    leaseId: string,
    attemptedAt: string,
    errorFingerprint: string,
  ): Promise<void> {
    return this.observations.recordResourceLeaseCleanupFailure(
      leaseId,
      attemptedAt,
      errorFingerprint,
    );
  }

  public async buildAssertionSnapshot(runId: RunId): Promise<AssertionSnapshot> {
    const [providerCalls, browserActions, observations, steps, artifacts] =
      await Promise.all([
        this.listProviderCalls(runId),
        this.listBrowserActions(runId),
        this.listObservations(runId),
        this.listSteps(runId),
        this.listArtifacts(runId),
      ]);
    return { runId, providerCalls, browserActions, observations, steps, artifacts };
  }

  public async buildReport(runId: RunId): Promise<ScenarioRunReport | undefined> {
    const run = await this.getRun(runId);
    if (!run) return undefined;
    const [
      steps,
      timeline,
      artifacts,
      assertions,
      providerCalls,
      browserActions,
      observations,
    ] = await Promise.all([
      this.listSteps(runId),
      this.listTimeline(runId),
      this.listArtifacts(runId),
      this.listAssertionResults(runId),
      this.listProviderCalls(runId),
      this.listBrowserActions(runId),
      this.listObservations(runId),
    ]);
    return {
      run,
      steps,
      timeline,
      artifacts,
      assertions,
      providerCalls,
      browserActions,
      observations,
    };
  }
}
