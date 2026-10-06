import type { Pool } from "pg";
import type { RunId } from "@testy/shared-types";

export type DemoSessionStatus =
  | "CREATE"
  | "PROVISIONING"
  | "READY"
  | "ACTIVE"
  | "STOPPING"
  | "STOPPED"
  | "FAILED";

export interface DemoSessionRecord {
  readonly id: string;
  readonly runId: RunId;
  readonly status: DemoSessionStatus;
  readonly customerPackage: string;
  readonly websiteHostname: string;
  readonly credentialMode: "shared" | "generated";
  readonly credentialEmail: string;
  readonly credentialPassword?: string;
  readonly networkIdentityId?: string;
  readonly personIdentityId?: string;
  readonly browserIdentityId?: string;
  readonly resetVersion: number;
  readonly activeGatewayRouteId?: string;
  readonly targetRunId?: string;
  readonly tenantId?: string;
  readonly siteId?: string;
  readonly enrichmentTriggeredAt?: string;
  readonly visitorStartedAt?: string;
  readonly errorMessage?: string;
  readonly startedAt: string;
  readonly expiresAt: string;
  readonly stoppedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DemoSessionRepository {
  create(
    id: string,
    runId: RunId,
    websiteHostname: string,
    customerPackage: string,
    expiresAt: string,
    credentialMode: "shared" | "generated",
    credentialEmail: string,
    credentialPassword: string,
  ): Promise<DemoSessionRecord>;
  get(id: string): Promise<DemoSessionRecord | undefined>;
  getByHostname(hostname: string): Promise<DemoSessionRecord | undefined>;
  listInterrupted(): Promise<readonly DemoSessionRecord[]>;
  update(
    id: string,
    patch: {
      readonly status?: DemoSessionStatus;
      readonly networkIdentityId?: string | null;
      readonly personIdentityId?: string | null;
      readonly browserIdentityId?: string | null;
      readonly resetVersion?: number;
      readonly activeGatewayRouteId?: string | null;
      readonly targetRunId?: string | null;
      readonly tenantId?: string | null;
      readonly siteId?: string | null;
      readonly enrichmentTriggeredAt?: string | null;
      readonly visitorStartedAt?: string | null;
      readonly errorMessage?: string | null;
      readonly stoppedAt?: string | null;
      readonly credentialPassword?: string | null;
    },
  ): Promise<DemoSessionRecord>;
  finishRun(runId: RunId, status: "PASSED" | "FAILED"): Promise<void>;
}

interface DemoSessionRow {
  readonly id: string;
  readonly run_id: string;
  readonly status: DemoSessionStatus;
  readonly customer_package: string;
  readonly website_hostname: string;
  readonly credential_mode: "shared" | "generated";
  readonly credential_email: string;
  readonly credential_password: string | null;
  readonly network_identity_id: string | null;
  readonly person_identity_id: string | null;
  readonly browser_identity_id: string | null;
  readonly reset_version: number;
  readonly active_gateway_route_id: string | null;
  readonly target_run_id: string | null;
  readonly tenant_id: string | null;
  readonly site_id: string | null;
  readonly enrichment_triggered_at: Date | null;
  readonly visitor_started_at: Date | null;
  readonly error_message: string | null;
  readonly started_at: Date;
  readonly expires_at: Date;
  readonly stopped_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export class PostgresDemoSessionRepository implements DemoSessionRepository {
  public constructor(private readonly pool: Pool) {}

  public async create(
    id: string,
    runId: RunId,
    websiteHostname: string,
    customerPackage: string,
    expiresAt: string,
    credentialMode: "shared" | "generated",
    credentialEmail: string,
    credentialPassword: string,
  ): Promise<DemoSessionRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO test_runs (
          id, scenario_id, target, status, resolved_scenario_hash,
          resolved_scenario, metadata, created_at, updated_at, started_at
        ) VALUES (
          $1, 'interactive-demo', 'gl-eye', 'RUNNING',
          repeat('0', 64),
          '{"schemaVersion":"1.0","scenarioId":"interactive-demo","displayName":"Interactive Demo","target":"gl-eye","timeoutMs":86400000,"variables":{},"phases":{"allocate":[],"compile":[],"configure":[],"run":[],"observe":[],"assert":[]},"contentHash":"0000000000000000000000000000000000000000000000000000000000000000"}'::JSONB,
          '{"runKind":"interactive-demo"}'::JSONB, NOW(), NOW(), NOW()
        )`,
        [runId],
      );
      const result = await client.query<DemoSessionRow>(
        `INSERT INTO interactive_demo_sessions (
          id, run_id, status, customer_package, website_hostname, expires_at,
          credential_mode, credential_email, credential_password
        ) VALUES ($1,$2,'CREATE',$3,$4,$5,$6,$7,$8)
        RETURNING *`,
        [
          id,
          runId,
          customerPackage,
          websiteHostname,
          expiresAt,
          credentialMode,
          credentialEmail,
          credentialPassword,
        ],
      );
      await client.query("COMMIT");
      const row = result.rows[0];
      if (!row) throw new Error("Interactive Demo session was not persisted.");
      return mapSession(row);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async get(id: string): Promise<DemoSessionRecord | undefined> {
    const result = await this.pool.query<DemoSessionRow>(
      "SELECT * FROM interactive_demo_sessions WHERE id=$1",
      [id],
    );
    return result.rows[0] ? mapSession(result.rows[0]) : undefined;
  }

  public async getByHostname(
    hostname: string,
  ): Promise<DemoSessionRecord | undefined> {
    const result = await this.pool.query<DemoSessionRow>(
      `SELECT * FROM interactive_demo_sessions
       WHERE website_hostname=$1 AND status IN ('READY','ACTIVE')
       ORDER BY created_at DESC LIMIT 1`,
      [hostname.toLowerCase()],
    );
    return result.rows[0] ? mapSession(result.rows[0]) : undefined;
  }

  public async listInterrupted(): Promise<readonly DemoSessionRecord[]> {
    const result = await this.pool.query<DemoSessionRow>(
      `SELECT * FROM interactive_demo_sessions
       WHERE status IN ('CREATE','PROVISIONING','READY','ACTIVE','STOPPING')
       ORDER BY created_at ASC`,
    );
    return result.rows.map(mapSession);
  }

  public async update(
    id: string,
    patch: {
      readonly status?: DemoSessionStatus;
      readonly networkIdentityId?: string | null;
      readonly personIdentityId?: string | null;
      readonly browserIdentityId?: string | null;
      readonly resetVersion?: number;
      readonly activeGatewayRouteId?: string | null;
      readonly targetRunId?: string | null;
      readonly tenantId?: string | null;
      readonly siteId?: string | null;
      readonly enrichmentTriggeredAt?: string | null;
      readonly visitorStartedAt?: string | null;
      readonly errorMessage?: string | null;
      readonly stoppedAt?: string | null;
      readonly credentialPassword?: string | null;
    },
  ): Promise<DemoSessionRecord> {
    const current = await this.get(id);
    if (!current) throw new Error("Interactive Demo session was not found.");
    const values = {
      status: patch.status ?? current.status,
      networkIdentityId:
        patch.networkIdentityId === undefined
          ? current.networkIdentityId ?? null
          : patch.networkIdentityId,
      personIdentityId:
        patch.personIdentityId === undefined
          ? current.personIdentityId ?? null
          : patch.personIdentityId,
      browserIdentityId:
        patch.browserIdentityId === undefined
          ? current.browserIdentityId ?? null
          : patch.browserIdentityId,
      resetVersion: patch.resetVersion ?? current.resetVersion,
      activeGatewayRouteId:
        patch.activeGatewayRouteId === undefined
          ? current.activeGatewayRouteId ?? null
          : patch.activeGatewayRouteId,
      targetRunId:
        patch.targetRunId === undefined
          ? current.targetRunId ?? null
          : patch.targetRunId,
      tenantId:
        patch.tenantId === undefined
          ? current.tenantId ?? null
          : patch.tenantId,
      siteId:
        patch.siteId === undefined
          ? current.siteId ?? null
          : patch.siteId,
      enrichmentTriggeredAt:
        patch.enrichmentTriggeredAt === undefined
          ? current.enrichmentTriggeredAt ?? null
          : patch.enrichmentTriggeredAt,
      visitorStartedAt:
        patch.visitorStartedAt === undefined
          ? current.visitorStartedAt ?? null
          : patch.visitorStartedAt,
      errorMessage:
        patch.errorMessage === undefined
          ? current.errorMessage ?? null
          : patch.errorMessage,
      stoppedAt:
        patch.stoppedAt === undefined
          ? current.stoppedAt ?? null
          : patch.stoppedAt,
      credentialPassword:
        patch.credentialPassword === undefined
          ? current.credentialPassword ?? null
          : patch.credentialPassword,
    };
    const result = await this.pool.query<DemoSessionRow>(
      `UPDATE interactive_demo_sessions SET
        status=$2,
        network_identity_id=$3,
        person_identity_id=$4,
        browser_identity_id=$5,
        reset_version=$6,
        active_gateway_route_id=$7,
        target_run_id=$8,
        tenant_id=$9,
        site_id=$10,
        enrichment_triggered_at=$11,
        visitor_started_at=$12,
        error_message=$13,
        stopped_at=$14,
        credential_password=$15,
        updated_at=NOW()
       WHERE id=$1
       RETURNING *`,
      [
        id,
        values.status,
        values.networkIdentityId,
        values.personIdentityId,
        values.browserIdentityId,
        values.resetVersion,
        values.activeGatewayRouteId,
        values.targetRunId,
        values.tenantId,
        values.siteId,
        values.enrichmentTriggeredAt,
        values.visitorStartedAt,
        values.errorMessage,
        values.stoppedAt,
        values.credentialPassword,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Interactive Demo session was not found.");
    return mapSession(row);
  }

  public async finishRun(
    runId: RunId,
    status: "PASSED" | "FAILED",
  ): Promise<void> {
    await this.pool.query(
      `UPDATE test_runs SET
        status=$2,
        outcome_status=$2,
        finished_at=NOW(),
        updated_at=NOW()
       WHERE id=$1`,
      [runId, status],
    );
  }
}

function mapSession(row: DemoSessionRow): DemoSessionRecord {
  return {
    id: row.id,
    runId: row.run_id as RunId,
    status: row.status,
    customerPackage: row.customer_package,
    websiteHostname: row.website_hostname,
    credentialMode: row.credential_mode,
    credentialEmail: row.credential_email,
    ...(row.credential_password
      ? { credentialPassword: row.credential_password }
      : {}),
    ...(row.network_identity_id
      ? { networkIdentityId: row.network_identity_id }
      : {}),
    ...(row.person_identity_id ? { personIdentityId: row.person_identity_id } : {}),
    ...(row.browser_identity_id
      ? { browserIdentityId: row.browser_identity_id }
      : {}),
    resetVersion: row.reset_version,
    ...(row.active_gateway_route_id
      ? { activeGatewayRouteId: row.active_gateway_route_id }
      : {}),
    ...(row.target_run_id ? { targetRunId: row.target_run_id } : {}),
    ...(row.tenant_id ? { tenantId: row.tenant_id } : {}),
    ...(row.site_id ? { siteId: row.site_id } : {}),
    ...(row.enrichment_triggered_at
      ? { enrichmentTriggeredAt: row.enrichment_triggered_at.toISOString() }
      : {}),
    ...(row.visitor_started_at
      ? { visitorStartedAt: row.visitor_started_at.toISOString() }
      : {}),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
    startedAt: row.started_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    ...(row.stopped_at ? { stoppedAt: row.stopped_at.toISOString() } : {}),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
