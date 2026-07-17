import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

interface Mutations {
  readonly leakControlTenant: boolean;
  readonly duplicateScore: boolean;
  readonly skipHunter: boolean;
  readonly unexpectedEgress: boolean;
}

interface ReferenceRun {
  readonly targetRunId: string;
  readonly platformRunId: string;
  readonly scenarioId: string;
  readonly tenantId: string;
  readonly controlTenantId: string;
  readonly siteId: string;
  readonly ingestionTokenHash: string;
  readonly mutations: Mutations;
  readonly idempotencyKeys: Map<string, string>;
  readonly processedEvents: Set<string>;
  readonly scoreFingerprints: string[];
  readonly providerProvenance: string[];
  readonly warnings: string[];
  vendorEndpoints?: Readonly<Record<string, string>>;
  site?: { readonly siteId: string; readonly hostname: string };
  observationId?: string;
  state: "waiting" | "processing" | "completed" | "failed";
  duplicateEventCount: number;
  companyFingerprint?: string;
  failureCode?: string;
}

export interface ReferenceSutOptions {
  readonly host?: string;
  readonly port?: number;
  readonly serviceToken: string;
  readonly publicOrigin?: string;
  readonly environment?: string;
  readonly fetchImpl?: typeof fetch;
}

export interface ReferenceSutBinding {
  readonly origin: string;
  readonly port: number;
  stop(): Promise<void>;
}

const runs = new Map<string, ReferenceRun>();
const runByIngestionTokenHash = new Map<string, string>();

