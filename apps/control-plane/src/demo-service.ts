import { randomUUID } from "node:crypto";

import type { ResourceLease, RunId, ScenarioId } from "@testy/shared-types";
import type {
  ScenarioActionContext,
  ScenarioActionRegistry,
  ScenarioRunRepository,
  ScenarioValue,
} from "@testy/scenario-engine";

import type { ControlPlaneConfig } from "./config.js";
import {
  loadDemoProfileCatalog,
  selectDemoVisitor,
  type DemoProfileCatalog,
} from "./demo-profiles.js";
import type {
  DemoSessionRecord,
  DemoSessionRepository,
} from "./demo-repository.js";
import type { ResourceLeaseCleaner } from "./run-service.js";

interface DemoRuntime {
  readonly controller: AbortController;
  readonly outputs: Record<string, ScenarioValue>;
  readonly cleanups: Array<() => Promise<void>>;
  readonly leaseCleanups: Map<string, () => Promise<void>>;
  readonly providerBaseUrls: Record<string, string>;
  targetOrigin?: string;
  localSiteOrigin?: string;
}

export interface ApplyDemoVisitorInput {
  readonly networkId: string;
  readonly personId?: string;
  readonly browserId: string;
}

export interface DemoActivity {
  readonly timeline: Awaited<ReturnType<ScenarioRunRepository["listTimeline"]>>;
  readonly providerCalls: Awaited<
    ReturnType<ScenarioRunRepository["listProviderCalls"]>
  >;
  readonly observations: Awaited<
    ReturnType<ScenarioRunRepository["listObservations"]>
  >;
  readonly gatewayRequests: readonly ScenarioValue[];
  readonly siteEvents: readonly ScenarioValue[];
}

export class InteractiveDemoService {
  private readonly runtimes = new Map<string, DemoRuntime>();
  private catalogPromise?: Promise<DemoProfileCatalog>;

  public constructor(
    private readonly config: ControlPlaneConfig,
    private readonly sessions: DemoSessionRepository,
    private readonly evidence: ScenarioRunRepository,
    private readonly actions: ScenarioActionRegistry,
    private readonly resourceCleaners: Readonly<
      Record<string, ResourceLeaseCleaner>
    >,
  ) {}

  public profiles(): Promise<DemoProfileCatalog> {
    this.catalogPromise ??= loadDemoProfileCatalog(
      this.config.browserPackagesDirectory,
    );
    return this.catalogPromise;
  }

