import type {
  AssertionResult,
  AssertionSnapshot,
} from "@testy/assertion-engine";
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
} from "./types.js";

export class MemoryScenarioRunRepository implements ScenarioRunRepository {
  private readonly runs = new Map<RunId, PersistedRun>();
  private readonly steps = new Map<RunId, ScenarioStepRecord[]>();
  private readonly timeline = new Map<RunId, ScenarioTimelineRecord[]>();
  private readonly artifacts = new Map<RunId, PersistedArtifact[]>();
  private readonly assertions = new Map<RunId, AssertionResult[]>();
  private readonly providerCalls = new Map<RunId, PersistedProviderCall[]>();
  private readonly browserActions = new Map<RunId, PersistedBrowserAction[]>();
  private readonly observations = new Map<RunId, PersistedObservation[]>();
  private readonly leases = new Map<string, PersistedResourceLease>();

  public async createRun(run: PersistedRun): Promise<void> {
    if (this.runs.has(run.id)) throw new Error(`Run '${run.id}' already exists.`);
    this.runs.set(run.id, clone(run));
  }

  public async updateRunStatus(
    runId: RunId,
    status: RunStatus,
    options: {
      readonly outcomeStatus?: "PASSED" | "FAILED" | "CANCELLED";
      readonly startedAt?: string;
      readonly finishedAt?: string;
      readonly metadata?: Readonly<Record<string, ScenarioValue>>;
    } = {},
  ): Promise<void> {
    const existing = this.requireRun(runId);
    this.runs.set(runId, {
      ...existing,
      status,
      updatedAt: new Date().toISOString(),
      ...(options.outcomeStatus ? { outcomeStatus: options.outcomeStatus } : {}),
      ...(options.startedAt ? { startedAt: options.startedAt } : {}),
      ...(options.finishedAt ? { finishedAt: options.finishedAt } : {}),
      ...(options.metadata
        ? { metadata: { ...existing.metadata, ...options.metadata } }
        : {}),
    });
  }

  public async requestCancellation(runId: RunId, requestedAt: string): Promise<boolean> {
    const existing = this.runs.get(runId);
    if (!existing || isTerminal(existing.status) || existing.status === "CLEANUP") return false;
    this.runs.set(runId, { ...existing, cancelRequestedAt: requestedAt, updatedAt: requestedAt });
    return true;
  }

  public async getRun(runId: RunId): Promise<PersistedRun | undefined> {
    const run = this.runs.get(runId);
    return run ? clone(run) : undefined;
  }

  public async listActiveRuns(): Promise<readonly PersistedRun[]> {
    return [...this.runs.values()].filter((run) => !isTerminal(run.status)).map(clone);
  }

  public async recordStep(record: ScenarioStepRecord): Promise<void> {
    upsert(
      this.steps,
      record.runId,
      record,
      (candidate) =>
        candidate.stepId === record.stepId && candidate.attempt === record.attempt,
    );
  }

  public async appendTimeline(record: ScenarioTimelineRecord): Promise<void> {
    append(this.timeline, record.runId, record);
  }

  public async listTimeline(runId: RunId): Promise<readonly ScenarioTimelineRecord[]> {
    return list(this.timeline, runId);
  }

  public async listSteps(runId: RunId): Promise<readonly ScenarioStepRecord[]> {
    return list(this.steps, runId);
  }

  public async addArtifact(artifact: PersistedArtifact): Promise<void> {
    append(this.artifacts, artifact.runId, artifact);
  }

  public async listArtifacts(runId: RunId): Promise<readonly PersistedArtifact[]> {
    return list(this.artifacts, runId);
  }

  public async recordAssertionResult(result: AssertionResult): Promise<void> {
    upsert(
      this.assertions,
      result.runId,
      result,
      (candidate) => candidate.assertionId === result.assertionId,
    );
  }

  public async listAssertionResults(runId: RunId): Promise<readonly AssertionResult[]> {
    return list(this.assertions, runId);
  }

  public async recordProviderCall(record: PersistedProviderCall): Promise<void> {
    append(this.providerCalls, record.runId, record);
  }

  public async listProviderCalls(runId: RunId): Promise<readonly PersistedProviderCall[]> {
    return list(this.providerCalls, runId);
  }

  public async recordBrowserAction(record: PersistedBrowserAction): Promise<void> {
    append(this.browserActions, record.runId, record);
  }

  public async listBrowserActions(runId: RunId): Promise<readonly PersistedBrowserAction[]> {
    return list(this.browserActions, runId);
  }

  public async recordObservation(record: PersistedObservation): Promise<void> {
    upsert(
      this.observations,
      record.runId,
      record,
      (candidate) => candidate.observationId === record.observationId,
    );
  }

  public async listObservations(runId: RunId): Promise<readonly PersistedObservation[]> {
    return list(this.observations, runId);
  }

  public async createResourceLease(lease: ResourceLease): Promise<void> {
    if (this.leases.has(lease.leaseId)) {
      throw new Error(`Resource lease '${lease.leaseId}' already exists.`);
    }
    this.leases.set(lease.leaseId, { ...clone(lease), status: "ACTIVE" });
  }

  public async releaseResourceLease(leaseId: string, releasedAt: string): Promise<void> {
    const lease = this.leases.get(leaseId);
    if (!lease || lease.status === "RELEASED") return;
    this.leases.set(leaseId, {
      ...lease,
      status: "RELEASED",
      releasedAt,
    });
  }

  public async listActiveResourceLeases(
    runId: RunId,
  ): Promise<readonly PersistedResourceLease[]> {
    return [...this.leases.values()]
      .filter((lease) => lease.runId === runId && lease.status === "ACTIVE")
      .map(clone);
  }

  public async buildAssertionSnapshot(runId: RunId): Promise<AssertionSnapshot> {
    return {
      runId,
      providerCalls: await this.listProviderCalls(runId),
      browserActions: await this.listBrowserActions(runId),
      observations: await this.listObservations(runId),
      steps: await this.listSteps(runId),
      artifacts: await this.listArtifacts(runId),
    };
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

  private requireRun(runId: RunId): PersistedRun {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Run '${runId}' was not found.`);
    return run;
  }
}

function isTerminal(status: RunStatus): boolean {
  return status === "PASSED" || status === "FAILED" || status === "CANCELLED";
}

function append<Value>(
  collection: Map<RunId, Value[]>,
  runId: RunId,
  value: Value,
): void {
  const records = collection.get(runId) ?? [];
  records.push(clone(value));
  collection.set(runId, records);
}

function upsert<Value>(
  collection: Map<RunId, Value[]>,
  runId: RunId,
  value: Value,
  matches: (candidate: Value) => boolean,
): void {
  const records = collection.get(runId) ?? [];
  const index = records.findIndex(matches);
  if (index >= 0) records[index] = clone(value);
  else records.push(clone(value));
  collection.set(runId, records);
}

function list<Value>(
  collection: ReadonlyMap<RunId, readonly Value[]>,
  runId: RunId,
): readonly Value[] {
  return (collection.get(runId) ?? []).map(clone);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