export async function startReferenceSut(
  options: ReferenceSutOptions,
): Promise<ReferenceSutBinding> {
  if (options.serviceToken.length < 16) {
    throw new Error("Reference SUT service token must contain at least 16 characters.");
  }
  const environment = (options.environment ?? "local").toLowerCase();
  if (!new Set(["local", "test", "testing", "qa"]).has(environment)) {
    throw new Error("Reference SUT is restricted to approved test environments.");
  }
  const host = options.host ?? "127.0.0.1";
  const fetchImpl = options.fetchImpl ?? fetch;
  const server = createServer((request, response) => {
    void handleRequest(request, response, options, fetchImpl).catch((error) => {
      sendJson(response, 500, {
        error: "internal-error",
        errorFingerprint: fingerprint(error instanceof Error ? error.message : String(error)),
      });
    });
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(options.port ?? 0, host, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Reference SUT did not expose a TCP port.");
  }
  const origin = options.publicOrigin ?? `http://${host}:${String(address.port)}`;
  return {
    origin,
    port: address.port,
    stop: async () => {
      runs.clear();
      runByIngestionTokenHash.clear();
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      });
    },
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: ReferenceSutOptions,
  fetchImpl: typeof fetch,
): Promise<void> {
  const url = new URL(request.url ?? "/", options.publicOrigin ?? "http://reference-sut.invalid");
  if (request.method === "GET" && url.pathname === "/v1/health") {
    sendJson(response, 200, { status: "ok", service: "reference-sut" });
    return;
  }
  if (request.method === "GET" && url.pathname === "/test-support/v1/capabilities") {
    authorizeService(request, options.serviceToken);
    sendJson(response, 200, {
      contractVersion: "1.0",
      target: "reference-sut",
      features: {
        tenantIsolation: true,
        idempotency: true,
        mutations: true,
        directTraffic: true,
      },
    });
    return;
  }
  if (request.method === "POST" && url.pathname === "/test-support/v1/runs") {
    authorizeService(request, options.serviceToken);
    const value = await readJsonObject(request);
    const platformRunId = requireString(value, "runId");
    const idempotencyKey = header(request, "idempotency-key") ?? platformRunId;
    const existing = [...runs.values()].find(
      (candidate) => candidate.platformRunId === platformRunId,
    );
    if (existing) {
      sendJson(response, 201, preparedResponse(existing, options));
      return;
    }
    const targetRunId = `reference-${randomUUID()}`;
    const ingestionToken = randomBytes(32).toString("base64url");
    const run: ReferenceRun = {
      targetRunId,
      platformRunId,
      scenarioId: requireString(value, "scenarioId"),
      tenantId: `tenant-alpha-${fingerprint(platformRunId).slice(0, 12)}`,
      controlTenantId: `tenant-beta-${fingerprint(platformRunId).slice(0, 12)}`,
      siteId: `site-${fingerprint(idempotencyKey).slice(0, 12)}`,
      ingestionTokenHash: fingerprint(ingestionToken),
      mutations: readMutations(value.mutations),
      idempotencyKeys: new Map(),
      processedEvents: new Set(),
      scoreFingerprints: [],
      providerProvenance: [],
      warnings: [],
      state: "waiting",
      duplicateEventCount: 0,
    };
    runs.set(targetRunId, run);
    runByIngestionTokenHash.set(run.ingestionTokenHash, targetRunId);
    sendJson(response, 201, preparedResponse(run, options, ingestionToken));
    return;
  }

  const runMatch = /^\/test-support\/v1\/runs\/([^/]+)(.*)$/u.exec(url.pathname);
  if (runMatch) {
    authorizeService(request, options.serviceToken);
    const targetRunId = decodeURIComponent(runMatch[1] ?? "");
    const suffix = runMatch[2] ?? "";
    const run = runs.get(targetRunId);
    if (!run) {
      if (request.method === "DELETE" && suffix === "") {
        response.statusCode = 204;
        response.end();
        return;
      }
      sendJson(response, 404, { error: "target-run-not-found" });
      return;
    }
    if (request.method === "PUT" && suffix === "/vendor-endpoints") {
      const value = await readJsonObject(request);
      const endpoints = requireObject(value, "endpoints");
      run.vendorEndpoints = Object.fromEntries(
        ["ipinfo", "apollo", "hunter"].map((vendorId) => [
          vendorId,
          requireHttpUrl(endpoints, vendorId),
        ]),
      );
      response.statusCode = 204;
      response.end();
      return;
    }
    if (request.method === "PUT" && suffix === "/site") {
      const value = await readJsonObject(request);
      run.site = {
        siteId: requireString(value, "siteId"),
        hostname: requireString(value, "hostname"),
      };
      response.statusCode = 204;
      response.end();
      return;
    }
    if (request.method === "POST" && suffix === "/observations") {
      run.observationId ??= `observation-${randomUUID()}`;
      sendJson(response, 201, { observationId: run.observationId });
      return;
    }
    const observationMatch = /^\/observations\/([^/]+)$/u.exec(suffix);
    if (request.method === "GET" && observationMatch) {
      if (observationMatch[1] !== run.observationId) {
        sendJson(response, 404, { error: "observation-not-found" });
        return;
      }
      sendJson(response, 200, {
        state: run.state,
        completed: run.state === "completed" || run.state === "failed",
        eventCount: run.processedEvents.size,
        ...(run.failureCode ? { failureCode: run.failureCode } : {}),
      });
      return;
    }
    if (request.method === "GET" && suffix === "/outcome") {
      sendJson(response, 200, outcome(run));
      return;
    }
    if (request.method === "GET" && suffix === "/tracking.js") {
      const token = url.searchParams.get("token");
      if (!token || !constantTimeHashMatch(run.ingestionTokenHash, token)) {
        sendJson(response, 401, { error: "ingestion-token-invalid" });
        return;
      }
      response.statusCode = 200;
      response.setHeader("content-type", "application/javascript; charset=utf-8");
      response.setHeader("cache-control", "no-store");
      response.end(trackingScript(targetRunId, token));
      return;
    }
    if (request.method === "DELETE" && suffix === "") {
      runs.delete(targetRunId);
      runByIngestionTokenHash.delete(run.ingestionTokenHash);
      response.statusCode = 204;
      response.end();
      return;
    }
  }

  if (request.method === "POST" && url.pathname === "/test-support/v1/traffic/events") {
    const token = url.searchParams.get("token");
    if (!token) {
      sendJson(response, 401, { error: "ingestion-token-missing" });
      return;
    }
    const targetRunId = runByIngestionTokenHash.get(fingerprint(token));
    const run = targetRunId ? runs.get(targetRunId) : undefined;
    if (!run || !constantTimeHashMatch(run.ingestionTokenHash, token)) {
      sendJson(response, 401, { error: "ingestion-token-invalid" });
      return;
    }
    const value = await readJsonObject(request);
    const suppliedKey = header(request, "idempotency-key");
    const eventId = suppliedKey ?? optionalString(value, "eventId") ?? fingerprint(JSON.stringify(value));
    const existing = run.idempotencyKeys.get(eventId);
    if (existing) {
      run.duplicateEventCount += 1;
      sendJson(response, 202, { eventId: existing, duplicate: true });
      return;
    }
    run.idempotencyKeys.set(eventId, eventId);
    run.state = "processing";
    void processEvent(run, eventId, fetchImpl);
    sendJson(response, 202, { eventId, duplicate: false });
    return;
  }

  sendJson(response, 404, { error: "not-found" });
}

async function processEvent(
  run: ReferenceRun,
  eventId: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  try {
    const endpoints = run.vendorEndpoints;
    if (!endpoints) throw new Error("vendor-endpoints-not-configured");
    await callProvider(fetchImpl, `${endpoints.ipinfo}/198.51.100.25`, {
      headers: { authorization: "Bearer test-token-valid" },
    });
    run.providerProvenance.push("ipinfo");
    await callProvider(fetchImpl, `${endpoints.apollo}/v1/organizations/match`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-token-valid",
        "content-type": "application/json",
      },
      body: JSON.stringify({ domain: "partial.example" }),
    });
    run.providerProvenance.push("apollo");
    if (!run.mutations.skipHunter) {
      await callProvider(
        fetchImpl,
        `${endpoints.hunter}/v2/domain-search?domain=contacts.example`,
        { headers: { authorization: "Bearer test-token-valid" } },
      );
      run.providerProvenance.push("hunter");
    } else {
      run.warnings.push("hunter-skipped-by-mutation");
    }
    if (run.mutations.unexpectedEgress) {
      await fetchImpl("https://unexpected.invalid/egress", {
        redirect: "manual",
      }).catch(() => undefined);
      run.warnings.push("unexpected-egress-attempted");
    }
    run.processedEvents.add(eventId);
    run.companyFingerprint ??= fingerprint("nordlicht-example-gmbh");
    if (run.scoreFingerprints.length === 0) {
      run.scoreFingerprints.push(fingerprint(`score:${run.companyFingerprint}`));
      if (run.mutations.duplicateScore) {
        run.scoreFingerprints.push(fingerprint(`score:${run.companyFingerprint}:duplicate`));
      }
    }
    run.state = "completed";
  } catch (error) {
    run.failureCode = fingerprint(error instanceof Error ? error.message : String(error)).slice(0, 16);
    run.state = "failed";
  }
}

