import { createHash, timingSafeEqual } from "node:crypto";
import { realpath, unlink } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import {
  sanitizeScenarioError,
  type PersistedArtifact,
  type PersistedResourceLease,
  type ScenarioTimelineRecord,
} from "@testy/scenario-engine";

import type { ResourceLeaseCleaner } from "./run-service.js";

export interface MaintenanceClaimOptions {
  readonly before: string;
  readonly claimUntil: string;
  readonly limit: number;
}

export interface RunMaintenanceRepository {
  claimExpiredResourceLeases(
    options: MaintenanceClaimOptions,
  ): Promise<readonly PersistedResourceLease[]>;
  recordResourceLeaseCleanupFailure(
    leaseId: string,
    attemptedAt: string,
    errorFingerprint: string,
  ): Promise<void>;
  releaseResourceLease(leaseId: string, releasedAt: string): Promise<void>;
  claimExpiredArtifacts(
    options: MaintenanceClaimOptions,
  ): Promise<readonly PersistedArtifact[]>;
  recordArtifactDeletionFailure(
    artifactId: string,
    attemptedAt: string,
    errorFingerprint: string,
  ): Promise<void>;
  deleteArtifactRecord(artifactId: string): Promise<void>;
  appendTimeline(record: ScenarioTimelineRecord): Promise<void>;
}

export interface ArtifactCleaner {
  delete(artifact: PersistedArtifact): Promise<void>;
}

export interface MaintenanceOptions {
  readonly intervalMs: number;
  readonly batchSize: number;
  readonly claimTtlMs: number;
  readonly artifactRetentionMs: number;
  readonly clock?: () => Date;
}

export interface MaintenanceCycleReport {
  readonly startedAt: string;
  readonly completedAt: string;
  readonly leases: {
    readonly claimed: number;
    readonly released: number;
    readonly failed: number;
  };
  readonly artifacts: {
    readonly claimed: number;
    readonly deleted: number;
    readonly failed: number;
  };
}

export interface MaintenanceStatus {
  readonly running: boolean;
  readonly scheduled: boolean;
  readonly lastReport?: MaintenanceCycleReport;
  readonly lastFailureFingerprint?: string;
}

export interface MaintenanceService {
  run(): Promise<MaintenanceCycleReport>;
  start(onError?: (error: unknown) => void): void;
  stop(): Promise<void>;
  status(): MaintenanceStatus;
}

export class ControlPlaneMaintenance implements MaintenanceService {
  private active: Promise<MaintenanceCycleReport> | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastReport: MaintenanceCycleReport | undefined;
  private lastFailureFingerprint: string | undefined;

  public constructor(
    private readonly repository: RunMaintenanceRepository,
    private readonly resourceCleaners: Readonly<Record<string, ResourceLeaseCleaner>>,
    private readonly artifactCleaner: ArtifactCleaner,
    private readonly options: MaintenanceOptions,
  ) {}

  public run(): Promise<MaintenanceCycleReport> {
    if (this.active) return this.active;
    const execution = this.execute()
      .then((report) => {
        this.lastReport = report;
        this.lastFailureFingerprint = undefined;
        return report;
      })
      .catch((error: unknown) => {
        this.lastFailureFingerprint = fingerprintError(error);
        throw error;
      })
      .finally(() => {
        if (this.active === execution) this.active = undefined;
      });
    this.active = execution;
    return execution;
  }

  public start(onError?: (error: unknown) => void): void {
    if (this.timer || this.options.intervalMs === 0) return;
    this.timer = setInterval(() => {
      void this.run().catch((error: unknown) => onError?.(error));
    }, this.options.intervalMs);
    this.timer.unref();
  }

