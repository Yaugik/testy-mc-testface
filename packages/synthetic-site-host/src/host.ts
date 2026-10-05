import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import type { LoadedBrowserPackage, SiteConfig } from "@testy/browser-schema";

import { renderSitePages } from "./render.js";

export interface SyntheticSiteEvent {
  readonly sequence: number;
  readonly type:
    | "page-view"
    | "button"
    | "consent"
    | "form-submit"
    | "sdk-load"
    | "tracking-forward";
  readonly pageId?: string;
  readonly event?: string;
  readonly value?: string;
  readonly formId?: string;
  readonly fieldNames?: readonly string[];
  readonly bodyFingerprint?: string;
  readonly statusCode?: number;
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
    await proxyTrackingScript(response, bridge, record);
    return;
  }
  if (request.method === "POST" && url.pathname === "/t/v1/events") {
    const bridge = manualTracking();
    if (!bridge) {
      sendJson(response, 409, { error: "manual-tracking-not-configured" });
      return;
    }
    await proxyTrackingEvent(request, response, bridge, record);
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
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'",
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
  record: (event: Omit<SyntheticSiteEvent, "sequence">) => void,
): Promise<void> {
  let upstream: Response;
  try {
    upstream = await fetch(bridge.trackingScriptUrl, { redirect: "manual" });
  } catch (error) {
    record({
      type: "sdk-load",
      event: "failed",
      value: "upstream-fetch-failed",
    });
    sendJson(response, 502, {
      error: "tracking-script-fetch-failed",
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  if (!upstream.ok) {
    record({
      type: "sdk-load",
      event: "failed",
      value: `HTTP ${upstream.status}`,
      statusCode: upstream.status,
    });
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
  record({
    type: "sdk-load",
    event: "loaded",
    value: `HTTP ${upstream.status}`,
    statusCode: upstream.status,
  });
  response.end(body);
}

async function proxyTrackingEvent(
  request: IncomingMessage,
  response: ServerResponse,
  bridge: ManualTrackingBridge,
  record: (event: Omit<SyntheticSiteEvent, "sequence">) => void,
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
  record({
    type: "tracking-forward",
    event: upstream.ok ? "forwarded" : "rejected",
    value: `HTTP ${upstream.status}`,
    statusCode: upstream.status,
  });
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
  const sdk = `<script async src="/sdk/track.v1.min.js" data-site="${escapeAttribute(bridge.ingestionToken)}"></script>`;
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
:root {
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #0f172a;
  background: #ffffff;
  font-synthesis: none;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; min-height: 100vh; background: #fff; color: #0f172a; line-height: 1.55; }
a { color: inherit; }
button, input, select { font: inherit; }

.site-header {
  position: sticky;
  top: 0;
  z-index: 20;
  min-height: 72px;
  padding: 0 6vw;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  border-bottom: 1px solid #e8edf3;
  background: rgba(255,255,255,.94);
  backdrop-filter: blur(16px);
}
.site-brand { display: inline-flex; align-items: center; gap: 10px; text-decoration: none; font-weight: 800; letter-spacing: -.02em; }
.site-brand-mark {
  display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px;
  color: white; background: #0f172a; font-size: 15px; box-shadow: 0 8px 20px rgba(15,23,42,.16);
}
.site-nav { display: flex; align-items: center; gap: 28px; color: #475569; font-size: 14px; font-weight: 650; }
.site-nav a { text-decoration: none; }
.site-nav a:hover { color: #0f172a; }
.site-nav-cta { padding: 10px 16px; border-radius: 999px; background: #0f172a; color: #fff !important; }

.site-main {
  width: min(1180px, calc(100% - 40px));
  margin: 0 auto;
  padding: 76px 0 96px;
}
.site-main > h1 {
  max-width: 850px;
  margin: 0 auto 22px;
  font-size: clamp(44px, 7vw, 78px);
  line-height: .98;
  letter-spacing: -.055em;
  text-align: center;
}
.site-main > h1 + p {
  max-width: 720px;
  margin: 0 auto 34px;
  text-align: center;
  color: #64748b;
  font-size: 19px;
}
.site-main > a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 46px;
  padding: 0 20px;
  margin: 0 8px 18px 0;
  border-radius: 12px;
  border: 1px solid #d8e0ea;
  text-decoration: none;
  font-weight: 750;
  background: #fff;
}
.site-main > a[data-test="pricing-link"],
.site-main > a[data-test="pricing-contact-link"],
.site-main > a[data-test="contact-link"],
.site-main > a[data-test="thanks-home"] { background: #0f172a; color: #fff; border-color: #0f172a; }

[data-test-page="home"] .site-main {
  text-align: center;
  padding-top: 104px;
}
[data-test-page="home"] .site-main::before {
  content: "ACCOUNT INTELLIGENCE, WITHOUT THE NOISE";
  display: inline-flex;
  padding: 8px 12px;
  margin-bottom: 24px;
  border-radius: 999px;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: .08em;
}
[data-test-page="home"] .site-main > h2 {
  max-width: 760px;
  margin: 92px auto 14px;
  font-size: clamp(28px, 4vw, 44px);
  line-height: 1.08;
  letter-spacing: -.035em;
}
[data-test-page="home"] .site-main > h2 + p {
  max-width: 720px;
  margin: 0 auto 24px;
  color: #64748b;
  font-size: 17px;
}
[data-test-page="home"] .site-main > h2:nth-of-type(2),
[data-test-page="home"] .site-main > h2:nth-of-type(3) {
  padding-top: 54px;
  border-top: 1px solid #eef2f7;
}

[data-test-page="pricing"] .site-main { max-width: 1040px; }
[data-test-page="pricing"] .site-main > h1 { font-size: clamp(42px, 6vw, 66px); }
[data-test-page="pricing"] .site-main > h2 {
  display: inline-block;
  vertical-align: top;
  width: calc(33.333% - 18px);
  min-height: 220px;
  margin: 42px 12px 14px 0;
  padding: 28px;
  border: 1px solid #e5eaf0;
  border-radius: 18px 18px 0 0;
  background: #f8fafc;
  font-size: 24px;
}
[data-test-page="pricing"] .site-main > h2 + p {
  display: inline-block;
  vertical-align: top;
  width: calc(33.333% - 18px);
  min-height: 122px;
  margin: -14px 12px 28px 0;
  padding: 0 28px 28px;
  border: 1px solid #e5eaf0;
  border-top: 0;
  border-radius: 0 0 18px 18px;
  color: #64748b;
  background: #f8fafc;
}
[data-test-page="pricing"] .site-main > a[data-test="pricing-contact-link"] { margin-top: 24px; }

[data-test-page="contact"] .site-main { max-width: 980px; }
[data-test-page="contact"] .site-main > h1,
[data-test-page="contact"] .site-main > h1 + p { text-align: left; margin-left: 0; max-width: 760px; }
form[data-test="lead-form"] {
  display: grid;
  gap: 18px;
  max-width: 680px;
  margin-top: 38px;
  padding: 30px;
  border: 1px solid #e3e9f0;
  border-radius: 20px;
  background: #f8fafc;
  box-shadow: 0 18px 60px rgba(15,23,42,.07);
}
form[data-test="lead-form"] > div { display: grid; gap: 7px; }
form[data-test="lead-form"] label { font-size: 13px; font-weight: 750; color: #334155; }
form[data-test="lead-form"] input:not([type="checkbox"]),
form[data-test="lead-form"] select {
  width: 100%;
  min-height: 46px;
  padding: 10px 12px;
  border: 1px solid #cfd8e3;
  border-radius: 10px;
  background: #fff;
  color: #0f172a;
}
form[data-test="lead-form"] button[type="submit"] {
  min-height: 48px;
  border: 0;
  border-radius: 11px;
  background: #0f172a;
  color: white;
  font-weight: 800;
  cursor: pointer;
}

[data-test-page="thanks"] .site-main { min-height: 64vh; display: grid; place-content: center; text-align: center; }
[data-test-page="thanks"] .site-main > h1 { font-size: clamp(44px, 6vw, 68px); }
[data-test-page="thanks"] .site-main > p { max-width: 620px; margin: 0 auto 26px; color: #64748b; font-size: 18px; }

.site-footer {
  width: min(1180px, calc(100% - 40px));
  margin: 0 auto;
  padding: 34px 0 48px;
  display: flex;
  justify-content: space-between;
  gap: 24px;
  border-top: 1px solid #e9eef4;
  color: #64748b;
  font-size: 13px;
}
.site-footer div { display: grid; gap: 5px; }
.site-footer strong { color: #0f172a; font-size: 15px; }

[data-test="consent-banner"] {
  position: fixed;
  right: 22px;
  bottom: 22px;
  z-index: 50;
  width: min(430px, calc(100% - 44px));
  padding: 18px;
  border: 1px solid #dce3eb;
  border-radius: 16px;
  background: rgba(255,255,255,.98);
  box-shadow: 0 18px 60px rgba(15,23,42,.18);
}
[data-test="consent-banner"] p { margin: 0 0 14px; color: #475569; font-size: 14px; }
[data-test="consent-banner"] button {
  border: 1px solid #d5dde7;
  border-radius: 9px;
  padding: 9px 12px;
  margin-right: 8px;
  background: white;
  cursor: pointer;
}
[data-test="consent-banner"] button:first-of-type { background: #0f172a; color: white; border-color: #0f172a; }

@media (max-width: 760px) {
  .site-header { padding: 0 18px; }
  .site-nav > a:not(.site-nav-cta) { display: none; }
  .site-main { width: min(100% - 28px, 1180px); padding-top: 58px; }
  [data-test-page="home"] .site-main { padding-top: 72px; }
  [data-test-page="pricing"] .site-main > h2,
  [data-test-page="pricing"] .site-main > h2 + p { display: block; width: 100%; margin-right: 0; }
  .site-footer { width: min(100% - 28px, 1180px); flex-direction: column; }
}
`

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("`", "&#96;");
}
