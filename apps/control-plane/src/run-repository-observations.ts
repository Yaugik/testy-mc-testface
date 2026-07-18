import type { Pool } from "pg";
import type { ResourceLease, RunId } from "@testy/shared-types";
import type {
  PersistedBrowserAction,
  PersistedObservation,
  PersistedResourceLease,
  ScenarioValue,
} from "@testy/scenario-engine";

interface BrowserActionRow {
  readonly run_id: string;
  readonly journey_id: string;
  readonly step_id: string;
  readonly action: string;
  readonly status: PersistedBrowserAction["status"];
  readonly duration_ms: number | null;
  readonly page_fingerprint: string | null;
  readonly metadata: Readonly<Record<string, ScenarioValue>>;
  readonly started_at: Date;
  readonly completed_at: Date | null;
}
interface ObservationRow {
  readonly observation_id: string;
  readonly run_id: string;
  readonly observation_type: string;
  readonly status: string;
  readonly value: ScenarioValue | null;
  readonly metadata: Readonly<Record<string, ScenarioValue>>;
  readonly observed_at: Date;
}
interface LeaseRow {
  readonly id: string;
  readonly run_id: string;
  readonly resource_type: string;
  readonly resource_key: string;
  readonly status: "ACTIVE" | "RELEASED";
  readonly expires_at: Date;
  readonly released_at: Date | null;
}

export class PostgresRunObservationStore {
  public constructor(private readonly pool: Pool) {}
  public async recordBrowserAction(
    record: PersistedBrowserAction,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO browser_actions (
        run_id, journey_id, step_id, action, status, duration_ms,
        page_fingerprint, metadata, started_at, completed_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8::JSONB, $9, $10
      )`,
      [
        record.runId,
        record.journeyId,
        record.stepId,
        record.action,
        record.status,
        record.durationMs ?? null,
        record.pageFingerprint ?? null,
        JSON.stringify(record.metadata),
        record.startedAt,
        record.completedAt ?? null,
      ],
    );
  }

  public async listBrowserActions(
    runId: RunId,
  ): Promise<readonly PersistedBrowserAction[]> {
    const result = await this.pool.query<BrowserActionRow>(
      `SELECT run_id, journey_id, step_id, action, status, duration_ms,
              page_fingerprint, metadata, started_at, completed_at
       FROM browser_actions
       WHERE run_id = $1
       ORDER BY started_at ASC, id ASC`,
      [runId],
    );
    return result.rows.map((row) => ({
      runId: row.run_id as RunId,
      journeyId: row.journey_id,
      stepId: row.step_id,
      action: row.action,
      status: row.status,
      ...(row.duration_ms === null ? {} : { durationMs: row.duration_ms }),
      ...(row.page_fingerprint
        ? { pageFingerprint: row.page_fingerprint.trim() }
        : {}),
      metadata: row.metadata,
      startedAt: row.started_at.toISOString(),
      ...(row.completed_at
        ? { completedAt: row.completed_at.toISOString() }
        : {}),
    }));
  }

  public async recordObservation(record: PersistedObservation): Promise<void> {
    await this.pool.query(
      `INSERT INTO observations (
        observation_id, run_id, observation_type, status, value, metadata, observed_at
      ) VALUES ($1, $2, $3, $4, $5::JSONB, $6::JSONB, $7)
      ON CONFLICT (run_id, observation_id) DO UPDATE SET
        observation_type = EXCLUDED.observation_type,
        status = EXCLUDED.status,
        value = EXCLUDED.value,
        metadata = EXCLUDED.metadata,
        observed_at = EXCLUDED.observed_at`,
      [
        record.observationId,
        record.runId,
        record.observationType,
        record.status,
        record.value === undefined ? null : JSON.stringify(record.value),
        JSON.stringify(record.metadata),
        record.observedAt,
      ],
    );
  }

  public async listObservations(
    runId: RunId,
  ): Promise<readonly PersistedObservation[]> {
    const result = await this.pool.query<ObservationRow>(
      `SELECT observation_id, run_id, observation_type, status, value, metadata, observed_at
       FROM observations
       WHERE run_id = $1
       ORDER BY observed_at ASC, id ASC`,
      [runId],
    );
    return result.rows.map((row) => ({
      observationId: row.observation_id,
      runId: row.run_id as RunId,
      observationType: row.observation_type,
      status: row.status,
      ...(row.value === null ? {} : { value: row.value }),
      metadata: row.metadata,
      observedAt: row.observed_at.toISOString(),
    }));
  }

  public async createResourceLease(lease: ResourceLease): Promise<void> {
    await this.pool.query(
      `INSERT INTO resource_leases (
        id, run_id, resource_type, resource_key, status, expires_at
      ) VALUES ($1, $2, $3, $4, 'ACTIVE', $5)`,
      [
        lease.leaseId,
        lease.runId,
        lease.resourceType,
        lease.resourceKey,
        lease.expiresAt,
      ],
    );
  }

  public async releaseResourceLease(
    leaseId: string,
    releasedAt: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE resource_leases
       SET status = 'RELEASED', released_at = COALESCE(released_at, $2)
       WHERE id = $1 AND status = 'ACTIVE'`,
      [leaseId, releasedAt],
    );
  }

  public async listActiveResourceLeases(
    runId: RunId,
  ): Promise<readonly PersistedResourceLease[]> {
    const result = await this.pool.query<LeaseRow>(
      `SELECT id, run_id, resource_type, resource_key, status, expires_at, released_at
       FROM resource_leases
       WHERE run_id = $1 AND status = 'ACTIVE'
       ORDER BY expires_at ASC, id ASC`,
      [runId],
    );
    return result.rows.map((row) => ({
      leaseId: row.id,
      runId: row.run_id as RunId,
      resourceType: row.resource_type,
      resourceKey: row.resource_key,
      expiresAt: row.expires_at.toISOString(),
      status: row.status,
      ...(row.released_at ? { releasedAt: row.released_at.toISOString() } : {}),
    }));
  }
}