  public async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.active) await this.active.catch(() => undefined);
  }

  public status(): MaintenanceStatus {
    return {
      running: this.active !== undefined,
      scheduled: this.timer !== undefined,
      ...(this.lastReport ? { lastReport: this.lastReport } : {}),
      ...(this.lastFailureFingerprint
        ? { lastFailureFingerprint: this.lastFailureFingerprint }
        : {}),
    };
  }

  private async execute(): Promise<MaintenanceCycleReport> {
    const started = this.now();
    const claimUntil = new Date(
      started.getTime() + this.options.claimTtlMs,
    ).toISOString();
    const leases = await this.repository.claimExpiredResourceLeases({
      before: started.toISOString(),
      claimUntil,
      limit: this.options.batchSize,
    });
    let releasedLeases = 0;
    let failedLeases = 0;
    for (const lease of leases) {
      const cleaner = this.resourceCleaners[lease.resourceType];
      if (!cleaner) {
        failedLeases += 1;
        await this.recordLeaseFailure(
          lease,
          started,
          new Error(
            `No cleaner is registered for resource type '${lease.resourceType}'.`,
          ),
        );
        continue;
      }
      try {
        await cleaner(lease);
        const releasedAt = this.now().toISOString();
        await this.repository.releaseResourceLease(lease.leaseId, releasedAt);
        await this.repository.appendTimeline({
          runId: lease.runId,
          occurredAt: releasedAt,
          category: "engine",
          name: "expired-resource-released",
          metadata: { resourceType: lease.resourceType },
        });
        releasedLeases += 1;
      } catch (error) {
        failedLeases += 1;
        await this.recordLeaseFailure(lease, started, error);
      }
    }

    const artifactCutoff = new Date(
      started.getTime() - this.options.artifactRetentionMs,
    ).toISOString();
    const artifacts = await this.repository.claimExpiredArtifacts({
      before: artifactCutoff,
      claimUntil,
      limit: this.options.batchSize,
    });
    let deletedArtifacts = 0;
    let failedArtifacts = 0;
    for (const artifact of artifacts) {
      try {
        await this.artifactCleaner.delete(artifact);
        await this.repository.deleteArtifactRecord(artifact.artifactId);
        await this.repository.appendTimeline({
          runId: artifact.runId,
          occurredAt: this.now().toISOString(),
          category: "engine",
          name: "artifact-retained-record-pruned",
          metadata: { kind: artifact.kind },
        });
        deletedArtifacts += 1;
      } catch (error) {
        failedArtifacts += 1;
        const attemptedAt = this.now().toISOString();
        const errorFingerprint = fingerprintError(error);
        await this.repository.recordArtifactDeletionFailure(
          artifact.artifactId,
          attemptedAt,
          errorFingerprint,
        );
        await this.repository.appendTimeline({
          runId: artifact.runId,
          occurredAt: attemptedAt,
          category: "engine",
          name: "artifact-retention-failed",
          metadata: { kind: artifact.kind, errorFingerprint },
        });
      }
    }

    return {
      startedAt: started.toISOString(),
      completedAt: this.now().toISOString(),
      leases: {
        claimed: leases.length,
        released: releasedLeases,
        failed: failedLeases,
      },
      artifacts: {
        claimed: artifacts.length,
        deleted: deletedArtifacts,
        failed: failedArtifacts,
      },
    };
  }

  private async recordLeaseFailure(
    lease: PersistedResourceLease,
    started: Date,
    error: unknown,
  ): Promise<void> {
    const attemptedAt = this.now().toISOString();
    const errorFingerprint = fingerprintError(error);
    await this.repository.recordResourceLeaseCleanupFailure(
      lease.leaseId,
      attemptedAt,
      errorFingerprint,
    );
    await this.repository.appendTimeline({
      runId: lease.runId,
      occurredAt: attemptedAt,
      category: "engine",
      name: "expired-resource-cleanup-failed",
      metadata: {
        resourceType: lease.resourceType,
        expiredBefore: started.toISOString(),
        errorFingerprint,
      },
    });
  }

  private now(): Date {
    return new Date((this.options.clock ?? (() => new Date()))().getTime());
  }
}

export class LocalArtifactCleaner implements ArtifactCleaner {
  private readonly root: string;

  public constructor(rootDirectory: string) {
    this.root = resolve(rootDirectory);
  }

  public async delete(artifact: PersistedArtifact): Promise<void> {
    const target = resolve(artifact.location);
    const relativePath = relative(this.root, target);
    if (
      relativePath === "" ||
      relativePath === ".." ||
      relativePath.startsWith(`..${sep}`) ||
      isAbsolute(relativePath)
    ) {
      throw new Error(
        "Artifact location is outside the configured generated-runs root.",
      );
    }
    const canonicalRoot = await realpath(this.root).catch((error: unknown) => {
      if (isFileNotFound(error)) return this.root;
      throw error;
    });
    const canonicalTarget = await realpath(target).catch((error: unknown) => {
      if (isFileNotFound(error)) return undefined;
      throw error;
    });
    if (!canonicalTarget) return;
    const canonicalRelative = relative(canonicalRoot, canonicalTarget);
    if (
      canonicalRelative === "" ||
      canonicalRelative === ".." ||
      canonicalRelative.startsWith(`..${sep}`) ||
      isAbsolute(canonicalRelative)
    ) {
      throw new Error(
        "Artifact canonical location is outside the configured generated-runs root.",
      );
    }
    try {
      await unlink(target);
    } catch (error) {
      if (isFileNotFound(error)) return;
      throw error;
    }
  }
}

export function verifyMaintenanceToken(
  expected: string | undefined,
  authorization: string | undefined,
): boolean {
  if (!expected) return false;
  const supplied = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return (
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  );
}

function fingerprintError(error: unknown): string {
  return createHash("sha256")
    .update(sanitizeScenarioError(error).message)
    .digest("hex");
}

function isFileNotFound(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { readonly code?: unknown }).code === "ENOENT",
  );
}
