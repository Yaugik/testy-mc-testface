import { resolve } from "node:path";

import type { ResourceLease, RunId } from "@testy/shared-types";
import type {
  ScenarioActionRegistry,
  ScenarioRunRepository,
  ScenarioValue,
} from "@testy/scenario-engine";
import { describe, expect, it } from "vitest";

import type { ControlPlaneConfig } from "../src/config.js";
import type {
  DemoSessionRecord,
  DemoSessionRepository,
} from "../src/demo-repository.js";
import { InteractiveDemoService } from "../src/demo-service.js";

describe("interactive demo service", () => {
  it("provisions, switches visitor, resets browser, refreshes outcome, and stops", async () => {
    const sessionStore = new Map<string, DemoSessionRecord>();
    const finishedRuns: string[] = [];
    const sessions = {
      async create(
        id: string,
        runId: RunId,
        websiteHostname: string,
        customerPackage: string,
        expiresAt: string,
        credentialMode: "shared" | "generated",
        credentialEmail: string,
        credentialPassword: string,
      ) {
        const now = new Date().toISOString();
        const session: DemoSessionRecord = {
          id,
          runId,
          status: "CREATE",
          customerPackage,
          websiteHostname,
          credentialMode,
          credentialEmail,
          credentialPassword,
          resetVersion: 0,
          startedAt: now,
          expiresAt,
          createdAt: now,
          updatedAt: now,
        };
        sessionStore.set(id, session);
        return session;
      },
      async get(id: string) {
        return sessionStore.get(id);
      },
      async getByHostname(hostname: string) {
        return [...sessionStore.values()].find(
          (session) =>
            session.websiteHostname === hostname &&
            (session.status === "READY" || session.status === "ACTIVE"),
        );
      },
      async listInterrupted() {
        return [...sessionStore.values()].filter((session) =>
          ["CREATE", "PROVISIONING", "READY", "ACTIVE", "STOPPING"].includes(
            session.status,
          ),
        );
      },
      async update(id: string, patch: Record<string, unknown>) {
        const current = sessionStore.get(id);
        if (!current) throw new Error("missing test session");
        const next = mergeSession(current, patch);
        sessionStore.set(id, next);
        return next;
      },
      async finishRun(_runId: RunId, status: "PASSED" | "FAILED") {
        finishedRuns.push(status);
      },
    } as unknown as DemoSessionRepository;

    const timeline: unknown[] = [];
    const resourceLeases = new Map<
      string,
      ResourceLease & { status: "ACTIVE" | "RELEASED"; releasedAt?: string }
    >();
    const evidence = {
      async appendTimeline(record: unknown) {
        timeline.push(record);
      },
      async createResourceLease(lease: ResourceLease) {
        const duplicate = [...resourceLeases.values()].some(
          (candidate) =>
            candidate.status === "ACTIVE" &&
            candidate.resourceType === lease.resourceType &&
            candidate.resourceKey === lease.resourceKey,
        );
        if (duplicate) {
          throw new Error(
            'duplicate key value violates unique constraint "resource_leases_active_key_idx"',
          );
        }
        resourceLeases.set(lease.leaseId, { ...lease, status: "ACTIVE" });
      },
      async listActiveResourceLeases(runId: RunId) {
        return [...resourceLeases.values()].filter(
          (lease) => lease.runId === runId && lease.status === "ACTIVE",
        );
      },
      async releaseResourceLease(leaseId: string, releasedAt: string) {
        const lease = resourceLeases.get(leaseId);
        if (!lease || lease.status !== "ACTIVE") return;
        resourceLeases.set(leaseId, {
          ...lease,
          status: "RELEASED",
          releasedAt,
        });
      },
      async listTimeline() {
        return [];
      },
      async listProviderCalls() {
        return [];
      },
      async listObservations() {
        return [];
      },
    } as unknown as ScenarioRunRepository;

    const configuredVendorEndpoints: Array<Record<string, string>> = [];
    const manualResetVersions: number[] = [];
    let route = 0;
    let enrichmentTriggers = 0;
    let targetCleanupCalls = 0;
    const preparedInputs: ScenarioValue[] = [];
    const actions: ScenarioActionRegistry = {
      "vendor.compile": async (input) => ({
        vendorId: readInputString(input, "package"),
      }),
      "vendor.start-runtime": async (input) => {
        const vendorId = readInputString(input, "vendorId");
        return {
          vendorId,
          providerBaseUrl: `http://${vendorId}.test/${vendorId}`,
        };
      },
      "target.prepare-run": async (input, context) => {
        if (input !== undefined) preparedInputs.push(input);
        await context.registerResourceLease(
          "target-run",
          "target-run-1",
          new Date(Date.now() + 60_000).toISOString(),
          async () => undefined,
        );
        return {
          targetRunId: "target-run-1",
          tenantId: "tenant-1",
          siteId: "site-1",
          trackingScriptUrl: "http://gl-eye.test/sdk/track.v1.min.js",
          targetOrigin: "http://gl-eye.test",
        };
      },
      "gateway.create-route": async () => ({
        routeId: `route-${++route}`,
      }),
      "gateway.replace-route": async () => ({
        routeId: `route-${++route}`,
      }),
      "browser.load-package": async () => ({
        customerId: "customer-alpha",
      }),
      "site.start": async () => ({
        hostname: "demo.localhost",
        localOrigin: "http://127.0.0.1:43123",
      }),
      "target.configure-vendors": async (input) => {
        const record = asRecord(input);
        configuredVendorEndpoints.push(
          record.endpoints as Record<string, string>,
        );
        return { configured: true };
      },
      "target.configure-site": async () => ({ configured: true }),
      "target.start-observation": async () => ({
        observationId: "observation-1",
      }),
      "site.configure-manual-tracking": async (input) => {
        manualResetVersions.push(readInputNumber(input, "resetVersion"));
        return { configured: true };
      },
      "target.collect-outcome": async () => ({
        companyCount: 1,
        enrichedCompanyCount: enrichmentTriggers > 0 ? 1 : 0,
        contactCount: enrichmentTriggers > 0 ? 1 : 0,
        scoreCount: 1,
        companies: [
          {
            domain: "nordlicht-example.test",
            displayName: "Nordlicht Example GmbH",
            score: 42,
            confidence: "high",
            visibility: "visible",
          },
        ],
        providerProvenance: ["ipinfo", "apollo", "hunter"],
        tenantId: "tenant-1",
        targetRunId: "target-run-1",
        visibleTenantIds: ["tenant-1"],
      }),
      "target.trigger-enrichment": async () => {
        enrichmentTriggers += 1;
        return { triggered: true };
      },
      "vendor.collect-ledger": async () => ({ totalCalls: 0 }),
      "gateway.collect-ledger": async () => ({ entries: [] }),
      "browser.collect-site-events": async () => ({ events: [] }),
      "target.cleanup-run": async () => {
        targetCleanupCalls += 1;
        return { cleaned: true };
      },
    };

    const service = new InteractiveDemoService(
      testConfig(),
      sessions,
      evidence,
      actions,
      {},
    );

    const created = await service.create();
    expect(created.status).toBe("READY");
    expect(created.credentialMode).toBe("shared");
    expect(created.credentialEmail).toBe("admin@example.com");
    expect(created.credentialPassword).toBe("Demo-Access9!");
    expect(asRecord(preparedInputs[0]).demoSessionId).toBe(created.id);
    expect(asRecord(asRecord(preparedInputs[0]).demoCredential).email).toBe(
      "admin@example.com",
    );
    expect(created.networkIdentityId).toBe("nordlicht-corporate");
    expect(created.personIdentityId).toBe("alex-sales");
    expect(service.websiteUrl(created)).toMatch(
      /^http:\/\/demo-[a-f0-9]+\.localhost:23000\/$/u,
    );

    const maya = await service.applyVisitor(created.id, {
      networkId: "nordlicht-corporate",
      personId: "maya-schmidt",
      browserId: "returning",
    });
    expect(maya.status).toBe("ACTIVE");
    expect(maya.personIdentityId).toBe("maya-schmidt");
    expect(maya.resetVersion).toBe(0);
    expect(
      configuredVendorEndpoints.at(-1)?.apollo,
    ).toContain("/profiles/nordlicht-maya");

    const reset = await service.resetVisitor(created.id);
    expect(reset.resetVersion).toBe(1);
    expect(manualResetVersions.at(-1)).toBe(1);

    const outcome = asRecord(await service.outcome(created.id));
    expect(outcome.companyCount).toBe(1);
    expect(outcome.enrichedCompanyCount).toBe(1);
    expect(outcome.contactCount).toBe(1);
    expect(enrichmentTriggers).toBe(1);

    expect(
      await service.localWebsiteOriginForHost(created.websiteHostname),
    ).toBe("http://127.0.0.1:43123");

    await service.shutdown();
    expect(
      await service.localWebsiteOriginForHost(created.websiteHostname),
    ).toBeUndefined();

    const restarted = new InteractiveDemoService(
      testConfig(),
      sessions,
      evidence,
      actions,
      {},
    );
    await restarted.recoverInterruptedSessions();

    const recovered = await sessions.get(created.id);
    expect(recovered?.status).toBe("ACTIVE");
    expect(
      await restarted.localWebsiteOriginForHost(created.websiteHostname),
    ).toBe("http://127.0.0.1:43123");
    expect(targetCleanupCalls).toBe(0);
    expect(
      [...resourceLeases.values()].filter(
        (lease) =>
          lease.resourceType === "target-run" && lease.status === "ACTIVE",
      ),
    ).toHaveLength(1);

    const stopped = await restarted.stop(created.id);
    expect(stopped?.status).toBe("STOPPED");
    expect(stopped?.credentialPassword).toBeUndefined();
    expect(finishedRuns.at(-1)).toBe("PASSED");
    expect(targetCleanupCalls).toBe(1);
    expect(timeline.length).toBeGreaterThan(0);
  });

  it("generates a session-specific demo credential when selected", async () => {
    const sessionStore = new Map<string, DemoSessionRecord>();
    const sessions = {
      async create(
        id: string,
        runId: RunId,
        websiteHostname: string,
        customerPackage: string,
        expiresAt: string,
        credentialMode: "shared" | "generated",
        credentialEmail: string,
        credentialPassword: string,
      ) {
        const now = new Date().toISOString();
        const session: DemoSessionRecord = {
          id,
          runId,
          status: "CREATE",
          customerPackage,
          websiteHostname,
          credentialMode,
          credentialEmail,
          credentialPassword,
          resetVersion: 0,
          startedAt: now,
          expiresAt,
          createdAt: now,
          updatedAt: now,
        };
        sessionStore.set(id, session);
        return session;
      },
      async get(id: string) {
        return sessionStore.get(id);
      },
      async update(id: string, patch: Record<string, unknown>) {
        const current = sessionStore.get(id);
        if (!current) throw new Error("missing test session");
        const next = mergeSession(current, patch);
        sessionStore.set(id, next);
        return next;
      },
      async finishRun() {},
      async listInterrupted() {
        return [];
      },
      async getByHostname() {
        return undefined;
      },
    } as unknown as DemoSessionRepository;

    const evidence = {
      async appendTimeline() {},
      async createResourceLease() {},
      async listActiveResourceLeases() {
        return [];
      },
      async releaseResourceLease() {},
    } as unknown as ScenarioRunRepository;

    const preparedInputs: ScenarioValue[] = [];
    const actions = {
      "vendor.compile": async (input: ScenarioValue | undefined) => ({
        vendorId: readInputString(input, "package"),
      }),
      "vendor.start-runtime": async (input: ScenarioValue | undefined) => {
        const vendorId = readInputString(input, "vendorId");
        return { vendorId, providerBaseUrl: `http://${vendorId}.test/${vendorId}` };
      },
      "target.prepare-run": async (input: ScenarioValue | undefined) => {
        if (input !== undefined) preparedInputs.push(input);
        return {
          targetRunId: "target-run-generated",
          tenantId: "tenant-generated",
          siteId: "site-generated",
          targetOrigin: "http://gl-eye.test",
        };
      },
      "gateway.create-route": async () => ({ routeId: "route-generated" }),
      "browser.load-package": async () => ({ customerId: "customer-alpha" }),
      "site.start": async () => ({
        hostname: "demo.localhost",
        localOrigin: "http://127.0.0.1:43123",
      }),
      "target.configure-vendors": async () => ({ configured: true }),
      "target.configure-site": async () => ({ configured: true }),
      "target.start-observation": async () => ({ observationId: "observation-generated" }),
      "site.configure-manual-tracking": async () => ({ configured: true }),
    } as unknown as ScenarioActionRegistry;

    const service = new InteractiveDemoService(
      testConfig(),
      sessions,
      evidence,
      actions,
      {},
    );

    const first = await service.create({ credentialMode: "generated" });
    expect(first.credentialMode).toBe("generated");
    expect(first.credentialEmail).toMatch(/^demo-[a-f0-9]{12}@example\.com$/u);
    expect(first.credentialPassword).toMatch(/^Demo-[A-Za-z0-9_-]+9!Aa$/u);
    expect(first.credentialPassword).not.toBe("Demo-Access9!");
    expect(asRecord(preparedInputs[0]).demoSessionId).toBe(first.id);
    expect(asRecord(asRecord(preparedInputs[0]).demoCredential).email).toBe(
      first.credentialEmail,
    );
    expect(service.workspaceName(first)).toBe(
      "Testy Demo - " + first.id.replaceAll("-", "").slice(0, 8),
    );
  });

  it("builds browser URLs for a configured remote demo domain", () => {
    const service = new InteractiveDemoService(
      {
        ...testConfig(),
        publicDemoBaseUrl: "https://testy.example.com",
      },
      {} as DemoSessionRepository,
      {} as ScenarioRunRepository,
      {} as ScenarioActionRegistry,
      {},
    );
    const session = {
      websiteHostname: "demo-0123456789abcdef.testy.example.com",
    } as DemoSessionRecord;

    expect(service.websiteUrl(session)).toBe(
      "https://demo-0123456789abcdef.testy.example.com/",
    );
    expect(
      service.isDemoWebsiteHostname(
        "demo-0123456789abcdef.testy.example.com",
      ),
    ).toBe(true);
    expect(service.isDemoWebsiteHostname("demo-0123456789abcdef.localhost")).toBe(
      false,
    );
  });
});

