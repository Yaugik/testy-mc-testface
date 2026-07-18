import type { ResourceLease, RunId, RunStatus } from "@testy/shared-types";

import type {
  PersistedArtifact,
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
    const records = this.steps.get(record.runId) ?? [];
    const index = records.findIndex(
      (candidate) =>
        candidate.stepId === record.stepId && candidate.attempt === record.attempt,
    );
    if (index >= 0) records[index] = clone(record);
    else records.push(clone(record));
    this.steps.set(record.runId, records);
  }

  public async appendTimeline(record: ScenarioTimelineRecord): Promise<void> {
    const records = this.timeline.get(record.runId) ?? [];
    records.push(clone(record));
    this.timeline.set(record.runId, records);
  }

  public async listTimeline(runId: RunId): Promise<readonly ScenarioTimelineRecord[]> {
    return (this.timeline.get(runId) ?? []).map(clone);
  }

  public async listSteps(runId: RunId): Promise<readonly ScenarioStepRecord[]> {
    return (this.steps.get(runId) ?? []).map(clone);
  }

  public async listArtifacts(runId: RunId): Promise<readonly PersistedArtifact[]> {
    return (this.artifacts.get(runId) ?? []).map(clone);
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

  public async buildReport(runId: RunId): Promise<ScenarioRunReport | undefined> {
    const run = await this.getRun(runId);
    if (!run) return undefined;
    return {
      run,
      steps: await this.listSteps(runId),
      timeline: await this.listTimeline(runId),
      artifacts: await this.listArtifacts(runId),
    };
  }

  public async addArtifact(artifact: PersistedArtifact): Promise<void> {
    const records = this.artifacts.get(artifact.runId) ?? [];
    records.push(clone(artifact));
    this.artifacts.set(artifact.runId, records);
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

function clone<T>(value: T): T {
  return structuredClone(value);
}
