import { randomUUID } from "node:crypto";

import type { ResourceLease, RunId, RunStatus } from "@testy/shared-types";
import {
  createBuiltinScenarioActions,
  executeScenario,
  resolveScenario,
  sanitizeScenarioError,
  validateScenarioConfig,
  type PersistedResourceLease,
  type PersistedRun,
  type ScenarioActionRegistry,
  type ScenarioExecutionObserver,
  type ScenarioRunReport,
  type ScenarioRunRepository,
  type ScenarioStepRecord,
  type ScenarioTimelineRecord,
} from "@testy/scenario-engine";

import { emptyScenarioCatalog, type ScenarioCatalog } from "./scenario-catalog.js";

export interface CreateRunResult {
  readonly run: PersistedRun;
}

export class ScenarioNotFoundError extends Error {
  public constructor(public readonly scenarioId: string) {
    super(`Scenario '${scenarioId}' was not found.`);
    this.name = "ScenarioNotFoundError";
  }
}

export interface RunService {
  validate(value: unknown): Promise<ReturnType<typeof resolveScenario>>;
  listScenarios(): Promise<readonly ReturnType<typeof resolveScenario>[]>;
  getScenario(scenarioId: string): Promise<ReturnType<typeof resolveScenario> | undefined>;
  create(value: unknown): Promise<CreateRunResult>;
  get(runId: RunId): Promise<PersistedRun | undefined>;
  cancel(runId: RunId): Promise<boolean>;
  timeline(runId: RunId): Promise<readonly ScenarioTimelineRecord[]>;
  report(runId: RunId): Promise<ScenarioRunReport | undefined>;
  artifacts(runId: RunId): ReturnType<ScenarioRunRepository["listArtifacts"]>;
  recoverInterruptedRuns(): Promise<void>;
  shutdown(): Promise<void>;
}

export type ResourceLeaseCleaner = (lease: PersistedResourceLease) => Promise<void>;

export class ScenarioRunService implements RunService {
  private readonly controllers = new Map<RunId, AbortController>();
  private readonly executions = new Map<RunId, Promise<void>>();

  public constructor(
    private readonly repository: ScenarioRunRepository,
    private readonly actions: ScenarioActionRegistry = createBuiltinScenarioActions(),
    private readonly resourceCleaners: Readonly<Record<string, ResourceLeaseCleaner>> = {
      synthetic: async () => undefined,
    },
    private readonly catalog: ScenarioCatalog = emptyScenarioCatalog,
  ) {}

  public async validate(value: unknown): Promise<ReturnType<typeof resolveScenario>> {
    const config = await validateScenarioConfig(value);
    return resolveScenario(config);
  }

  public listScenarios(): Promise<readonly ReturnType<typeof resolveScenario>[]> {
    return this.catalog.list();
  }

  public getScenario(
    scenarioId: string,
  ): Promise<ReturnType<typeof resolveScenario> | undefined> {
    return this.catalog.get(scenarioId);
  }