function testConfig(): ControlPlaneConfig {
  return {
    host: "127.0.0.1",
    port: 3000,
    publicControlPlanePort: 23000,
    demoSessionTtlMs: 4 * 60 * 60 * 1000,
    databaseUrl: "postgresql://test",
    logLevel: "silent",
    scenariosDirectory: resolve(import.meta.dirname, "../../../scenarios"),
    vendorPackagesDirectory: resolve(import.meta.dirname, "../../../vendors"),
    browserPackagesDirectory: resolve(import.meta.dirname, "../../../customers"),
    generatedRunsDirectory: resolve(import.meta.dirname, "../../../generated"),
    browser: "chromium",
    browserHeadless: true,
    maintenance: {
      intervalMs: 60_000,
      batchSize: 100,
      claimTtlMs: 300_000,
      artifactRetentionMs: 604_800_000,
    },
    targetIntegration: {
      adapter: "gl-eye",
      gatewayAdminUrl: "http://gateway.test",
      gatewayAdminToken: "synthetic-admin-token",
      glEyeBaseUrl: "http://gl-eye.test",
      glEyeEnvironment: "local",
      glEyeAuthToken: "synthetic-auth-token",
      glEyeAllowedOrigins: ["http://gl-eye.test"],
    },
  };
}

function asRecord(
  value: ScenarioValue | undefined,
): Record<string, ScenarioValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("expected record");
  }
  return value as Record<string, ScenarioValue>;
}

function readInputString(
  value: ScenarioValue | undefined,
  key: string,
): string {
  const selected = asRecord(value)[key];
  if (typeof selected !== "string") throw new Error("expected string");
  return selected;
}

function readInputNumber(
  value: ScenarioValue | undefined,
  key: string,
): number {
  const selected = asRecord(value)[key];
  if (typeof selected !== "number") throw new Error("expected number");
  return selected;
}

function mergeSession(
  current: DemoSessionRecord,
  patch: Record<string, unknown>,
): DemoSessionRecord {
  const result = { ...current, updatedAt: new Date().toISOString() } as Record<
    string,
    unknown
  >;
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else if (value !== undefined) result[key] = value;
  }
  return result as unknown as DemoSessionRecord;
}
