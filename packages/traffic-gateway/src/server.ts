import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { TLSSocket } from "node:tls";

import { fingerprint, tokenMatches } from "./crypto.js";
import { GatewayError, gatewayError } from "./errors.js";
import { prepareForwardHeaders, prepareResponseHeaders } from "./headers.js";
import { InMemoryGatewayRouteRegistry } from "./registry.js";
import type {
  GatewayRouteRegistry,
  TrafficGatewayBinding,
  TrafficGatewayOptions,
} from "./types.js";

const DEFAULT_REQUEST_LIMIT = 1024 * 1024;
const DEFAULT_RESPONSE_LIMIT = 1024 * 1024;

export async function startTrafficGateway(
  options: TrafficGatewayOptions,
): Promise<TrafficGatewayBinding> {
  if (options.adminToken.length < 16) {
    throw gatewayError("admin-token-too-short", 500, "Traffic gateway admin token must be at least 16 characters.");
  }
  const host = options.host ?? "127.0.0.1";
  const registry = new InMemoryGatewayRouteRegistry({
    allowedTargetOrigins: options.allowedTargetOrigins,
    ...(options.blockedProviderHosts ? { blockedProviderHosts: options.blockedProviderHosts } : {}),
    ...(options.maxRouteTtlMs ? { maxRouteTtlMs: options.maxRouteTtlMs } : {}),
  });
  let publicOrigin = "";
  const server = createServer((request, response) => {
    void handleRequest(request, response, registry, publicOrigin, options).catch((error) => {
      sendError(response, error);
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
    throw new Error("Traffic gateway did not expose a TCP port.");
  }
  publicOrigin = `http://${host}:${address.port}`;
  return {
    origin: publicOrigin,
    registry,
    stop: async () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      }),
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  registry: GatewayRouteRegistry,
  publicOrigin: string,
  options: TrafficGatewayOptions,
): Promise<void> {
  const url = new URL(request.url ?? "/", publicOrigin || "http://gateway.test");
  if (request.method === "GET" && url.pathname === "/v1/health") {
    sendJson(response, 200, { status: "ok", service: "traffic-gateway" });
    return;
  }
  if (url.pathname.startsWith("/v1/routes")) {
    assertAdmin(request, options.adminToken);
    await handleAdmin(request, response, url, registry, publicOrigin);
    return;
  }
  const match = /^\/v1\/proxy\/([^/]+)(\/.*)?$/u.exec(url.pathname);
  if (!match) throw gatewayError("not-found", 404, "Route was not found.");
  const routeId = decodeURIComponent(match[1] ?? "");
  const route = registry.authorize(
    routeId,
    readHeader(request, "x-testy-route-token"),
    readHeader(request, "x-testy-run-id"),
  );
  const startedAt = Date.now();
  const requestBody = await readBody(request, options.maxRequestBodyBytes ?? DEFAULT_REQUEST_LIMIT);
  const path = match[2] ?? "/";
  const target = new URL(route.targetOrigin);
  target.pathname = path;
  target.search = url.search;
  const requestBodyFingerprint = requestBody.byteLength > 0 ? fingerprint(requestBody) : undefined;
  try {
    const forwarded = prepareForwardHeaders(
      toHeaders(request.headers),
      route.syntheticIp,
      (request.socket as TLSSocket).encrypted ? "https" : "http",
    );
    const fetchImpl = options.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.requestTimeoutMs ?? 30_000);
    let targetResponse: Response;
    try {
      targetResponse = await fetchImpl(target, {
        method: request.method ?? "GET",
        headers: forwarded,
        redirect: "manual",
        signal: controller.signal,
        ...((request.method === "GET" || request.method === "HEAD" || requestBody.byteLength === 0)
          ? {}
          : { body: requestBody }),
      });
    } finally {
      clearTimeout(timer);
    }
    const body = await readResponseBody(
      targetResponse,
      options.maxResponseBodyBytes ?? DEFAULT_RESPONSE_LIMIT,
    );
    response.statusCode = targetResponse.status;
    for (const [name, value] of prepareResponseHeaders(targetResponse.headers).entries()) {
      response.setHeader(name, value);
    }
    response.end(body);
    registry.record({
      routeId,
      runId: route.runId,
      method: request.method ?? "GET",
      pathFingerprint: fingerprint(path),
      targetOriginFingerprint: route.targetOriginFingerprint,
      syntheticIpFingerprint: route.syntheticIpFingerprint,
      ...(requestBodyFingerprint ? { requestBodyFingerprint } : {}),
      statusCode: targetResponse.status,
      durationMs: Date.now() - startedAt,
      outcome: "forwarded",
    });
  } catch (error) {
    registry.record({
      routeId,
      runId: route.runId,
      method: request.method ?? "GET",
      pathFingerprint: fingerprint(path),
      targetOriginFingerprint: route.targetOriginFingerprint,
      syntheticIpFingerprint: route.syntheticIpFingerprint,
      ...(requestBodyFingerprint ? { requestBodyFingerprint } : {}),
      durationMs: Date.now() - startedAt,
      outcome: "failed",
      reason: error instanceof GatewayError ? error.code : "target-request-failed",
    });
    throw error;
  }
}

async function handleAdmin(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  registry: GatewayRouteRegistry,
  publicOrigin: string,
): Promise<void> {
  if (request.method === "POST" && url.pathname === "/v1/routes") {
    const value = await readJson(request, 64 * 1024);
    const input = readCreateRouteInput(value);
    sendJson(response, 201, registry.createRoute(input, publicOrigin));
    return;
  }
  const match = /^\/v1\/routes\/([^/]+)(?:\/(ledger))?$/u.exec(url.pathname);
  if (!match) throw gatewayError("not-found", 404, "Admin route was not found.");
  const routeId = decodeURIComponent(match[1] ?? "");
  if (request.method === "DELETE" && !match[2]) {
    registry.deleteRoute(routeId);
    response.statusCode = 204;
    response.end();
    return;
  }
  if (request.method === "GET" && match[2] === "ledger") {
    sendJson(response, 200, { routeId, entries: registry.listLedger(routeId) });
    return;
  }
  throw gatewayError("method-not-allowed", 405, "Method is not allowed.");
}

function assertAdmin(request: IncomingMessage, adminToken: string): void {
  const token = readBearerToken(readHeader(request, "authorization"));
  if (!tokenMatches(fingerprint(adminToken), token)) {
    throw gatewayError("admin-unauthorized", 401, "Gateway admin authentication failed.");
  }
}

function readBearerToken(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parts = value.trim().split(/\s+/u);
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== "bearer") return undefined;
  return parts[1];
}

function readCreateRouteInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw gatewayError("route-body-invalid", 400, "Route body must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.runId !== "string" ||
    typeof record.targetOrigin !== "string" ||
    typeof record.syntheticIp !== "string" ||
    typeof record.ttlMs !== "number"
  ) {
    throw gatewayError("route-body-invalid", 400, "Route body is missing required fields.");
  }
  return {
    runId: record.runId as import("@testy/shared-types").RunId,
    targetOrigin: record.targetOrigin,
    syntheticIp: record.syntheticIp,
    ttlMs: record.ttlMs,
  };
}

function toHeaders(headers: IncomingMessage["headers"]): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) value.forEach((item) => result.append(name, item));
    else if (value !== undefined) result.set(name, value);
  }
  return result;
}

function readHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

async function readJson(request: IncomingMessage, limit: number): Promise<unknown> {
  const body = await readBody(request, limit);
  try {
    return JSON.parse(body.toString("utf8")) as unknown;
  } catch {
    throw gatewayError("json-invalid", 400, "Request body is not valid JSON.");
  }
}

async function readResponseBody(response: Response, limit: number): Promise<Buffer> {
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
        throw gatewayError(
          "target-response-too-large",
          502,
          "Target response exceeded the gateway limit.",
        );
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

async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > limit) throw gatewayError("request-body-too-large", 413, "Request body exceeded the gateway limit.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(value));
}

function sendError(response: ServerResponse, error: unknown): void {
  const gateway = error instanceof GatewayError
    ? error
    : gatewayError("internal-error", 500, "Traffic gateway request failed.");
  if (response.headersSent) {
    response.destroy();
    return;
  }
  sendJson(response, gateway.statusCode, { error: gateway.code });
}