  public async create(): Promise<DemoSessionRecord> {
    if (!this.config.targetIntegration) {
      throw new Error("Interactive Demo requires target integration.");
    }
    const catalog = await this.profiles();
    const selected = selectDemoVisitor(
      catalog,
      catalog.defaults.networkId,
      catalog.defaults.personId,
      catalog.defaults.browserId,
    );
    const sessionId = randomUUID();
    const runId = randomUUID() as RunId;
    const hostname = `demo-${sessionId.replaceAll("-", "").slice(0, 20)}.localhost`;
    const expiresAt = new Date(
      Date.now() + this.config.demoSessionTtlMs,
    ).toISOString();
    let session = await this.sessions.create(
      sessionId,
      runId,
      hostname,
      "customer-alpha",
      expiresAt,
    );
    const runtime: DemoRuntime = {
      controller: new AbortController(),
      outputs: {},
      cleanups: [],
      leaseCleanups: new Map(),
      providerBaseUrls: {},
    };
    this.runtimes.set(sessionId, runtime);
    await this.timeline(session, "demo-session-created", {
      websiteHostname: hostname,
    });

    try {
      session = await this.sessions.update(sessionId, {
        status: "PROVISIONING",
      });

      for (const vendorId of ["ipinfo", "apollo", "hunter"] as const) {
        const compiled = await this.invoke(
          session,
          runtime,
          "vendor.compile",
          { package: vendorId },
          `compile-${vendorId}`,
        );
        const compiledVendorId = readString(compiled, "vendorId");
        const started = await this.invoke(
          session,
          runtime,
          "vendor.start-runtime",
          { vendorId: compiledVendorId },
          `runtime-${vendorId}`,
        );
        runtime.providerBaseUrls[vendorId] = readString(
          started,
          "providerBaseUrl",
        );
      }

      const prepared = await this.invoke(
        session,
        runtime,
        "target.prepare-run",
        undefined,
        "prepare-target",
      );
      runtime.targetOrigin = readString(prepared, "targetOrigin");
      const targetRunId = readString(prepared, "targetRunId");
      const tenantId = readString(prepared, "tenantId");
      const siteId = readString(prepared, "siteId");

      const route = await this.invoke(
        session,
        runtime,
        "gateway.create-route",
        {
          targetOrigin: runtime.targetOrigin,
          syntheticIp: selected.network.syntheticIp,
          ttlMs: this.config.demoSessionTtlMs,
        },
        "gateway-route",
      );

      await this.invoke(
        session,
        runtime,
        "browser.load-package",
        { package: session.customerPackage },
        "browser-package",
      );
      const site = await this.invoke(
        session,
        runtime,
        "site.start",
        { hostname: session.websiteHostname },
        "synthetic-site",
      );
      runtime.localSiteOrigin = readString(site, "localOrigin");

      await this.configureProviders(session, runtime, selected.person?.providerProfile);
      const publicOrigin = this.publicSecureOrigin(session);
      await this.invoke(
        session,
        runtime,
        "target.configure-site",
        {
          hostname: session.websiteHostname,
          origin: publicOrigin,
        },
        "configured-site",
      );
      await this.invoke(
        session,
        runtime,
        "target.start-observation",
        undefined,
        "target-observation",
      );
      await this.invoke(
        session,
        runtime,
        "site.configure-manual-tracking",
        { publicOrigin, resetVersion: 0 },
        "manual-tracking",
      );

      const visitorStartedAt = new Date().toISOString();
      session = await this.sessions.update(session.id, {
        status: "READY",
        networkIdentityId: selected.network.id,
        personIdentityId: selected.person?.id ?? null,
        browserIdentityId: selected.browser.id,
        activeGatewayRouteId: readString(route, "routeId"),
        targetRunId,
        tenantId,
        siteId,
        visitorStartedAt,
      });
      await this.timeline(session, "demo-session-ready", {
        networkIdentityId: selected.network.id,
        personIdentityId: selected.person?.id ?? "none",
      });
      return session;
    } catch (error) {
      await this.failSession(session, error);
      throw error;
    }
  }

  public async get(id: string): Promise<DemoSessionRecord | undefined> {
    const session = await this.sessions.get(id);
    if (!session) return undefined;
    if (
      session.status !== "STOPPED" &&
      session.status !== "FAILED" &&
      Date.parse(session.expiresAt) <= Date.now()
    ) {
      await this.stop(id, "expired");
      return this.sessions.get(id);
    }
    return session;
  }

  public websiteUrl(session: DemoSessionRecord): string {
    return `http://${session.websiteHostname}:${String(
      this.config.publicControlPlanePort,
    )}/`;
  }

  public async localWebsiteOriginForHost(
    hostname: string,
  ): Promise<string | undefined> {
    const session = await this.sessions.getByHostname(hostname.toLowerCase());
    if (!session) return undefined;
    return this.runtimes.get(session.id)?.localSiteOrigin;
  }

