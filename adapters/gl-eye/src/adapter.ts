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
} from "@testy/target-adapter";

export interface GlEyeEndpointTemplates {
  readonly prepareRun: string;
  readonly configureVendors: string;
  readonly configureSite: string;
  readonly startObservation: string;
  readonly observationStatus: string;
  readonly outcome: string;
  readonly cleanup: string;
}

export const defaultGlEyeTestSupportEndpoints: GlEyeEndpointTemplates = {
  prepareRun: "/test-support/v1/runs",
  configureVendors: "/test-support/v1/runs/{targetRunId}/vendor-endpoints",
  configureSite: "/test-support/v1/runs/{targetRunId}/site",
  startObservation: "/test-support/v1/runs/{targetRunId}/observations",
  observationStatus: "/test-support/v1/runs/{targetRunId}/observations/{observationId}",
  outcome: "/test-support/v1/runs/{targetRunId}/outcome",
  cleanup: "/test-support/v1/runs/{targetRunId}",
};

export interface GlEyeTargetAdapterOptions {
  readonly baseUrl: string;
  readonly environment: string;
  readonly authToken: string;
  readonly allowedOrigins: readonly string[];
  readonly approvedEnvironments?: readonly string[];
  readonly endpoints?: Partial<GlEyeEndpointTemplates>;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly fetchImpl?: typeof fetch;
}

export class GlEyeTargetAdapter implements TargetAdapter {
  private readonly baseOrigin: string;
  private readonly endpoints: GlEyeEndpointTemplates;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly prepared = new Map<RunId, PreparedTarget>();
  private readonly observations = new Map<RunId, ObservationHandle>();

  public constructor(private readonly options: GlEyeTargetAdapterOptions) {
    this.baseOrigin = normalizeAllowedOrigin(options.baseUrl, options.allowedOrigins);
    const approved = new Set(
      (options.approvedEnvironments ?? ["local", "test", "testing", "qa", "staging"])
        .map((value) => value.toLowerCase()),
    );
    if (!approved.has(options.environment.toLowerCase()) || options.environment.toLowerCase() === "production") {
      throw new Error("GL-EYE adapter is restricted to explicitly approved test environments.");
    }
    if (options.authToken.length < 12) throw new Error("GL-EYE test-support token is too short.");
    this.endpoints = { ...defaultGlEyeTestSupportEndpoints, ...(options.endpoints ?? {}) };
    for (const endpoint of Object.values(this.endpoints)) validateEndpointTemplate(endpoint);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxResponseBytes = options.maxResponseBytes ?? 1024 * 1024;
  }

  public async prepareRun(context: AdapterRunContext): Promise<PreparedTarget> {
    const existing = this.prepared.get(context.runId);
    if (existing) return existing;
    const value = await this.requestJson(
      "POST",
      this.endpoints.prepareRun,
      context,
      {
        runId: context.runId,
        scenarioId: context.scenarioId,
        target: context.target,
        environment: this.options.environment,
      },
    );
    const controlTenantId = optionalString(value, "controlTenantId");
    const prepared: PreparedTarget = {
      targetRunId: requireString(value, "targetRunId"),
      tenantId: requireString(value, "tenantId"),
      ...(controlTenantId ? { controlTenantId } : {}),
      trackingScriptUrl: requireString(value, "trackingScriptUrl"),
      siteId: requireString(value, "siteId"),
      targetOrigin: this.baseOrigin,
    };
    this.prepared.set(context.runId, prepared);
    return prepared;
  }

  public async configureVendorEndpoints(
    context: AdapterRunContext,
    endpoints: VendorEndpoints,
  ): Promise<void> {
    const prepared = this.requirePrepared(context.runId);
    await this.requestJson(
      "PUT",
      expandEndpoint(this.endpoints.configureVendors, prepared.targetRunId),
      context,
      { endpoints },
      [200, 204],
    );
  }

  public async configureSyntheticSite(
    context: AdapterRunContext,
    site: SiteDefinition,
  ): Promise<SiteDefinition> {
    const prepared = this.requirePrepared(context.runId);
    await this.requestJson(
      "PUT",
      expandEndpoint(this.endpoints.configureSite, prepared.targetRunId),
      context,
      site,
      [200, 204],
    );
    return site;
  }

  public async startObservation(context: AdapterRunContext): Promise<ObservationHandle> {
    const prepared = this.requirePrepared(context.runId);
    const value = await this.requestJson(
      "POST",
      expandEndpoint(this.endpoints.startObservation, prepared.targetRunId),
      context,
      {},
      [200, 201, 202],
    );
    const handle: ObservationHandle = {
      observationId: requireString(value, "observationId"),
      targetRunId: prepared.targetRunId,
    };
    this.observations.set(context.runId, handle);
    return handle;
  }

  public async waitForCompletion(
    context: AdapterRunContext,
    condition: CompletionCondition,
  ): Promise<ObservationResult> {
    const prepared = this.requirePrepared(context.runId);
    const observation = this.observations.get(context.runId);
    if (!observation) throw new Error("GL-EYE observation has not been started.");
    const deadline = Date.now() + condition.timeoutMs;
    while (Date.now() <= deadline) {
      throwIfAborted(condition.signal ?? context.signal);
      const value = await this.requestJson(
        "GET",
        expandEndpoint(
          this.endpoints.observationStatus,
          prepared.targetRunId,
          observation.observationId,
        ),
        context,
      );
      const state = requireString(value, "state");
      const completed = value.completed === true ||
        (condition.expectedState !== undefined && state === condition.expectedState);
      if (completed) {
        return {
          completed: true,
          state,
          observedAt: new Date().toISOString(),
          detailsFingerprint: fingerprintJson(value),
        };
      }
      await abortableDelay(condition.pollIntervalMs, condition.signal ?? context.signal);
    }
    throw new Error(`GL-EYE observation exceeded ${condition.timeoutMs}ms.`);
  }

