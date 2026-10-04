import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import type { LoadedBrowserPackage, SiteConfig } from "@testy/browser-schema";

import { renderSitePages } from "./render.js";

export interface SyntheticSiteEvent {
  readonly sequence: number;
  readonly type: "page-view" | "button" | "consent" | "form-submit";
  readonly pageId?: string;
  readonly event?: string;
  readonly value?: string;
  readonly formId?: string;
  readonly fieldNames?: readonly string[];
  readonly bodyFingerprint?: string;
}

export interface ManualTrackingBridge {
  readonly trackingScriptUrl: string;
  readonly ingestionToken: string;
  readonly gatewayProxyBaseUrl: string;
  readonly gatewayRouteToken: string;
  readonly runId: string;
  readonly publicOrigin: string;
  readonly resetVersion: number;
}

export interface SyntheticSiteBinding {
  readonly hostname: string;
  readonly port: number;
  readonly origin: string;
  readonly localOrigin: string;
  readonly siteId: string;
  readonly runNamespace: string;
  events(): readonly SyntheticSiteEvent[];
  resetEvents(): void;
  configureManualTracking(bridge: ManualTrackingBridge): void;
  clearManualTracking(): void;
  stop(): Promise<void>;
}

export interface StartSyntheticSiteOptions {
  readonly hostAddress?: string;
  readonly runNamespace: string;
  readonly hostname?: string;
}

export async function startSyntheticSite(
  loaded: LoadedBrowserPackage,
  options: StartSyntheticSiteOptions,
): Promise<SyntheticSiteBinding> {
  const hostAddress = options.hostAddress ?? "127.0.0.1";
  const hostname =
    options.hostname ?? `${sanitizeSegment(options.runNamespace)}.${loaded.site.site.hostname}`;
  const pages = new Map(renderSitePages(loaded.site).map((page) => [page.path, page]));
  const events: SyntheticSiteEvent[] = [];
  let sequence = 0;
  let manualTracking: ManualTrackingBridge | undefined;

  const record = (event: Omit<SyntheticSiteEvent, "sequence">): void => {
    events.push({ sequence: (sequence += 1), ...event });
  };

  const server = createServer((request, response) => {
    void handleRequest(
      request,
      response,
      loaded.site,
      pages,
      record,
      () => manualTracking,
    ).catch((error) => {
      response.statusCode = 500;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    });
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, hostAddress, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Synthetic site did not expose a TCP port.");
  }
  const port = address.port;

  return {
    hostname,
    port,
    origin: `http://${hostname}:${port}`,
    localOrigin: `http://${hostAddress}:${port}`,
    siteId: loaded.site.site.id,
    runNamespace: options.runNamespace,
    events: () => events.map((event) => ({ ...event })),
    resetEvents: () => {
      events.splice(0, events.length);
      sequence = 0;
    },
    configureManualTracking: (bridge) => {
      manualTracking = validateManualTrackingBridge(bridge);
    },
    clearManualTracking: () => {
      manualTracking = undefined;
    },
    stop: async () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      }),
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  site: SiteConfig,
  pages: ReadonlyMap<string, { readonly pageId: string; readonly html: string }>,
  record: (event: Omit<SyntheticSiteEvent, "sequence">) => void,
  manualTracking: () => ManualTrackingBridge | undefined,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://synthetic.test");
  const trackingEndpoint = site.tracking?.endpoint ?? "/__testy/events";

  if (request.method === "GET" && url.pathname === "/__testy/health") {
    sendJson(response, 200, { status: "ok", siteId: site.site.id });
    return;
  }
  if (request.method === "GET" && url.pathname === "/sdk/track.v1.min.js") {
    const bridge = manualTracking();
    if (!bridge) {
      sendJson(response, 404, { error: "manual-tracking-not-configured" });
      return;
    }
    await proxyTrackingScript(response, bridge);
    return;
  }
  if (request.method === "POST" && url.pathname === "/t/v1/events") {
    const bridge = manualTracking();
    if (!bridge) {
      sendJson(response, 409, { error: "manual-tracking-not-configured" });
      return;
    }
    await proxyTrackingEvent(request, response, bridge);
    return;
  }
  if (request.method === "GET" && url.pathname === "/__testy/style.css") {
    response.statusCode = 200;
    response.setHeader("content-type", "text/css; charset=utf-8");
    response.end(defaultStyles);
    return;
  }
  if (request.method === "POST" && url.pathname === trackingEndpoint) {
    const value = await readJsonBody(request);
    if (
      value &&
      typeof value.type === "string" &&
      ["page-view", "button", "consent"].includes(value.type)
    ) {
      record({
        type: value.type as "page-view" | "button" | "consent",
        ...(typeof value.pageId === "string" ? { pageId: value.pageId } : {}),
        ...(typeof value.event === "string" ? { event: value.event } : {}),
        ...(typeof value.value === "string" ? { value: value.value } : {}),
      });
    }
    response.statusCode = 204;
    response.end();
    return;
  }

  const form = findForm(site, url.pathname, request.method ?? "GET");
  if (form) {
    const body =
      request.method === "POST"
        ? await readTextBody(request)
        : url.searchParams.toString();
    const params = new URLSearchParams(body);
    record({
      type: "form-submit",
      formId: form.id,
      fieldNames: [...new Set([...params.keys()])].sort(),
      bodyFingerprint: createHash("sha256").update(body).digest("hex"),
    });
    response.statusCode = 303;
    response.setHeader("location", form.successPath ?? "/");
    response.end();
    return;
  }

  const page = pages.get(url.pathname);
  if (!page || request.method !== "GET") {
    sendJson(response, 404, { error: "not-found" });
    return;
  }
  response.statusCode = 200;
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader(
    "content-security-policy",
    "default-src 'self'; script-src 'unsafe-inline'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'",
  );
  response.end(injectManualTracking(page.html, manualTracking()));
}

