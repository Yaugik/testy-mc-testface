import { createHash } from "node:crypto";

import type {
  AdapterRunContext,
  CompletionCondition,
  ObservationHandle,
  ObservationResult,
  PreparedTarget,
  SiteDefinition,
  TargetAdapter,
  TargetCapabilities,
  TargetOutcome,
  VendorEndpoints,
} from "@testy/target-adapter";

export interface ReferenceSutTargetAdapterOptions {
  readonly baseUrl: string;
  readonly serviceToken: string;
  readonly environment: string;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly fetchImpl?: typeof fetch;
  readonly mutations?: {
    readonly leakControlTenant?: boolean;
    readonly duplicateScore?: boolean;
    readonly skipHunter?: boolean;
    readonly unexpectedEgress?: boolean;
  };
}

export class ReferenceSutTargetAdapter implements TargetAdapter {
  private readonly baseOrigin: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly prepared = new Map<string, PreparedTarget>();
  private readonly observations = new Map<string, ObservationHandle>();

  public constructor(private readonly options: ReferenceSutTargetAdapterOptions) {
    const environment = options.environment.toLowerCase();
    if (!new Set(["local", "test", "testing", "qa"]).has(environment)) {
      throw new Error("Reference SUT adapter is restricted to approved test environments.");
    }
    if (options.serviceToken.length < 16) {
      throw new Error("Reference SUT service token must contain at least 16 characters.");
    }
    const url = new URL(options.baseUrl);
    if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password) {
      throw new Error("Reference SUT base URL must be an HTTP(S) origin without credentials.");
    }
    this.baseOrigin = url.origin;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxResponseBytes = options.maxResponseBytes ?? 1024 * 1024;
  }

  public async capabilities(): Promise<TargetCapabilities> {
    const value = await this.request("GET", "/test-support/v1/capabilities");
    return {
      contractVersion: requireString(value, "contractVersion"),
      target: requireString(value, "target"),
      features: readBooleanRecord(value, "features"),
    };
  }

  public async prepareRun(context: AdapterRunContext): Promise<PreparedTarget> {
    const existing = this.prepared.get(context.runId);
    if (existing) return existing;
    const value = await this.request(
      "POST",
      "/test-support/v1/runs",
      {
        runId: context.runId,
        scenarioId: context.scenarioId,
        target: context.target,
        environment: this.options.environment,
        ...(this.options.mutations ? { mutations: this.options.mutations } : {}),
      },
      context,
      [201],
      { "idempotency-key": context.runId },
    );
    const prepared: PreparedTarget = {
      targetRunId: requireString(value, "targetRunId"),
      tenantId: requireString(value, "tenantId"),
      controlTenantId: requireString(value, "controlTenantId"),
      trackingScriptUrl: requireUrl(value, "trackingScriptUrl"),
      siteId: requireString(value, "siteId"),
      targetOrigin: requireOrigin(value, "targetOrigin"),
      ingestionToken: requireString(value, "ingestionToken"),
      contractVersion: "1.0",
    };
    this.prepared.set(context.runId, prepared);
    return prepared;
  }

  public async configureVendorEndpoints(
    context: AdapterRunContext,
    endpoints: VendorEndpoints,
  ): Promise<void> {
    await this.request(
      "PUT",
      `/test-support/v1/runs/${encodeURIComponent(this.requirePrepared(context).targetRunId)}/vendor-endpoints`,
      { endpoints },
      context,
      [204],
    );
  }

  public async configureSyntheticSite(
    context: AdapterRunContext,
    site: SiteDefinition,
  ): Promise<SiteDefinition> {
    await this.request(
      "PUT",
      `/test-support/v1/runs/${encodeURIComponent(this.requirePrepared(context).targetRunId)}/site`,
      site,
      context,
      [204],
    );
    return site;
  }

  public async startObservation(context: AdapterRunContext): Promise<ObservationHandle> {
    const prepared = this.requirePrepared(context);
    const value = await this.request(
      "POST",
      `/test-support/v1/runs/${encodeURIComponent(prepared.targetRunId)}/observations`,
      {},
      context,
      [201],
    );
    const handle = {
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
    const prepared = this.requirePrepared(context);
    const observation = this.observations.get(context.runId);
    if (!observation) throw new Error("Reference SUT observation has not been started.");
    const deadline = Date.now() + condition.timeoutMs;
    while (Date.now() <= deadline) {
      throwIfAborted(condition.signal ?? context.signal);
      const value = await this.request(
        "GET",
        `/test-support/v1/runs/${encodeURIComponent(prepared.targetRunId)}/observations/${encodeURIComponent(observation.observationId)}`,
        undefined,
        context,
      );
      const state = requireString(value, "state");
      if (value.completed === true || state === condition.expectedState) {
        return {
          completed: true,
          state,
          observedAt: new Date().toISOString(),
          detailsFingerprint: fingerprint(value),
        };
      }
      await delay(condition.pollIntervalMs, condition.signal ?? context.signal);
    }
    throw new Error(`Reference SUT observation exceeded ${String(condition.timeoutMs)}ms.`);
  }

  public async collectOutcome(context: AdapterRunContext): Promise<TargetOutcome> {
    const prepared = this.requirePrepared(context);
    const value = await this.request(
      "GET",
      `/test-support/v1/runs/${encodeURIComponent(prepared.targetRunId)}/outcome`,
      undefined,
      context,
    );
    return {
      targetRunId: requireString(value, "targetRunId"),
      tenantId: requireString(value, "tenantId"),
      visibleTenantIds: requireStringArray(value, "visibleTenantIds"),
      companyCount: requireNumber(value, "companyCount"),
      scoreCount: requireNumber(value, "scoreCount"),
      processedEventCount: requireNumber(value, "processedEventCount"),
      duplicateEventCount: requireNumber(value, "duplicateEventCount"),
      companyFingerprint: requireHash(value, "companyFingerprint"),
      scoreFingerprints: requireHashArray(value, "scoreFingerprints"),
      providerProvenance: requireStringArray(value, "providerProvenance"),
      confidence: requireEnum(value, "confidence", ["low", "medium", "high"]),
      suppressionStatus: requireEnum(value, "suppressionStatus", ["allowed", "suppressed"]),
      processingWarnings: requireStringArray(value, "processingWarnings"),
      detailsFingerprint: fingerprint(value),
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
    await this.request(
      "DELETE",
      `/test-support/v1/runs/${encodeURIComponent(targetRunId)}`,
      undefined,
      undefined,
      [204],
    );
    for (const [runId, prepared] of this.prepared) {
      if (prepared.targetRunId === targetRunId) {
        this.prepared.delete(runId);
        this.observations.delete(runId);
      }
    }
  }

  private requirePrepared(context: AdapterRunContext): PreparedTarget {
    const prepared = this.prepared.get(context.runId);
    if (!prepared) throw new Error(`Reference SUT run '${context.runId}' is not prepared.`);
    return prepared;
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    context?: AdapterRunContext,
    acceptedStatuses: readonly number[] = [200],
    extraHeaders: Readonly<Record<string, string>> = {},
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const forwardAbort = (): void => controller.abort(context?.signal?.reason);
    context?.signal?.addEventListener("abort", forwardAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(new URL(path, this.baseOrigin), {
        method,
        headers: {
          authorization: `Bearer ${this.options.serviceToken}`,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(context ? { "x-testy-run-id": context.runId } : {}),
          ...extraHeaders,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "manual",
        signal: controller.signal,
      });
      if (!acceptedStatuses.includes(response.status)) {
        throw new Error(`Reference SUT request failed with status ${String(response.status)}.`);
      }
      if (response.status === 204) return {};
      const bytes = await readLimited(response, this.maxResponseBytes);
      const parsed = JSON.parse(bytes.toString("utf8")) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Reference SUT response must be a JSON object.");
      }
      return parsed as Record<string, unknown>;
    } finally {
      clearTimeout(timer);
      context?.signal?.removeEventListener("abort", forwardAbort);
    }
  }
}

function requireString(value: Record<string, unknown>, key: string): string {
  const selected = value[key];
  if (typeof selected !== "string" || selected.length === 0) throw new Error(`${key} must be a non-empty string.`);
  return selected;
}
function requireNumber(value: Record<string, unknown>, key: string): number {
  const selected = value[key];
  if (typeof selected !== "number" || !Number.isFinite(selected)) throw new Error(`${key} must be a number.`);
  return selected;
}
function requireStringArray(value: Record<string, unknown>, key: string): readonly string[] {
  const selected = value[key];
  if (!Array.isArray(selected) || selected.some((item) => typeof item !== "string")) throw new Error(`${key} must be a string array.`);
  return selected;
}
function requireHash(value: Record<string, unknown>, key: string): string {
  const selected = requireString(value, key);
  if (!/^[a-f0-9]{64}$/u.test(selected)) throw new Error(`${key} must be a SHA-256 fingerprint.`);
  return selected;
}
function requireHashArray(value: Record<string, unknown>, key: string): readonly string[] {
  const selected = requireStringArray(value, key);
  if (selected.some((item) => !/^[a-f0-9]{64}$/u.test(item))) throw new Error(`${key} must contain SHA-256 fingerprints.`);
  return selected;
}
function requireUrl(value: Record<string, unknown>, key: string): string {
  const selected = requireString(value, key);
  const url = new URL(selected);
  if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password || url.hash) throw new Error(`${key} must be a safe HTTP(S) URL.`);
  return url.toString();
}
function requireOrigin(value: Record<string, unknown>, key: string): string {
  const selected = requireUrl(value, key);
  const url = new URL(selected);
  if (url.pathname !== "/" || url.search) throw new Error(`${key} must be an origin.`);
  return url.origin;
}
function requireEnum<T extends string>(value: Record<string, unknown>, key: string, allowed: readonly T[]): T {
  const selected = requireString(value, key);
  if (!allowed.includes(selected as T)) throw new Error(`${key} is invalid.`);
  return selected as T;
}
function readBooleanRecord(value: Record<string, unknown>, key: string): Readonly<Record<string, boolean>> {
  const selected = value[key];
  if (!selected || typeof selected !== "object" || Array.isArray(selected)) throw new Error(`${key} must be an object.`);
  const entries = Object.entries(selected);
  if (entries.some(([, item]) => typeof item !== "boolean")) throw new Error(`${key} must contain booleans.`);
  return Object.fromEntries(entries) as Readonly<Record<string, boolean>>;
}
function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Target operation cancelled.");
}
async function delay(milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolveDelay, rejectDelay) => {
    const timer = setTimeout(resolveDelay, milliseconds);
    const abort = (): void => {
      clearTimeout(timer);
      rejectDelay(signal?.reason instanceof Error ? signal.reason : new Error("Target operation cancelled."));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}
async function readLimited(response: Response, limit: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    total += chunk.byteLength;
    if (total > limit) throw new Error("Reference SUT response exceeded the configured limit.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
