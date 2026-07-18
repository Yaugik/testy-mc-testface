import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export interface ReferenceSutMutations {
  readonly leakToControlTenant?: boolean;
  readonly duplicateScores?: boolean;
  readonly skipEnrichment?: boolean;
}

export interface ReferenceSutOptions {
  readonly authToken: string;
  readonly host?: string;
  readonly port?: number;
  readonly publicOrigin?: string;
  readonly mutations?: ReferenceSutMutations;
  readonly fetchImpl?: typeof fetch;
}

export interface ReferenceSutBinding {
  readonly origin: string;
  readonly server: Server;
  stop(): Promise<void>;
}

interface TargetRun {
  readonly targetRunId: string;
  readonly platformRunId: string;
  readonly tenantId: string;
  readonly controlTenantId: string;
  readonly siteId: string;
  vendorEndpoints: Record<string, string>;
  observationId?: string;
  eventIds: Set<string>;
  idempotencyKeys: Set<string>;
  retryAttempts: number;
  burstActive: number;
  burstMaximum: number;
  companyCount: number;
  scoreCount: number;
  duplicateEventCount: number;
  providerCalls: string[];
  completed: boolean;
}

interface RequestContext {
  readonly authToken: string;
  readonly fetchImpl: typeof fetch;
  readonly mutations: ReferenceSutMutations;
  readonly origin: () => string;
  readonly runs: Map<string, TargetRun>;
}