function validateManualTrackingBridge(
  bridge: ManualTrackingBridge,
): ManualTrackingBridge {
  const script = new URL(bridge.trackingScriptUrl);
  const gateway = new URL(bridge.gatewayProxyBaseUrl);
  const origin = new URL(bridge.publicOrigin);
  if (!["http:", "https:"].includes(script.protocol) || script.username || script.password) {
    throw new Error("Manual tracking script URL must be a safe HTTP(S) URL.");
  }
  if (!["http:", "https:"].includes(gateway.protocol) || gateway.username || gateway.password) {
    throw new Error("Manual gateway URL must be a safe HTTP(S) URL.");
  }
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/") {
    throw new Error("Manual public origin must be an HTTPS origin.");
  }
  if (!Number.isInteger(bridge.resetVersion) || bridge.resetVersion < 0) {
    throw new Error("Manual reset version must be a non-negative integer.");
  }
  return { ...bridge };
}

async function proxyTrackingScript(
  response: ServerResponse,
  bridge: ManualTrackingBridge,
): Promise<void> {
  const upstream = await fetch(bridge.trackingScriptUrl, { redirect: "manual" });
  if (!upstream.ok) {
    sendJson(response, 502, { error: "tracking-script-unavailable" });
    return;
  }
  const body = Buffer.from(await upstream.arrayBuffer());
  if (body.byteLength > 2 * 1024 * 1024) {
    sendJson(response, 502, { error: "tracking-script-too-large" });
    return;
  }
  response.statusCode = 200;
  response.setHeader(
    "content-type",
    upstream.headers.get("content-type") ?? "application/javascript; charset=utf-8",
  );
  response.setHeader("cache-control", "no-store");
  response.end(body);
}

async function proxyTrackingEvent(
  request: IncomingMessage,
  response: ServerResponse,
  bridge: ManualTrackingBridge,
): Promise<void> {
  const body = await readTextBody(request);
  const upstream = await fetch(
    `${bridge.gatewayProxyBaseUrl.replace(/\/$/u, "")}/t/v1/events`,
    {
      method: "POST",
      headers: {
        "content-type": String(request.headers["content-type"] ?? "application/json"),
        origin: bridge.publicOrigin,
        "x-testy-route-token": bridge.gatewayRouteToken,
        "x-testy-run-id": bridge.runId,
        ...(request.headers["user-agent"]
          ? { "user-agent": String(request.headers["user-agent"]) }
          : {}),
      },
      body,
      redirect: "manual",
    },
  );
  response.statusCode = upstream.status;
  response.setHeader("cache-control", "no-store");
  response.end();
}

function injectManualTracking(
  html: string,
  bridge: ManualTrackingBridge | undefined,
): string {
  if (!bridge) return html;
  const marker = JSON.stringify(String(bridge.resetVersion));
  const reset = `<script>(()=>{try{const k="testy:demo-reset";const v=${marker};if(localStorage.getItem(k)!==v){localStorage.clear();sessionStorage.clear();document.cookie.split(";").forEach((c)=>{document.cookie=c.split("=")[0].trim()+"=; Max-Age=0; Path=/; SameSite=Lax";});localStorage.setItem(k,v);}}catch{}})();</script>`;
  const sdk = `<script src="/sdk/track.v1.min.js" data-site="${escapeAttribute(bridge.ingestionToken)}"></script>`;
  return html.replace("</body>", `${reset}\n${sdk}\n</body>`);
}

function findForm(site: SiteConfig, path: string, method: string) {
  for (const page of site.pages) {
    for (const block of page.blocks) {
      if (block.type === "form" && block.action === path && block.method === method) {
        return block;
      }
    }
  }
  return undefined;
}

async function readJsonBody(
  request: IncomingMessage,
): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed = JSON.parse(await readTextBody(request)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

async function readTextBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > 64 * 1024) {
      throw new Error("Synthetic-site request body exceeded 64 KiB.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function sanitizeSegment(value: string): string {
  const result = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return (result || "run").slice(0, 50);
}

const defaultStyles = `
:root { font-family: system-ui, sans-serif; color-scheme: light; }
body { max-width: 60rem; margin: 0 auto; padding: 2rem; line-height: 1.5; }
main { display: grid; gap: 1rem; }
form { display: grid; gap: 0.75rem; max-width: 32rem; }
form > div { display: grid; gap: 0.25rem; }
button, input, select { font: inherit; padding: 0.5rem; }
[data-test="consent-banner"] { position: fixed; inset: auto 1rem 1rem; padding: 1rem; background: white; border: 1px solid #777; }
`;