  public async create(value: unknown): Promise<CreateRunResult> {
    const reference = readScenarioReference(value);
    const scenario = reference
      ? await this.catalog.get(reference).then((candidate) => {
          if (!candidate) throw new ScenarioNotFoundError(reference);
          return candidate;
        })
      : await this.validate(value);
    const now = new Date().toISOString();
    const runId = randomUUID() as RunId;
    const run: PersistedRun = {
      id: runId,
      scenarioId: scenario.scenarioId,
      target: scenario.target,
      status: "CREATED",
      resolvedScenarioHash: scenario.contentHash,
      resolvedScenario: scenario,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.createRun(run);
    await this.repository.appendTimeline({
      runId,
      occurredAt: now,
      category: "engine",
      name: "run-created",
      metadata: { scenarioHash: scenario.contentHash },
    });
    this.start(run);
    return { run };
  }

  public get(runId: RunId): Promise<PersistedRun | undefined> {
    return this.repository.getRun(runId);
  }

  public async cancel(runId: RunId): Promise<boolean> {
    const requestedAt = new Date().toISOString();
    const accepted = await this.repository.requestCancellation(runId, requestedAt);
    if (!accepted) return false;
    await this.repository.appendTimeline({
      runId,
      occurredAt: requestedAt,
      category: "engine",
      name: "cancellation-requested",
      metadata: {},
    });
    this.controllers.get(runId)?.abort(new Error("Run cancellation requested."));
    if (!this.controllers.has(runId)) {
      await this.finalizeInterruptedCancellation(runId);
    }
    return true;
  }

  public timeline(runId: RunId): Promise<readonly ScenarioTimelineRecord[]> {
    return this.repository.listTimeline(runId);
  }

  public report(runId: RunId): Promise<ScenarioRunReport | undefined> {
    return this.repository.buildReport(runId);
  }

  public artifacts(runId: RunId): ReturnType<ScenarioRunRepository["listArtifacts"]> {
    return this.repository.listArtifacts(runId);
  }

  public async recoverInterruptedRuns(): Promise<void> {
    const activeRuns = await this.repository.listActiveRuns();
    for (const run of activeRuns) {
      const now = new Date().toISOString();
      const cancelled = run.cancelRequestedAt !== undefined;
      let outcome: "FAILED" | "CANCELLED" = cancelled ? "CANCELLED" : "FAILED";
      const cleanupErrors = await this.cleanupPersistedLeases(run.id);
      if (cleanupErrors.length > 0 && outcome !== "CANCELLED") outcome = "FAILED";
      await this.repository.updateRunStatus(run.id, "CLEANUP", {
        outcomeStatus: outcome,
        metadata: {
          recoveredAfterRestart: true,
          interruptionStatus: run.status,
          cleanupErrorCount: cleanupErrors.length,
        },
      });
      await this.repository.appendTimeline({
        runId: run.id,
        occurredAt: now,
        category: "engine",
        name: "interrupted-run-recovered",
        metadata: { previousStatus: run.status, outcome },
      });
      await this.repository.updateRunStatus(run.id, outcome, {
        outcomeStatus: outcome,
        finishedAt: now,
      });
    }
  }

  public async shutdown(): Promise<void> {
    for (const controller of this.controllers.values()) {
      controller.abort(new Error("Control Plane shutdown."));
    }
    await Promise.allSettled(this.executions.values());
  }

  private start(run: PersistedRun): void {
    const controller = new AbortController();
    this.controllers.set(run.id, controller);
    const execution = this.execute(run, controller)
      .catch(async (error) => {
        const now = new Date().toISOString();
        await this.repository.updateRunStatus(run.id, "FAILED", {
          outcomeStatus: "FAILED",
          finishedAt: now,
          metadata: { serviceError: sanitizeScenarioError(error).message },
        });
      })
      .finally(() => {
        this.controllers.delete(run.id);
        this.executions.delete(run.id);
      });
    this.executions.set(run.id, execution);
  }

  private async execute(run: PersistedRun, controller: AbortController): Promise<void> {
    const startedAt = new Date().toISOString();
    const observer: ScenarioExecutionObserver = {
      onStatus: async (status: RunStatus) => {
        await this.repository.updateRunStatus(run.id, status, {
          ...(status === "VALIDATING" ? { startedAt } : {}),
          ...(status === "PASSED" || status === "FAILED" || status === "CANCELLED"
            ? { outcomeStatus: status }
            : {}),
        });
      },
      onStep: async (record: ScenarioStepRecord) => {
        await this.repository.recordStep(record);
      },
      onTimeline: async (record: ScenarioTimelineRecord) => {
        await this.repository.appendTimeline(record);
      },
      onResourceLease: async (lease: ResourceLease) => {
        await this.repository.createResourceLease(lease);
      },
      onResourceReleased: async (leaseId: string, releasedAt: string) => {
        await this.repository.releaseResourceLease(leaseId, releasedAt);
      },
    };
    const report = await executeScenario(run.resolvedScenario, this.actions, {
      runId: run.id,
      signal: controller.signal,
      observer,
    });
    await this.repository.updateRunStatus(run.id, report.status, {
      outcomeStatus: report.status,
      finishedAt: report.completedAt,
      metadata: {
        outputKeys: report.outputKeys,
        cleanupErrorCount: report.cleanupErrors.length,
        ...(report.error ? { executionError: report.error.message } : {}),
      },
    });
  }

  private async finalizeInterruptedCancellation(runId: RunId): Promise<void> {
    const now = new Date().toISOString();
    const cleanupErrors = await this.cleanupPersistedLeases(runId);
    await this.repository.updateRunStatus(runId, "CANCELLING");
    await this.repository.updateRunStatus(runId, "CANCELLED", {
      outcomeStatus: "CANCELLED",
    });
    await this.repository.updateRunStatus(runId, "CLEANUP", {
      outcomeStatus: "CANCELLED",
    });
    await this.repository.updateRunStatus(runId, "CANCELLED", {
      outcomeStatus: "CANCELLED",
      finishedAt: now,
      metadata: { cleanupErrorCount: cleanupErrors.length },
    });
  }

  private async cleanupPersistedLeases(runId: RunId): Promise<readonly string[]> {
    const errors: string[] = [];
    const leases = await this.repository.listActiveResourceLeases(runId);
    for (const lease of leases) {
      const cleaner = this.resourceCleaners[lease.resourceType];
      if (!cleaner) {
        errors.push(`No resource cleaner is registered for '${lease.resourceType}'.`);
        continue;
      }
      try {
        await cleaner(lease);
        await this.repository.releaseResourceLease(lease.leaseId, new Date().toISOString());
      } catch (error) {
        errors.push(sanitizeScenarioError(error).message);
      }
    }
    return errors;
  }
}

function readScenarioReference(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.length !== 1 || entries[0]?.[0] !== "scenarioId") return undefined;
  const scenarioId = entries[0][1];
  return typeof scenarioId === "string" ? scenarioId : undefined;
}