  public async collectOutcome(context: AdapterRunContext): Promise<TargetOutcome> {
    const prepared = this.requirePrepared(context.runId);
    const value = await this.requestJson(
      "GET",
      expandEndpoint(this.endpoints.outcome, prepared.targetRunId),
      context,
    );
    return {
      targetRunId: prepared.targetRunId,
      tenantId: prepared.tenantId,
      visibleTenantIds: requireStringArray(value, "visibleTenantIds"),
      scoreCount: requireNumber(value, "scoreCount"),
      companyCount: requireNumber(value, "companyCount"),
      detailsFingerprint: fingerprintJson(value),
    };
  }

  public async cleanupRun(context: AdapterRunContext): Promise<void> {
    const prepared = this.prepared.get(context.runId);
    if (!prepared) return;
    await this.cleanupTarget(prepared.targetRunId);
    this.prepared.delete(context.runId);
    this.observations.delete(context.runId);
  }

  public async cleanupTarget(targetRunId: string): Promise<void> {
    await this.requestJson(
      "DELETE",
      expandEndpoint(this.endpoints.cleanup, targetRunId),
      undefined,
      undefined,
      [200, 202, 204, 404, 410],
    );
    for (const [runId, prepared] of this.prepared) {
      if (prepared.targetRunId === targetRunId) {
        this.prepared.delete(runId);
        this.observations.delete(runId);
      }
    }
  }

  private requirePrepared(runId: RunId): PreparedTarget {
    const prepared = this.prepared.get(runId);
    if (!prepared) throw new Error(`GL-EYE run '${runId}' is not prepared.`);
    return prepared;
  }

  private async requestJson(
    method: string,
    endpoint: string,
    context?: AdapterRunContext,
    body?: unknown,
    acceptedStatuses: readonly number[] = [200],
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const forwardAbort = (): void => controller.abort(context?.signal?.reason);
    context?.signal?.addEventListener("abort", forwardAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(new URL(endpoint, this.baseOrigin), {
        method,
        headers: {
          authorization: `Bearer ${this.options.authToken}`,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(context ? { "x-testy-run-id": context.runId } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "manual",
        signal: controller.signal,
      });
      if (!acceptedStatuses.includes(response.status)) {
        throw new Error(`GL-EYE test-support request failed with status ${response.status}.`);
      }
      if (response.status === 204 || response.status === 404 || response.status === 410) return {};
      const bytes = await readLimitedResponseBody(response, this.maxResponseBytes);
      const parsed = JSON.parse(bytes.toString("utf8")) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("GL-EYE test-support response must be a JSON object.");
      }
      return parsed as Record<string, unknown>;
    } finally {
      clearTimeout(timer);
      context?.signal?.removeEventListener("abort", forwardAbort);
    }
  }
}

function normalizeAllowedOrigin(value: string, allowedOrigins: readonly string[]): string {
  const origin = new URL(value).origin;
  const allowed = new Set(allowedOrigins.map((item) => new URL(item).origin));
  if (!allowed.has(origin)) throw new Error("GL-EYE origin is not allowlisted.");
  return origin;
}

function validateEndpointTemplate(value: string): void {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("..")) {
    throw new Error("GL-EYE endpoint templates must be confined relative paths.");
  }
}

function expandEndpoint(template: string, targetRunId: string, observationId?: string): string {
  return template
    .replaceAll("{targetRunId}", encodeURIComponent(targetRunId))
    .replaceAll("{observationId}", encodeURIComponent(observationId ?? ""));
}

function requireString(value: Record<string, unknown>, key: string): string {
  const result = value[key];
  if (typeof result !== "string" || result.length === 0) {
    throw new Error(`GL-EYE response '${key}' must be a non-empty string.`);
  }
  return result;
}

function optionalString(value: Record<string, unknown>, key: string): string | undefined {
  const result = value[key];
  return typeof result === "string" && result.length > 0 ? result : undefined;
}

function requireNumber(value: Record<string, unknown>, key: string): number {
  const result = value[key];
  if (typeof result !== "number" || !Number.isFinite(result)) {
    throw new Error(`GL-EYE response '${key}' must be a number.`);
  }
  return result;
}

function requireStringArray(value: Record<string, unknown>, key: string): readonly string[] {
  const result = value[key];
  if (!Array.isArray(result) || result.some((item) => typeof item !== "string")) {
    throw new Error(`GL-EYE response '${key}' must be a string array.`);
  }
  return result as string[];
}

function fingerprintJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Target operation cancelled.");
}

async function abortableDelay(milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolveDelay, rejectDelay) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolveDelay();
    }, milliseconds);
    const abort = (): void => {
      clearTimeout(timer);
      rejectDelay(signal?.reason instanceof Error ? signal.reason : new Error("Target operation cancelled."));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function readLimitedResponseBody(response: Response, limit: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.byteLength;
      if (total > limit) {
        throw new Error("GL-EYE test-support response exceeded the configured limit.");
      }
      chunks.push(chunk);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
