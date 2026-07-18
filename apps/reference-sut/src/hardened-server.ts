import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import {
  startReferenceSut as startBaseReferenceSut,
  type ReferenceSutBinding,
  type ReferenceSutOptions,
} from "./server.js";

export type { ReferenceSutBinding, ReferenceSutOptions } from "./server.js";

const MAX_BODY_BYTES = 256 * 1024;

interface CompatibilityState {
  readonly idempotencyKeys: Set<string>;
  readonly retryAttempts: Map<string, number>;
}

/**
 * Adds browser-safe CORS handling, correct management-authentication responses,
 * and deterministic direct-traffic probes around the canonical reference SUT.
 */
export async function startReferenceSut(
  options: ReferenceSutOptions,
): Promise<ReferenceSutBinding> {
  const host = options.host ?? "127.0.0.1";
  const state: CompatibilityState = {
    idempotencyKeys: new Set(),
    retryAttempts: new Map(),
  };
  let innerOrigin: string | undefined;
  let publicOrigin = options.publicOrigin;

  const outer = createServer((request, response) => {
    void handleOuterRequest(
      request,
      response,
      options.serviceToken,
      state,
      () => innerOrigin,
      () => publicOrigin,
    ).catch((error) => {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      sendJson(response, 500, {
        error: "reference-sut-proxy-error",
        errorFingerprint: fingerprint(error instanceof Error ? error.message : String(error)),
      });
    });
  });

  await listen(outer, options.port ?? 0, host);
  const address = outer.address();
  if (!address || typeof address === "string") {
    await close(outer);
    throw new Error("Reference SUT compatibility server did not expose a TCP port.");
  }

  const publicHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  publicOrigin ??= `http://${publicHost}:${String(address.port)}`;

  let base: ReferenceSutBinding;
  try {
    base = await startBaseReferenceSut({
      ...options,
      host: "127.0.0.1",
      port: 0,
      publicOrigin,
    });
    innerOrigin = `http://127.0.0.1:${String(base.port)}`;
  } catch (error) {
    await close(outer);
    throw error;
  }

  return {
    origin: publicOrigin,
    port: address.port,
    stop: async () => {
      state.idempotencyKeys.clear();
      state.retryAttempts.clear();
      await close(outer);
      await base.stop();
    },
  };
}

async function handleOuterRequest(
  request: IncomingMessage,
  response: ServerResponse,
  serviceToken: string,
  state: CompatibilityState,
  getInnerOrigin: () => string | undefined,
  getPublicOrigin: () => string | undefined,
): Promise<void> {
  const publicOrigin = getPublicOrigin() ?? "http://reference-sut.invalid";
  const url = new URL(request.url ?? "/", publicOrigin);
  const isTraffic = url.pathname.startsWith("/test-support/v1/traffic/");

  if (requiresServiceAuthorization(url.pathname) && !authorized(request, serviceToken)) {
    response.setHeader("www-authenticate", "Bearer");
    sendJson(response, 401, { error: "unauthorized" });
    return;
  }

  if (isTraffic) {
    applyCors(response);
    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    if (await handleCompatibilityTraffic(request, response, url, state)) return;
  }

  const innerOrigin = getInnerOrigin();
  if (!innerOrigin) {
    sendJson(response, 503, { error: "reference-sut-starting" });
    return;
  }

  await proxyToCanonicalServer(request, response, innerOrigin, isTraffic);
}

