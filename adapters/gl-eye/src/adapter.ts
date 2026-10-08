import { createHash } from "node:crypto";

import type { RunId } from "@testy/shared-types";
import type {
  AdapterRunContext,
  CompletionCondition,
  DemoWorkspaceAccount,
  DemoWorkspaceAccounts,
  GeneratedDemoWorkspaceAccount,
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
  readonly triggerEnrichment: string;
  readonly outcome: string;
  readonly cleanup: string;
  readonly hibernate: string;
  readonly resume: string;
  readonly demoAccounts: string;
  readonly demoAccount: string;
}

export const defaultGlEyeTestSupportEndpoints: GlEyeEndpointTemplates = {
  prepareRun: "/test-support/v1/runs",
  configureVendors: "/test-support/v1/runs/{targetRunId}/vendor-endpoints",
  configureSite: "/test-support/v1/runs/{targetRunId}/site",
  startObservation: "/test-support/v1/runs/{targetRunId}/observations",
  observationStatus: "/test-support/v1/runs/{targetRunId}/observations/{observationId}",
  triggerEnrichment: "/test-support/v1/runs/{targetRunId}/enrichment",
  outcome: "/test-support/v1/runs/{targetRunId}/outcome",
  cleanup: "/test-support/v1/runs/{targetRunId}",
  hibernate: "/test-support/v1/runs/{targetRunId}/hibernate",
  resume: "/test-support/v1/runs/{targetRunId}/resume",
  demoAccounts: "/test-support/v1/runs/{targetRunId}/accounts",
  demoAccount: "/test-support/v1/runs/{targetRunId}/accounts/{accountId}",
};

/** A safe, typed target HTTP error. Never includes raw response bodies. */
export class GlEyeTestSupportError extends Error {
  public readonly targetStatus: number;
  public readonly operation: GlEyeRequestOperation;

  public constructor(
    targetStatus: number,
    message?: string,
    operation: GlEyeRequestOperation = "unknown",
  ) {
    super(message ?? `GL-EYE test-support request failed with status ${targetStatus}.`);
    this.name = "GlEyeTestSupportError";
    this.targetStatus = targetStatus;
    this.operation = operation;
  }
}

/** Static operation codes only. No URL parameters, credentials or raw messages. */
export type GlEyeRequestOperation =
  | "prepare-workspace"
  | "configure-site"
  | "configure-vendors"
  | "manage-accounts"
  | "start-observation"
  | "resume-workspace"
  | "pause-workspace"
  | "delete-workspace"
  | "unknown";

function requestOperation(method: string, endpoint: string): GlEyeRequestOperation {
  if (method === "POST" && endpoint === "/test-support/v1/runs") return "prepare-workspace";
  if (endpoint.endsWith("/site")) return "configure-site";
  if (endpoint.endsWith("/vendor-endpoints")) return "configure-vendors";
  if (endpoint.includes("/accounts")) return "manage-accounts";
  if (endpoint.includes("/observations")) return "start-observation";
  if (endpoint.endsWith("/resume")) return "resume-workspace";
  if (endpoint.endsWith("/hibernate")) return "pause-workspace";
  if (method === "DELETE" && /^\/test-support\/v1\/runs\/[^/]+$/u.test(endpoint)) return "delete-workspace";
  return "unknown";
}

const safeTargetMessages = new Set([
  "Shared Testy demo accounts are not seeded. Run ./bin/seed-demo first.",
  "Exclusive demo sessions require a dedicated session administrator.",
  "Interactive Demo requires a session id and demo credential.",
  "Demo access fields are only valid for Interactive Demo runs.",
  "Demo account access options require an Interactive Demo run.",
  "Interactive Demo login provisioning is restricted to local and testing environments.",
  "Demo account email is already in use.",
  "Synthetic site origin must match the configured hostname.",
]);

const allowedValidationFields = new Set([
  "demoSessionId", "demoCredential", "demoCredential.mode",
  "demoCredential.email", "demoCredential.password",
  "shareSeededDemoAccounts", "runId", "scenarioId", "environment",
  "target", "hostname", "origin",
]);