  public async applyVisitor(
    id: string,
    input: ApplyDemoVisitorInput,
  ): Promise<DemoSessionRecord> {
    const session = await this.requireLiveSession(id);
    const runtime = this.requireRuntime(id);
    const selected = selectDemoVisitor(
      await this.profiles(),
      input.networkId,
      input.personId,
      input.browserId,
    );
    if (!runtime.targetOrigin) {
      throw new Error("Interactive Demo target origin is unavailable.");
    }

    const route = await this.invoke(
      session,
      runtime,
      "gateway.replace-route",
      {
        targetOrigin: runtime.targetOrigin,
        syntheticIp: selected.network.syntheticIp,
        ttlMs: this.config.demoSessionTtlMs,
      },
      `gateway-route-${Date.now()}`,
    );
    await this.configureProviders(
      session,
      runtime,
      selected.person?.providerProfile,
    );

    const resetVersion = selected.browser.reset
      ? session.resetVersion + 1
      : session.resetVersion;
    await this.invoke(
      session,
      runtime,
      "site.configure-manual-tracking",
      {
        publicOrigin: this.publicSecureOrigin(session),
        resetVersion,
      },
      `manual-tracking-${Date.now()}`,
    );

    const visitorStartedAt = new Date().toISOString();
    const updated = await this.sessions.update(id, {
      status: "ACTIVE",
      networkIdentityId: selected.network.id,
      personIdentityId: selected.person?.id ?? null,
      browserIdentityId: selected.browser.id,
      resetVersion,
      activeGatewayRouteId: readString(route, "routeId"),
      enrichmentTriggeredAt: null,
      visitorStartedAt,
    });
    await this.timeline(updated, "visitor-profile-applied", {
      networkIdentityId: selected.network.id,
      personIdentityId: selected.person?.id ?? "none",
      browserIdentityId: selected.browser.id,
      resetVersion,
    });
    return updated;
  }

  public async resetVisitor(id: string): Promise<DemoSessionRecord> {
    const session = await this.requireLiveSession(id);
    const runtime = this.requireRuntime(id);
    const resetVersion = session.resetVersion + 1;
    await this.invoke(
      session,
      runtime,
      "site.configure-manual-tracking",
      {
        publicOrigin: this.publicSecureOrigin(session),
        resetVersion,
      },
      `manual-reset-${resetVersion}`,
    );
    const visitorStartedAt = new Date().toISOString();
    const updated = await this.sessions.update(id, {
      status: "ACTIVE",
      resetVersion,
      browserIdentityId: "clean",
      enrichmentTriggeredAt: null,
      visitorStartedAt,
    });
    await this.timeline(updated, "visitor-browser-reset-requested", {
      resetVersion,
    });
    return updated;
  }

  public async outcome(id: string): Promise<ScenarioValue | undefined> {
    let session = await this.requireLiveSession(id);
    const runtime = this.requireRuntime(id);
    let outcome = await this.invoke(
      session,
      runtime,
      "target.collect-outcome",
      session.visitorStartedAt ? { since: session.visitorStartedAt } : undefined,
    );
    if (
      readOptionalNumber(outcome, "companyCount") &&
      !session.enrichmentTriggeredAt
    ) {
      await this.invoke(
        session,
        runtime,
        "target.trigger-enrichment",
        session.visitorStartedAt ? { since: session.visitorStartedAt } : undefined,
      );
      session = await this.sessions.update(id, {
        enrichmentTriggeredAt: new Date().toISOString(),
      });
      await this.timeline(session, "target-enrichment-triggered", {});
      outcome = await this.invoke(
        session,
        runtime,
        "target.collect-outcome",
        session.visitorStartedAt ? { since: session.visitorStartedAt } : undefined,
      );
    }
    return outcome;
  }

  public async activity(id: string): Promise<DemoActivity> {
    const session = await this.requireLiveSession(id);
    const runtime = this.requireRuntime(id);
    for (const vendorId of ["ipinfo", "apollo", "hunter"] as const) {
      await this.invoke(
        session,
        runtime,
        "vendor.collect-ledger",
        { vendorId },
      );
    }
    const gateway = await this.invoke(
      session,
      runtime,
      "gateway.collect-ledger",
      undefined,
    );
    const site = await this.invoke(
      session,
      runtime,
      "browser.collect-site-events",
      undefined,
    );
    const [timeline, providerCalls, observations] = await Promise.all([
      this.evidence.listTimeline(session.runId),
      this.evidence.listProviderCalls(session.runId),
      this.evidence.listObservations(session.runId),
    ]);
    return {
      timeline,
      providerCalls,
      observations,
      gatewayRequests: readArray(gateway, "entries"),
      siteEvents: readArray(site, "events"),
    };
  }