async function handleCompatibilityTraffic(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  state: CompatibilityState,
): Promise<boolean> {
  const match = /^\/test-support\/v1\/traffic\/([^/]+)$/u.exec(url.pathname);
  const operation = match?.[1];
  if (!operation || operation === "events") return false;

  if (operation === "malformed-json") {
    const text = await readText(request);
    try {
      JSON.parse(text);
      sendJson(response, 422, { error: "expected-malformed-json" });
    } catch {
      sendJson(response, 400, { error: "malformed-json" });
    }
    return true;
  }

  if (operation === "malformed-form") {
    await readText(request);
    sendJson(response, 422, { error: "malformed-form" });
    return true;
  }

  if (operation === "slow") {
    await readText(request);
    await delay(200);
    if (!response.destroyed) {
      response.statusCode = 204;
      response.end();
    }
    return true;
  }

  if (operation === "attribution") {
    await readText(request);
    response.setHeader(
      "x-reference-source-fingerprint",
      fingerprint(String(request.headers["x-forwarded-for"] ?? "missing")),
    );
    response.statusCode = 204;
    response.end();
    return true;
  }

  if (operation === "burst") {
    await delay(25);
    response.statusCode = 204;
    response.end();
    return true;
  }

  if (operation === "idempotent") {
    const text = await readText(request);
    const eventId = readEventId(text);
    const key = header(request, "idempotency-key") ?? eventId ?? fingerprint(text);
    if (state.idempotencyKeys.has(key)) {
      sendJson(response, 409, { error: "duplicate-event" });
      return true;
    }
    state.idempotencyKeys.add(key);
    sendJson(response, 202, { accepted: true, duplicate: false });
    return true;
  }

  if (operation === "retry") {
    const text = await readText(request);
    const key = header(request, "idempotency-key") ?? readEventId(text) ?? fingerprint(text);
    const attempt = (state.retryAttempts.get(key) ?? 0) + 1;
    if (attempt < 3) {
      state.retryAttempts.set(key, attempt);
      sendJson(response, 503, { error: "transient-unavailable", attempt });
      return true;
    }
    state.retryAttempts.delete(key);
    sendJson(response, 202, { accepted: true, attempt });
    return true;
  }

  return false;
}

async function proxyToCanonicalServer(
  request: IncomingMessage,
  response: ServerResponse,
  innerOrigin: string,
  preserveCors: boolean,
): Promise<void> {
  const method = request.method ?? "GET";
  const body = method === "GET" || method === "HEAD" ? undefined : await readBody(request);
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || isHopByHopHeader(name)) continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }

  const upstream = await fetch(`${innerOrigin}${request.url ?? "/"}`, {
    method,
    headers,
    ...(body && body.byteLength > 0 ? { body } : {}),
    redirect: "manual",
  });

  response.statusCode = upstream.status;
  upstream.headers.forEach((value, name) => {
    if (!isHopByHopHeader(name)) response.setHeader(name, value);
  });
  if (preserveCors) applyCors(response);
  response.end(Buffer.from(await upstream.arrayBuffer()));
}

function requiresServiceAuthorization(pathname: string): boolean {
  if (pathname === "/test-support/v1/capabilities") return true;
  if (pathname === "/test-support/v1/runs") return true;
  if (!pathname.startsWith("/test-support/v1/runs/")) return false;
  return !/\/tracking\.js$/u.test(pathname);
}

function authorized(request: IncomingMessage, expected: string): boolean {
  const supplied = header(request, "authorization")?.replace(/^Bearer\s+/iu, "") ?? "";
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

function applyCors(response: ServerResponse): void {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET,POST,PUT,DELETE,OPTIONS");
  response.setHeader(
    "access-control-allow-headers",
    "authorization,content-type,idempotency-key,x-reference-target-run-id",
  );
  response.setHeader("access-control-max-age", "600");
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_BODY_BYTES) throw new Error("request-body-too-large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function readText(request: IncomingMessage): Promise<string> {
  return (await readBody(request)).toString("utf8");
}

function readEventId(text: string): string | undefined {
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const eventId = (value as Record<string, unknown>).eventId;
    return typeof eventId === "string" && eventId.length > 0 ? eventId : undefined;
  } catch {
    return undefined;
  }
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function isHopByHopHeader(name: string): boolean {
  return new Set([
    "connection",
    "content-encoding",
    "content-length",
    "host",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ]).has(name.toLowerCase());
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
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