export async function startReferenceSut(options: ReferenceSutOptions): Promise<ReferenceSutBinding> {
  if (options.authToken.length < 16) {
    throw new Error("Reference SUT token must contain at least 16 characters.");
  }
  const host = options.host ?? "127.0.0.1";
  const runs = new Map<string, TargetRun>();
  let origin = options.publicOrigin;
  const server = createServer((request, response) => {
    void handleRequest(request, response, {
      authToken: options.authToken,
      fetchImpl: options.fetchImpl ?? fetch,
      mutations: options.mutations ?? {},
      origin: () => origin ?? "http://127.0.0.1",
      runs,
    }).catch(() => {
      if (!response.headersSent) sendJson(response, 500, { error: "internal-error" });
      else response.destroy();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Reference SUT did not expose a TCP port.");
  }
  origin ??= `http://${host}:${address.port}`;
  return {
    origin,
    server,
    stop: async () => new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
): Promise<void> {
  const url = new URL(request.url ?? "/", context.origin());
  if (request.method === "GET" && url.pathname === "/v1/health") {
    return sendJson(response, 200, {
      status: "ok",
      service: "reference-sut",
      contractVersion: "1.0",
    });
  }

  const tracking = /^\/test-support\/v1\/runs\/([^/]+)\/tracking\.js$/u.exec(url.pathname);
  if (request.method === "GET" && tracking) {
    const run = context.runs.get(decodeURIComponent(tracking[1] ?? ""));
    if (!run) return sendJson(response, 404, { error: "run-not-found" });
    const ingestionUrl = `${context.origin()}/test-support/v1/traffic/idempotent?targetRunId=${encodeURIComponent(run.targetRunId)}`;
    response.statusCode = 200;
    response.setHeader("content-type", "application/javascript; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    response.end(`fetch(${JSON.stringify(ingestionUrl)},{method:"POST",headers:{"content-type":"application/json","idempotency-key":${JSON.stringify(`tracking-${run.targetRunId}`)}},body:JSON.stringify({eventId:${JSON.stringify(`tracking-${run.targetRunId}`)}})});`);
    return;
  }

  const traffic = /^\/test-support\/v1\/traffic\/([^/]+)$/u.exec(url.pathname);
  if (traffic) {
    await handleTraffic(traffic[1] ?? "", request, response, url, context);
    return;
  }

  if (!authorized(request, context.authToken)) {
    response.setHeader("www-authenticate", "Bearer");
    return sendJson(response, 401, { error: "unauthorized" });
  }

  if (request.method === "POST" && url.pathname === "/test-support/v1/runs") {
    const body = await readJson(request);
    const platformRunId = requiredString(body, "runId");
    const targetRunId = `reference-${platformRunId}`;
    let run = context.runs.get(targetRunId);
    if (!run) {
      const suffix = fingerprint(platformRunId).slice(0, 12);
      run = {
        targetRunId,
        platformRunId,
        tenantId: `tenant-primary-${suffix}`,
        controlTenantId: `tenant-control-${suffix}`,
        siteId: `site-${suffix}`,
        vendorEndpoints: {},
        eventIds: new Set(),
        idempotencyKeys: new Set(),
        retryAttempts: 0,
        burstActive: 0,
        burstMaximum: 0,
        companyCount: 0,
        scoreCount: 0,
        duplicateEventCount: 0,
        providerCalls: [],
        completed: false,
      };
      context.runs.set(targetRunId, run);
    }
    return sendJson(response, 201, {
      targetRunId,
      tenantId: run.tenantId,
      controlTenantId: run.controlTenantId,
      trackingScriptUrl: `${context.origin()}/test-support/v1/runs/${encodeURIComponent(targetRunId)}/tracking.js`,
      siteId: run.siteId,
      targetOrigin: context.origin(),
      contractVersion: "1.0",
    });
  }

  const runPath = /^\/test-support\/v1\/runs\/([^/]+)(?:\/(.*))?$/u.exec(url.pathname);
  if (!runPath) return sendJson(response, 404, { error: "not-found" });
  const targetRunId = decodeURIComponent(runPath[1] ?? "");
  const suffix = runPath[2] ?? "";
  const run = context.runs.get(targetRunId);
  if (!run) return sendJson(response, 404, { error: "run-not-found" });

  if (request.method === "PUT" && suffix === "vendor-endpoints") {
    const body = await readJson(request);
    run.vendorEndpoints = readEndpointMap(body.endpoints);
    response.statusCode = 204;
    response.end();
    return;
  }
  if (request.method === "PUT" && suffix === "site") {
    await readJson(request);
    response.statusCode = 204;
    response.end();
    return;
  }
  if (request.method === "POST" && suffix === "observations") {
    run.observationId ??= randomUUID();
    return sendJson(response, 201, { observationId: run.observationId });
  }
  const observation = /^observations\/([^/]+)$/u.exec(suffix);
  if (request.method === "GET" && observation) {
    if (observation[1] !== run.observationId) {
      return sendJson(response, 404, { error: "observation-not-found" });
    }
    return sendJson(response, 200, {
      completed: run.completed,
      state: run.completed ? "completed" : "processing",
      processedEventCount: run.eventIds.size,
    });
  }
  if (request.method === "GET" && suffix === "outcome") {
    const visibleTenantIds = [run.tenantId];
    if (context.mutations.leakToControlTenant) visibleTenantIds.push(run.controlTenantId);
    return sendJson(response, 200, {
      targetRunId,
      visibleTenantIds,
      companyCount: run.companyCount,
      scoreCount: run.scoreCount,
      duplicateEventCount: run.duplicateEventCount,
      companyFingerprint: fingerprint("Nordlicht Example GmbH"),
      scoreRuleVersion: "reference-score-v1",
      enrichmentStatus: context.mutations.skipEnrichment ? "skipped" : "completed",
      providerSequence: run.providerCalls,
      maximumBurstConcurrency: run.burstMaximum,
    });
  }
  if (request.method === "DELETE" && suffix === "") {
    context.runs.delete(targetRunId);
    response.statusCode = 204;
    response.end();
    return;
  }
  sendJson(response, 404, { error: "not-found" });
}

async function handleTraffic(
  operation: string,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: RequestContext,
): Promise<void> {
  if (operation === "malformed-json") {
    const text = await readText(request);
    try {
      JSON.parse(text);
      return sendJson(response, 422, { error: "expected-malformed-json" });
    } catch {
      return sendJson(response, 400, { error: "malformed-json" });
    }
  }
  if (operation === "malformed-form") {
    await readText(request);
    return sendJson(response, 422, { error: "malformed-form" });
  }
  if (operation === "slow") {
    await delay(200);
    response.statusCode = 204;
    response.end();
    return;
  }
  const run = selectTrafficRun(url, request, context.runs);
  if (!run) return sendJson(response, 404, { error: "run-not-found" });
  if (operation === "attribution") {
    response.setHeader("x-reference-source-fingerprint", fingerprint(String(request.headers["x-forwarded-for"] ?? "missing")));
    response.statusCode = 204;
    response.end();
    return;
  }
  if (operation === "burst") {
    run.burstActive += 1;
    run.burstMaximum = Math.max(run.burstMaximum, run.burstActive);
    await delay(25);
    run.burstActive -= 1;
    response.statusCode = 204;
    response.end();
    return;
  }
  if (operation === "retry") {
    run.retryAttempts += 1;
    if (run.retryAttempts < 3) return sendJson(response, 503, { error: "transient-unavailable" });
  }
  if (operation !== "idempotent" && operation !== "retry") {
    response.statusCode = 204;
    response.end();
    return;
  }
  const body = await readJson(request);
  const eventId = requiredString(body, "eventId");
  const idempotencyKey = String(request.headers["idempotency-key"] ?? eventId);
  if (run.idempotencyKeys.has(idempotencyKey) || run.eventIds.has(eventId)) {
    run.duplicateEventCount += 1;
    if (context.mutations.duplicateScores) run.scoreCount += 1;
    return sendJson(response, 409, { error: "duplicate-event" });
  }
  run.idempotencyKeys.add(idempotencyKey);
  run.eventIds.add(eventId);
  await executeProviderFlow(run, context.fetchImpl, context.mutations.skipEnrichment === true);
  run.companyCount = 1;
  run.scoreCount += 1;
  run.completed = true;
  sendJson(response, 202, { accepted: true });
}

async function executeProviderFlow(run: TargetRun, fetchImpl: typeof fetch, skipEnrichment: boolean): Promise<void> {
  const calls: ReadonlyArray<readonly [string, string]> = [
    ["ipinfo", "198.51.100.25"],
    ["apollo", "v1/organizations/enrich?domain=nordlicht.example"],
    ["hunter", "v2/domain-search?domain=nordlicht.example"],
  ];
  for (const [vendor, relativePath] of calls) {
    if (skipEnrichment && vendor !== "ipinfo") continue;
    const endpoint = run.vendorEndpoints[vendor];
    if (!endpoint) continue;
    const response = await fetchImpl(new URL(relativePath, ensureTrailingSlash(endpoint)), {
      headers: { "x-testy-correlation-id": `${run.platformRunId}:${vendor}` },
      redirect: "manual",
    });
    run.providerCalls.push(vendor);
    if (!response.ok) throw new Error(`Reference provider '${vendor}' returned HTTP ${response.status}.`);
    await response.body?.cancel();
  }
}

function selectTrafficRun(
  url: URL,
  request: IncomingMessage,
  runs: ReadonlyMap<string, TargetRun>,
): TargetRun | undefined {
  const selected = url.searchParams.get("targetRunId") ?? String(request.headers["x-reference-target-run-id"] ?? "");
  if (selected) return runs.get(selected);
  return runs.size === 1 ? [...runs.values()][0] : undefined;
}

function authorized(request: IncomingMessage, expected: string): boolean {
  const supplied = request.headers.authorization?.replace(/^Bearer\s+/iu, "") ?? "";
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const value = JSON.parse((await readText(request)) || "{}") as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

async function readText(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += value.byteLength;
    if (total > 64 * 1024) throw new Error("Request body exceeded 64 KiB.");
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function readEndpointMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Vendor endpoints must be an object.");
  }
  const result: Record<string, string> = {};
  for (const [key, endpoint] of Object.entries(value)) {
    if (typeof endpoint !== "string") throw new Error("Vendor endpoint must be a string.");
    const url = new URL(endpoint);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Vendor endpoint must use HTTP or HTTPS.");
    }
    result[key] = url.toString();
  }
  return result;
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const selected = value[key];
  if (typeof selected !== "string" || selected.length === 0 || selected.length > 300) {
    throw new Error(`'${key}' must be a bounded non-empty string.`);
  }
  return selected;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(body));
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
