import { createHash } from "node:crypto";

import type { RunId } from "@testy/shared-types";

import type {
  AdapterRunContext,
  CompletionCondition,
  ObservationHandle,
  ObservationResult,
  PreparedTarget,
  SiteDefinition,
  TargetAdapter,
  TargetOutcome,
  VendorEndpoints,
} from "./types.js";

interface FakeTargetState {
  readonly prepared: PreparedTarget;
  vendorEndpoints: VendorEndpoints;
  site?: SiteDefinition;
  observationState: string;
}

export class FakeTargetAdapter implements TargetAdapter {
  private readonly byRun = new Map<RunId, FakeTargetState>();
  private readonly byTarget = new Map<string, RunId>();

  public async prepareRun(context: AdapterRunContext): Promise<PreparedTarget> {
    const existing = this.byRun.get(context.runId);
    if (existing) return existing.prepared;
    const segment = createHash("sha256").update(context.runId).digest("hex").slice(0, 12);
    const prepared: PreparedTarget = {
      targetRunId: `fake-${segment}`,
      tenantId: `tenant-alpha-${segment}`,
      controlTenantId: `tenant-beta-${segment}`,
      trackingScriptUrl: `https://tracking.example.test/${segment}.js`,
      siteId: `site-${segment}`,
      targetOrigin: "https://target.example.test",
    };
    this.byRun.set(context.runId, {
      prepared,
      vendorEndpoints: {},
      observationState: "ready",
    });
    this.byTarget.set(prepared.targetRunId, context.runId);
    return prepared;
  }

  public async configureVendorEndpoints(
    context: AdapterRunContext,
    endpoints: VendorEndpoints,
  ): Promise<void> {
    this.require(context.runId).vendorEndpoints = { ...endpoints };
  }

  public async configureSyntheticSite(
    context: AdapterRunContext,
    site: SiteDefinition,
  ): Promise<SiteDefinition> {
    const state = this.require(context.runId);
    state.site = { ...site };
    return state.site;
  }

  public async startObservation(context: AdapterRunContext): Promise<ObservationHandle> {
    const state = this.require(context.runId);
    state.observationState = "completed";
    return {
      observationId: `obs-${state.prepared.targetRunId}`,
      targetRunId: state.prepared.targetRunId,
    };
  }

  public async waitForCompletion(
    context: AdapterRunContext,
    condition: CompletionCondition,
  ): Promise<ObservationResult> {
    const state = this.require(context.runId);
    if (condition.signal?.aborted) throw condition.signal.reason;
    return {
      completed: true,
      state: condition.expectedState ?? state.observationState,
      observedAt: new Date().toISOString(),
    };
  }

  public async collectOutcome(context: AdapterRunContext): Promise<TargetOutcome> {
    const state = this.require(context.runId);
    return {
      targetRunId: state.prepared.targetRunId,
      tenantId: state.prepared.tenantId,
      visibleTenantIds: [state.prepared.tenantId],
      scoreCount: 1,
      companyCount: 1,
    };
  }

  public async cleanupRun(context: AdapterRunContext): Promise<void> {
    const targetRunId = this.byRun.get(context.runId)?.prepared.targetRunId;
    if (targetRunId) await this.cleanupTarget(targetRunId);
  }

  public async cleanupTarget(targetRunId: string): Promise<void> {
    const runId = this.byTarget.get(targetRunId);
    if (!runId) return;
    this.byTarget.delete(targetRunId);
    this.byRun.delete(runId);
  }

  public snapshot(runId: RunId): Readonly<FakeTargetState> | undefined {
    const state = this.byRun.get(runId);
    return state ? {
      prepared: { ...state.prepared },
      vendorEndpoints: { ...state.vendorEndpoints },
      ...(state.site ? { site: { ...state.site } } : {}),
      observationState: state.observationState,
    } : undefined;
  }

  private require(runId: RunId): FakeTargetState {
    const state = this.byRun.get(runId);
    if (!state) throw new Error(`Fake target run '${runId}' was not prepared.`);
    return state;
  }
}