async function callProvider(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<void> {
  let lastStatus = 0;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetchImpl(url, { ...init, redirect: "manual" });
    lastStatus = response.status;
    await response.arrayBuffer();
    if (response.ok) return;
    if (![429, 502, 503, 504].includes(response.status) || attempt === 3) break;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25 * attempt));
  }
  throw new Error(`provider-call-failed-${String(lastStatus)}`);
}

function outcome(run: ReferenceRun): Record<string, unknown> {
  const visibleTenantIds = [run.tenantId];
  if (run.mutations.leakControlTenant) visibleTenantIds.push(run.controlTenantId);
  return {
    targetRunId: run.targetRunId,
    tenantId: run.tenantId,
    visibleTenantIds,
    companyCount: run.companyFingerprint ? 1 : 0,
    scoreCount: run.scoreFingerprints.length,
    processedEventCount: run.processedEvents.size,
    duplicateEventCount: run.duplicateEventCount,
    companyFingerprint: run.companyFingerprint ?? fingerprint("no-company"),
    scoreFingerprints: [...run.scoreFingerprints],
    providerProvenance: [...run.providerProvenance],
    confidence: run.companyFingerprint ? "high" : "low",
    suppressionStatus: "allowed",
    processingWarnings: [...run.warnings],
  };
}