  public async stop(
    id: string,
    reason = "operator",
  ): Promise<DemoSessionRecord | undefined> {
    let session = await this.sessions.get(id);
    if (!session) return undefined;
    if (session.status === "STOPPED" || session.status === "FAILED") {
      return session;
    }
    session = await this.sessions.update(id, { status: "STOPPING" });
    await this.timeline(session, "demo-session-stopping", { reason });
    const errors = await this.cleanupSession(session);
    const stoppedAt = new Date().toISOString();
    session = await this.sessions.update(id, {
      status: errors.length === 0 ? "STOPPED" : "FAILED",
      stoppedAt,
      ...(errors.length > 0 ? { errorMessage: errors.join("; ") } : {}),
    });
    await this.sessions.finishRun(
      session.runId,
      errors.length === 0 ? "PASSED" : "FAILED",
    );
    await this.timeline(session, "demo-session-stopped", {
      reason,
      cleanupErrorCount: errors.length,
    });
    return session;
  }

  public async recoverInterruptedSessions(): Promise<void> {
    for (const session of await this.sessions.listInterrupted()) {
      const errors = await this.cleanupSession(session);
      const recovered = await this.sessions.update(session.id, {
        status: errors.length === 0 ? "STOPPED" : "FAILED",
        stoppedAt: new Date().toISOString(),
        errorMessage:
          errors.length === 0
            ? "Session terminated during Control Plane restart recovery."
            : errors.join("; "),
      });
      await this.sessions.finishRun(recovered.runId, "FAILED");
    }
  }

  public async expireSessions(): Promise<void> {
    const now = Date.now();
    for (const session of await this.sessions.listInterrupted()) {
      if (Date.parse(session.expiresAt) <= now) {
        await this.stop(session.id, "expired");
      }
    }
  }

  public async shutdown(): Promise<void> {
    for (const sessionId of [...this.runtimes.keys()]) {
      await this.stop(sessionId, "control-plane-shutdown").catch(() => undefined);
    }
    for (const runtime of this.runtimes.values()) {
      runtime.controller.abort(new Error("Control Plane shutdown."));
    }
  }

  private async configureProviders(
    session: DemoSessionRecord,
    runtime: DemoRuntime,
    providerProfile: string | undefined,
  ): Promise<void> {
    const profile = providerProfile ?? "none";
    await this.invoke(
      session,
      runtime,
      "target.configure-vendors",
      {
        endpoints: {
          ipinfo: requireProvider(runtime, "ipinfo"),
          apollo: appendProfile(requireProvider(runtime, "apollo"), profile),
          hunter: appendProfile(requireProvider(runtime, "hunter"), profile),
        },
      },
      `configured-vendors-${profile}-${Date.now()}`,
    );
  }

  private async invoke(
    session: DemoSessionRecord,
    runtime: DemoRuntime,
    name: string,
    input: ScenarioValue | undefined,
    outputKey?: string,
  ): Promise<ScenarioValue | undefined> {
    const action = this.actions[name];
    if (!action) throw new Error(`Interactive Demo action '${name}' is unavailable.`);
    const context = this.context(session, runtime);
    const value = await action(input, context);
    if (value !== undefined && outputKey) runtime.outputs[outputKey] = value;
    return value;
  }

  private context(
    session: DemoSessionRecord,
    runtime: DemoRuntime,
  ): ScenarioActionContext {
    return {
      runId: session.runId,
      scenarioId: "interactive-demo" as ScenarioId,
      target: "gl-eye",
      variables: {},
      outputs: runtime.outputs,
      signal: runtime.controller.signal,
      registerCleanup: (_name, cleanup) => {
        runtime.cleanups.push(cleanup);
      },
      registerResourceLease: async (
        resourceType,
        resourceKey,
        expiresAt,
        cleanup,
      ): Promise<ResourceLease> => {
        const lease: ResourceLease = {
          leaseId: randomUUID(),
          runId: session.runId,
          resourceType,
          resourceKey,
          expiresAt,
        };
        await this.evidence.createResourceLease(lease);
        runtime.leaseCleanups.set(lease.leaseId, cleanup);
        return lease;
      },
    };
  }

