import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RunId } from "@testy/shared-types";
import type {
  PersistedArtifact,
  PersistedResourceLease,
  ScenarioTimelineRecord,
} from "@testy/scenario-engine";
import { describe, expect, it } from "vitest";

import {
  ControlPlaneMaintenance,
  LocalArtifactCleaner,
  verifyMaintenanceToken,
  type RunMaintenanceRepository,
} from "../src/maintenance.js";

const runId = "00000000-0000-4000-8000-000000000301" as RunId;

describe("control plane maintenance", () => {
  it("reaps expired leases and retained artifacts in bounded claims", async () => {
    const root = await mkdtemp(join(tmpdir(), "testy-maintenance-"));
    const artifactPath = join(root, "old-report.json");
    await writeFile(artifactPath, "{}\n");
    const lease: PersistedResourceLease = {
      leaseId: "00000000-0000-4000-8000-000000000302",
      runId,
      resourceType: "vendor-runtime",
      resourceKey: "runtime-1",
      expiresAt: "2026-07-01T00:00:00.000Z",
      status: "ACTIVE",
    };
    const artifact: PersistedArtifact = {
      artifactId: "00000000-0000-4000-8000-000000000303",
      runId,
      kind: "browser-report",
      mediaType: "application/json",
      location: artifactPath,
      sha256: "a".repeat(64),
      metadata: {},
      createdAt: "2026-07-01T00:00:00.000Z",
    };
    const timeline: ScenarioTimelineRecord[] = [];
    let released = false;
    let deletedRecord = false;
    const repository: RunMaintenanceRepository = {
      claimExpiredResourceLeases: async (options) => {
        expect(options.limit).toBe(10);
        return [lease];
      },
      recordResourceLeaseCleanupFailure: async () => undefined,
      releaseResourceLease: async () => {
        released = true;
      },
      claimExpiredArtifacts: async () => [artifact],
      recordArtifactDeletionFailure: async () => undefined,
      deleteArtifactRecord: async () => {
        deletedRecord = true;
      },
      appendTimeline: async (record) => void timeline.push(record),
    };
    let cleaned = false;
    const maintenance = new ControlPlaneMaintenance(
      repository,
      {
        "vendor-runtime": async () => {
          cleaned = true;
        },
      },
      new LocalArtifactCleaner(root),
      {
        intervalMs: 0,
        batchSize: 10,
        claimTtlMs: 60_000,
        artifactRetentionMs: 86_400_000,
        clock: () => new Date("2026-07-17T00:00:00.000Z"),
      },
    );

    const report = await maintenance.run();

    expect(report.leases).toEqual({ claimed: 1, released: 1, failed: 0 });
    expect(report.artifacts).toEqual({ claimed: 1, deleted: 1, failed: 0 });
    expect(cleaned).toBe(true);
    expect(released).toBe(true);
    expect(deletedRecord).toBe(true);
    expect(timeline.map((entry) => entry.name)).toEqual([
      "expired-resource-released",
      "artifact-retained-record-pruned",
    ]);
    await expect(access(artifactPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("records fingerprints and releases claims after cleanup failures", async () => {
    const failures: string[] = [];
    const repository: RunMaintenanceRepository = {
      claimExpiredResourceLeases: async () => [
        {
          leaseId: "00000000-0000-4000-8000-000000000304",
          runId,
          resourceType: "unknown-resource",
          resourceKey: "hidden-key",
          expiresAt: "2026-07-01T00:00:00.000Z",
          status: "ACTIVE",
        },
      ],
      recordResourceLeaseCleanupFailure: async (_id, _at, fingerprint) => {
        failures.push(fingerprint);
      },
      releaseResourceLease: async () => undefined,
      claimExpiredArtifacts: async () => [],
      recordArtifactDeletionFailure: async () => undefined,
      deleteArtifactRecord: async () => undefined,
      appendTimeline: async () => undefined,
    };
    const maintenance = new ControlPlaneMaintenance(
      repository,
      {},
      { delete: async () => undefined },
      {
        intervalMs: 0,
        batchSize: 10,
        claimTtlMs: 60_000,
        artifactRetentionMs: 86_400_000,
      },
    );

    const report = await maintenance.run();

    expect(report.leases.failed).toBe(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/^[a-f0-9]{64}$/u);
    expect(failures[0]).not.toContain("unknown-resource");
  });

  it("coalesces overlapping maintenance triggers", async () => {
    let releaseClaim: (() => void) | undefined;
    const claimed = new Promise<readonly PersistedResourceLease[]>((resolve) => {
      releaseClaim = () => resolve([]);
    });
    const repository: RunMaintenanceRepository = {
      claimExpiredResourceLeases: async () => claimed,
      recordResourceLeaseCleanupFailure: async () => undefined,
      releaseResourceLease: async () => undefined,
      claimExpiredArtifacts: async () => [],
      recordArtifactDeletionFailure: async () => undefined,
      deleteArtifactRecord: async () => undefined,
      appendTimeline: async () => undefined,
    };
    const maintenance = new ControlPlaneMaintenance(
      repository,
      {},
      { delete: async () => undefined },
      {
        intervalMs: 0,
        batchSize: 10,
        claimTtlMs: 60_000,
        artifactRetentionMs: 86_400_000,
      },
    );

    const first = maintenance.run();
    const second = maintenance.run();
    expect(second).toBe(first);
    releaseClaim?.();
    await first;
    expect(maintenance.status().running).toBe(false);
  });

  it("confines file deletion and protects manual triggers", async () => {
    const root = await mkdtemp(join(tmpdir(), "testy-maintenance-root-"));
    const outside = join(tmpdir(), "testy-maintenance-outside.json");
    await writeFile(outside, "{}\n");
    const cleaner = new LocalArtifactCleaner(root);
    await expect(
      cleaner.delete({
        artifactId: "00000000-0000-4000-8000-000000000305",
        runId,
        kind: "browser-report",
        mediaType: "application/json",
        location: outside,
        sha256: "b".repeat(64),
        metadata: {},
        createdAt: "2026-07-01T00:00:00.000Z",
      }),
    ).rejects.toThrow(/outside/u);
    expect(
      verifyMaintenanceToken(
        "1234567890abcdef",
        "Bearer 1234567890abcdef",
      ),
    ).toBe(true);
    expect(verifyMaintenanceToken("1234567890abcdef", "Bearer wrong")).toBe(
      false,
    );
    expect(verifyMaintenanceToken(undefined, undefined)).toBe(false);
  });
});