async function safeTargetValidationMessage(
  response: Response,
  maxBytes: number,
): Promise<string | undefined> {
  try {
    const raw = await readLimitedResponseBody(response, Math.min(maxBytes, 4096));
    const parsed: unknown = JSON.parse(raw.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const body = parsed as Record<string, unknown>;
    if (typeof body.message === "string" && safeTargetMessages.has(body.message)) {
      return body.message;
    }
    if (body.errors && typeof body.errors === "object" && !Array.isArray(body.errors)) {
      const fields = Object.keys(body.errors).filter((field) => allowedValidationFields.has(field));
      if (fields.length > 0) return `GL-EYE rejected demo fields: ${fields.join(", ")}.`;
    }
  } catch {
    // Never surface raw GL-EYE error pages, stack traces or credentials.
  }
  return undefined;
}

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
  private readonly enrichmentTriggered = new Set<RunId>();

  public constructor(private readonly options: GlEyeTargetAdapterOptions) {
    this.baseOrigin = normalizeAllowedOrigin(options.baseUrl, options.allowedOrigins);
    const approved = new Set(
      (options.approvedEnvironments ?? ["local", "test", "testing", "qa", "staging"]).map((value) =>
        value.toLowerCase(),
      ),
    );
    if (
      !approved.has(options.environment.toLowerCase()) ||
      options.environment.toLowerCase() === "production"
    ) {
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
        ...(context.demoSessionId ? { demoSessionId: context.demoSessionId } : {}),
        ...(context.demoCredential ? { demoCredential: context.demoCredential } : {}),
        ...(context.shareSeededDemoAccounts === undefined ? {} : {
          shareSeededDemoAccounts: context.shareSeededDemoAccounts,
        }),
      },
      [200, 201],
    );
    const controlTenantId = optionalString(value, "controlTenantId");
    const ingestionToken = optionalString(value, "ingestionToken");
    const prepared: PreparedTarget = {
      targetRunId: requireString(value, "targetRunId"),
      tenantId: requireString(value, "tenantId"),
      ...(controlTenantId ? { controlTenantId } : {}),
      trackingScriptUrl: rebaseTrackingScriptUrl(
        requireString(value, "trackingScriptUrl"),
        this.baseOrigin,
      ),
      siteId: requireString(value, "siteId"),
      targetOrigin: this.baseOrigin,
      ...(ingestionToken ? { ingestionToken } : {}),
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
      {
        hostname: site.hostname,
        ...(site.origin ? { origin: site.origin } : {}),
      },
      [200, 204],
    );
    return site;
  }

  public async triggerEnrichment(
    context: AdapterRunContext,
    options: { readonly since?: string } = {},
  ): Promise<void> {
    const prepared = this.requirePrepared(context.runId);
    await this.requestJson(
      "POST",
      withSince(
        expandEndpoint(this.endpoints.triggerEnrichment, prepared.targetRunId),
        options.since,
      ),
      context,
      {},
      [200, 202],
    );
    this.enrichmentTriggered.add(context.runId);
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
      const completed =
        value.completed === true ||
        (condition.expectedState !== undefined && state === condition.expectedState);
      if (completed) {
        if (!this.enrichmentTriggered.has(context.runId)) {
          await this.requestJson(
            "POST",
            expandEndpoint(this.endpoints.triggerEnrichment, prepared.targetRunId),
            context,
            {},
            [200, 202],
          );
          this.enrichmentTriggered.add(context.runId);
        }

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

  public async collectOutcome(
    context: AdapterRunContext,
    options: { readonly since?: string } = {},
  ): Promise<TargetOutcome> {
    const prepared = this.requirePrepared(context.runId);
    const value = await this.requestJson(
      "GET",
      withSince(
        expandEndpoint(this.endpoints.outcome, prepared.targetRunId),
        options.since,
      ),
      context,
    );
    const enrichedCompanyCount = optionalNumber(value, "enrichedCompanyCount");
    const contactCount = optionalNumber(value, "contactCount");
    const processedEventCount = optionalNumber(value, "processedEventCount");
    const duplicateEventCount = optionalNumber(value, "duplicateEventCount");
    const companyFingerprint = optionalString(value, "companyFingerprint");
    const companies = optionalCompanyArray(value, "companies");
    const scoreFingerprints = optionalStringArray(value, "scoreFingerprints");
    const providerProvenance = optionalStringArray(value, "providerProvenance");
    const confidence = optionalEnum(value, "confidence", ["low", "medium", "high"] as const);
    const suppressionStatus = optionalEnum(
      value,
      "suppressionStatus",
      ["allowed", "suppressed"] as const,
    );
    const processingWarnings = optionalStringArray(value, "processingWarnings");

    return {
      targetRunId: prepared.targetRunId,
      tenantId: prepared.tenantId,
      visibleTenantIds: requireStringArray(value, "visibleTenantIds"),
      scoreCount: requireNumber(value, "scoreCount"),
      companyCount: requireNumber(value, "companyCount"),
      ...(enrichedCompanyCount === undefined ? {} : { enrichedCompanyCount }),
      ...(contactCount === undefined ? {} : { contactCount }),
      ...(processedEventCount === undefined ? {} : { processedEventCount }),
      ...(duplicateEventCount === undefined ? {} : { duplicateEventCount }),
      ...(companyFingerprint ? { companyFingerprint } : {}),
      ...(companies ? { companies } : {}),
      ...(scoreFingerprints ? { scoreFingerprints } : {}),
      ...(providerProvenance ? { providerProvenance } : {}),
      ...(confidence ? { confidence } : {}),
      ...(suppressionStatus ? { suppressionStatus } : {}),
      ...(processingWarnings ? { processingWarnings } : {}),
      detailsFingerprint: fingerprintJson(value),
    };
  }

  public async hibernateTarget(targetRunId: string): Promise<void> {
    await this.requestJson(
      "POST",
      expandEndpoint(this.endpoints.hibernate, targetRunId),
      undefined,
      undefined,
      [200, 204],
    );
    // Resume must re-check GL-EYE instead of returning cached preparation.
    for (const [runId, prepared] of this.prepared) {
      if (prepared.targetRunId === targetRunId) {
        this.prepared.delete(runId);
        this.observations.delete(runId);
        this.enrichmentTriggered.delete(runId);
      }
    }
  }

  public async resumeTarget(targetRunId: string): Promise<void> {
    await this.requestJson(
      "POST",
      expandEndpoint(this.endpoints.resume, targetRunId),
      undefined,
      undefined,
      [200, 204],
    );
  }

  public async listDemoUsers(targetRunId: string): Promise<DemoWorkspaceAccounts> {
    const result = await this.requestJson(
      "GET", expandEndpoint(this.endpoints.demoAccounts, targetRunId),
      undefined, undefined, [200],
    );
    if (!Array.isArray(result.accounts) || typeof result.shareSeededDemoAccounts !== "boolean") {
      throw new Error("GL-EYE returned an invalid demo account listing.");
    }
    return {
      targetRunId,
      shareSeededDemoAccounts: result.shareSeededDemoAccounts,
      hibernated: result.hibernated === true,
      accounts: result.accounts.map(parseDemoAccount),
    };
  }

  public async createDemoUser(
    targetRunId: string,
    role: "admin" | "sales" | "read_only",
  ): Promise<GeneratedDemoWorkspaceAccount> {
    const result = await this.requestJson(
      "POST", expandEndpoint(this.endpoints.demoAccounts, targetRunId),
      undefined, { role }, [201],
    );
    if (!result.account || typeof result.account !== "object" || Array.isArray(result.account)
        || !result.credentials || typeof result.credentials !== "object"
        || Array.isArray(result.credentials)) {
      throw new Error("GL-EYE returned an invalid generated demo account.");
    }
    const credentials = result.credentials as Record<string, unknown>;
    return {
      account: parseDemoAccount(result.account),
      credentials: {
        email: requireString(credentials, "email"),
        password: requireString(credentials, "password"),
      },
    };
  }

  public async revokeDemoUser(targetRunId: string, accountId: string): Promise<void> {
    await this.requestJson(
      "DELETE",
      expandEndpoint(this.endpoints.demoAccount, targetRunId)
        .replaceAll("{accountId}", encodeURIComponent(accountId)),
      undefined, undefined, [200],
    );
  }

  public async cleanupRun(context: AdapterRunContext): Promise<void> {
    const prepared = this.prepared.get(context.runId);
    if (!prepared) return;
    await this.cleanupTarget(prepared.targetRunId);
    this.prepared.delete(context.runId);
    this.observations.delete(context.runId);
    this.enrichmentTriggered.delete(context.runId);
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
        this.enrichmentTriggered.delete(runId);
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
        const operation = requestOperation(method, endpoint);
        if (response.status === 422 || response.status === 409) {
          const reason = await safeTargetValidationMessage(response, this.maxResponseBytes);
          throw new GlEyeTestSupportError(response.status, reason, operation);
        }
        throw new GlEyeTestSupportError(response.status, undefined, operation);
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

function rebaseTrackingScriptUrl(value: string, baseOrigin: string): string {
  const advertised = new URL(value);
  if (!["http:", "https:"].includes(advertised.protocol)) {
    throw new Error("GL-EYE tracking script URL must use HTTP(S).");
  }
  const target = new URL(baseOrigin);
  target.pathname = advertised.pathname;
  target.search = advertised.search;
  target.hash = "";
  return target.toString();
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

function parseDemoAccount(raw: unknown): DemoWorkspaceAccount {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("GL-EYE returned an invalid demo account.");
  }
  const row = raw as Record<string, unknown>;
  const role = optionalEnum(row, "role", ["admin", "sales", "read_only"] as const);
  const kind = optionalEnum(row, "kind", ["seeded", "protected_admin", "managed", "external"] as const);
  if (!role || !kind || typeof row.removable !== "boolean") {
    throw new Error("GL-EYE returned invalid demo account permissions.");
  }
  return {
    id: requireString(row, "id"),
    userId: requireString(row, "userId"),
    email: requireString(row, "email"),
    role,
    kind,
    removable: row.removable,
  };
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

function optionalNumber(value: Record<string, unknown>, key: string): number | undefined {
  const result = value[key];
  return typeof result === "number" && Number.isFinite(result) ? result : undefined;
}

function optionalStringArray(
  value: Record<string, unknown>,
  key: string,
): readonly string[] | undefined {
  const result = value[key];
  return Array.isArray(result) && result.every((item) => typeof item === "string")
    ? result as string[]
    : undefined;
}

function optionalEnum<const T extends readonly string[]>(
  value: Record<string, unknown>,
  key: string,
  allowed: T,
): T[number] | undefined {
  const result = value[key];
  return typeof result === "string" && allowed.includes(result as T[number])
    ? result as T[number]
    : undefined;
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
  if (signal?.aborted)
    throw signal.reason instanceof Error ? signal.reason : new Error("Target operation cancelled.");
}

async function abortableDelay(
  milliseconds: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolveDelay, rejectDelay) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolveDelay();
    }, milliseconds);
    const abort = (): void => {
      clearTimeout(timer);
      rejectDelay(
        signal?.reason instanceof Error ? signal.reason : new Error("Target operation cancelled."),
      );
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


function optionalCompanyArray(
  value: Record<string, unknown>,
  key: string,
):
  | readonly {
      readonly domain: string;
      readonly displayName: string;
      readonly score: number;
      readonly confidence: string;
      readonly visibility: string;
    }[]
  | undefined {
  const selected = value[key];
  if (!Array.isArray(selected)) return undefined;
  const companies = [];
  for (const item of selected) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
    const record = item as Record<string, unknown>;
    if (
      typeof record.domain !== "string" ||
      typeof record.displayName !== "string" ||
      typeof record.score !== "number" ||
      !Number.isFinite(record.score) ||
      typeof record.confidence !== "string" ||
      typeof record.visibility !== "string"
    ) {
      return undefined;
    }
    companies.push({
      domain: record.domain,
      displayName: record.displayName,
      score: record.score,
      confidence: record.confidence,
      visibility: record.visibility,
    });
  }
  return companies;
}


function withSince(endpoint: string, since: string | undefined): string {
  if (!since) return endpoint;
  const separator = endpoint.includes("?") ? "&" : "?";
  return `${endpoint}${separator}since=${encodeURIComponent(since)}`;
}