  private async cleanupSession(
    session: DemoSessionRecord,
  ): Promise<readonly string[]> {
    const errors: string[] = [];
    const runtime = this.runtimes.get(session.id);
    if (runtime) {
      const cleanupAction = this.actions["target.cleanup-run"];
      if (cleanupAction) {
        try {
          await cleanupAction(undefined, this.context(session, runtime));
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
    }
    const leases = await this.evidence.listActiveResourceLeases(session.runId);
    for (const lease of [...leases].reverse()) {
      try {
        const local = runtime?.leaseCleanups.get(lease.leaseId);
        if (local) {
          await local();
        } else {
          const cleaner = this.resourceCleaners[lease.resourceType];
          if (!cleaner) {
            throw new Error(
              `No resource cleaner is registered for '${lease.resourceType}'.`,
            );
          }
          await cleaner(lease);
        }
        await this.evidence.releaseResourceLease(
          lease.leaseId,
          new Date().toISOString(),
        );
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    if (runtime) {
      for (const cleanup of [...runtime.cleanups].reverse()) {
        try {
          await cleanup();
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
      this.runtimes.delete(session.id);
    }
    return errors;
  }

  private async failSession(
    session: DemoSessionRecord,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const cleanupErrors = await this.cleanupSession(session);
    await this.sessions.update(session.id, {
      status: "FAILED",
      stoppedAt: new Date().toISOString(),
      errorMessage: [message, ...cleanupErrors].join("; "),
    });
    await this.sessions.finishRun(session.runId, "FAILED");
  }

  private async requireLiveSession(id: string): Promise<DemoSessionRecord> {
    const session = await this.get(id);
    if (!session) throw new Error("Interactive Demo session was not found.");
    if (session.status !== "READY" && session.status !== "ACTIVE") {
      throw new Error(
        `Interactive Demo session is not active (status ${session.status}).`,
      );
    }
    return session;
  }

  private requireRuntime(id: string): DemoRuntime {
    const runtime = this.runtimes.get(id);
    if (!runtime) {
      throw new Error(
        "Interactive Demo runtime is unavailable; restart the demo session.",
      );
    }
    return runtime;
  }

  private publicSecureOrigin(session: DemoSessionRecord): string {
    return `https://${session.websiteHostname}:${String(
      this.config.publicControlPlanePort,
    )}`;
  }

  private async timeline(
    session: DemoSessionRecord,
    name: string,
    metadata: Readonly<Record<string, ScenarioValue>>,
  ): Promise<void> {
    await this.evidence.appendTimeline({
      runId: session.runId,
      occurredAt: new Date().toISOString(),
      category: "engine",
      name,
      metadata,
    });
  }
}

function appendProfile(baseUrl: string, profile: string): string {
  return `${baseUrl.replace(/\/$/u, "")}/profiles/${encodeURIComponent(profile)}`;
}

function requireProvider(runtime: DemoRuntime, vendorId: string): string {
  const value = runtime.providerBaseUrls[vendorId];
  if (!value) throw new Error(`Vendor runtime '${vendorId}' is unavailable.`);
  return value;
}

function readRecord(
  value: ScenarioValue | undefined,
): Readonly<Record<string, ScenarioValue>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Interactive Demo action did not return an object.");
  }
  return value as Readonly<Record<string, ScenarioValue>>;
}

function readString(value: ScenarioValue | undefined, key: string): string {
  const record = readRecord(value);
  const selected = record[key];
  if (typeof selected !== "string" || selected.length === 0) {
    throw new Error(`Interactive Demo output '${key}' is unavailable.`);
  }
  return selected;
}

function readOptionalNumber(
  value: ScenarioValue | undefined,
  key: string,
): number | undefined {
  const record = readRecord(value);
  const selected = record[key];
  return typeof selected === "number" && Number.isFinite(selected)
    ? selected
    : undefined;
}


function readArray(
  value: ScenarioValue | undefined,
  key: string,
): readonly ScenarioValue[] {
  const record = readRecord(value);
  const selected = record[key];
  return Array.isArray(selected) ? selected : [];
}