function preparedResponse(
  run: ReferenceRun,
  options: ReferenceSutOptions,
  ingestionToken?: string,
): Record<string, unknown> {
  const origin = options.publicOrigin ?? `http://${options.host ?? "127.0.0.1"}:${String(options.port ?? 8080)}`;
  const token = ingestionToken ?? "redacted-existing-token";
  return {
    targetRunId: run.targetRunId,
    tenantId: run.tenantId,
    controlTenantId: run.controlTenantId,
    trackingScriptUrl: `${origin}/test-support/v1/runs/${encodeURIComponent(run.targetRunId)}/tracking.js?token=${encodeURIComponent(token)}`,
    siteId: run.siteId,
    targetOrigin: origin,
    ingestionToken: token,
  };
}

function trackingScript(targetRunId: string, token: string): string {
  return `(() => {\n  const endpoint = ${JSON.stringify(`/test-support/v1/traffic/events?token=${token}`)};\n  const eventId = ${JSON.stringify(`browser-${targetRunId}`)};\n  fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": eventId }, body: JSON.stringify({ eventId, type: "page-view" }) }).catch(() => undefined);\n})();\n`;
}

function authorizeService(request: IncomingMessage, expected: string): void {
  const value = header(request, "authorization");
  if (!value?.startsWith("Bearer ") || !constantTimeEqual(value.slice(7), expected)) {
    const error = new Error("service-authentication-failed");
    error.name = "UnauthorizedError";
    throw error;
  }
}

function constantTimeHashMatch(expectedHash: string, value: string): boolean {
  return constantTimeEqual(expectedHash, fingerprint(value));
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function readMutations(value: unknown): Mutations {
  const selected = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  return {
    leakControlTenant: selected.leakControlTenant === true,
    duplicateScore: selected.duplicateScore === true,
    skipHunter: selected.skipHunter === true,
    unexpectedEgress: selected.unexpectedEgress === true,
  };
}

async function readJsonObject(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > 256 * 1024) throw new Error("request-body-too-large");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  const value = text.length === 0 ? {} : (JSON.parse(text) as unknown);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("request-body-must-be-object");
  }
  return value as Record<string, unknown>;
}

function requireObject(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const selected = value[key];
  if (!selected || typeof selected !== "object" || Array.isArray(selected)) {
    throw new Error(`${key}-must-be-object`);
  }
  return selected as Record<string, unknown>;
}

function requireString(value: Record<string, unknown>, key: string): string {
  const selected = value[key];
  if (typeof selected !== "string" || selected.length === 0) {
    throw new Error(`${key}-must-be-string`);
  }
  return selected;
}

function optionalString(value: Record<string, unknown>, key: string): string | undefined {
  const selected = value[key];
  return typeof selected === "string" && selected.length > 0 ? selected : undefined;
}

function requireHttpUrl(value: Record<string, unknown>, key: string): string {
  const selected = requireString(value, key);
  const url = new URL(selected);
  if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password || url.hash) {
    throw new Error(`${key}-must-be-http-url`);
  }
  return url.toString().replace(/\/$/u, "");
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
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

async function main(): Promise<void> {
  const serviceToken = process.env.REFERENCE_SUT_SERVICE_TOKEN ?? "reference-sut-token-local";
  const host = process.env.REFERENCE_SUT_HOST ?? "0.0.0.0";
  const port = Number(process.env.REFERENCE_SUT_PORT ?? "8080");
  const publicOrigin = process.env.REFERENCE_SUT_PUBLIC_ORIGIN ?? `http://127.0.0.1:${String(port)}`;
  const binding = await startReferenceSut({
    host,
    port,
    publicOrigin,
    serviceToken,
    environment: process.env.REFERENCE_SUT_ENVIRONMENT ?? "local",
  });
  process.stdout.write(`Reference SUT listening at ${binding.origin}\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
