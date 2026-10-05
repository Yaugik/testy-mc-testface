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
body {
  margin: 0;
  min-height: 100vh;
  color: #0f172a;
  line-height: 1.55;
  background:
    radial-gradient(circle at 50% -10%, rgba(219,234,254,.75), transparent 34%),
    #ffffff;
}
a { color: inherit; }
button, input, select { font: inherit; }

.site-announcement {
  min-height: 34px;
  padding: 7px 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: #0f172a;
  color: #cbd5e1;
  font-size: 12px;
  font-weight: 650;
}
.site-announcement a { color: #fff; text-decoration: none; font-weight: 800; }

.site-header {
  position: sticky;
  top: 0;
  z-index: 20;
  min-height: 72px;
  padding: 0 max(24px, 5vw);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 28px;
  border-bottom: 1px solid rgba(226,232,240,.9);
  background: rgba(255,255,255,.94);
  backdrop-filter: blur(18px);
}
.site-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: #0f172a;
  text-decoration: none;
  font-weight: 850;
  letter-spacing: -.025em;
  white-space: nowrap;
}
.site-brand-mark {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 11px;
  color: white;
  background: linear-gradient(145deg, #0f172a, #334155);
  font-size: 15px;
  box-shadow: 0 9px 22px rgba(15,23,42,.18);
}
.site-nav { display: flex; align-items: center; gap: 24px; color: #475569; font-size: 14px; font-weight: 680; }
.site-nav a { text-decoration: none; transition: color .15s ease, transform .15s ease; }
.site-nav a:hover { color: #0f172a; }
.site-nav-cta {
  padding: 10px 16px;
  border-radius: 999px;
  background: #0f172a;
  color: #fff !important;
  box-shadow: 0 8px 22px rgba(15,23,42,.12);
}

.site-main {
  width: min(1240px, calc(100% - 40px));
  margin: 0 auto;
  padding: 0 0 112px;
}
.page-hero {
  padding: 96px 0 24px;
  text-align: center;
}
.page-hero > h1 {
  max-width: 920px;
  margin: 0 auto 24px;
  font-size: clamp(46px, 7vw, 82px);
  line-height: .98;
  letter-spacing: -.058em;
}
.page-hero > h1 + p {
  max-width: 760px;
  margin: 0 auto 34px;
  color: #64748b;
  font-size: clamp(17px, 2vw, 20px);
}
.page-hero > a,
.content-card > a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 46px;
  padding: 0 20px;
  margin: 0 7px 10px;
  border: 1px solid #d8e0ea;
  border-radius: 12px;
  background: #fff;
  color: #0f172a;
  text-decoration: none;
  font-weight: 780;
}
.page-hero > a[data-test="contact-link"],
.page-hero > a[data-test="thanks-home"],
.content-card > a[data-test="final-cta-link"],
.content-card > a[data-test="pricing-contact-link"],
.content-card > a[data-test$="-link"] {
  background: #0f172a;
  border-color: #0f172a;
  color: #fff;
}

[data-test-page="home"] .page-hero::before {
  content: "ACCOUNT INTELLIGENCE, WITHOUT THE NOISE";
  display: inline-flex;
  margin-bottom: 24px;
  padding: 8px 12px;
  border: 1px solid #bfdbfe;
  border-radius: 999px;
  background: rgba(239,246,255,.9);
  color: #1d4ed8;
  font-size: 11px;
  font-weight: 850;
  letter-spacing: .09em;
}

.hero-product-preview {
  width: min(1060px, 100%);
  margin: 62px auto 28px;
  overflow: hidden;
  border: 1px solid #dbe4ee;
  border-radius: 24px;
  background: #f8fafc;
  box-shadow: 0 30px 90px rgba(15,23,42,.14);
  text-align: left;
}
.preview-window-bar {
  min-height: 48px;
  padding: 0 18px;
  display: flex;
  align-items: center;
  gap: 7px;
  border-bottom: 1px solid #e2e8f0;
  background: #fff;
}
.preview-dot { width: 9px; height: 9px; border-radius: 999px; background: #cbd5e1; }
.preview-window-title { margin-left: 9px; color: #64748b; font-size: 12px; font-weight: 700; }
.preview-layout { display: grid; grid-template-columns: 72px 1fr; min-height: 420px; }
.preview-sidebar {
  padding: 24px 15px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 19px;
  border-right: 1px solid #e2e8f0;
  background: #0f172a;
}
.preview-sidebar-brand {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  margin-bottom: 16px;
  border-radius: 10px;
  background: #fff;
  color: #0f172a;
  font-size: 13px;
  font-weight: 900;
}
.preview-sidebar-item { width: 28px; height: 7px; border-radius: 999px; background: #475569; }
.preview-sidebar-item.active { background: #93c5fd; }
.preview-sidebar-item.short { width: 20px; }
.preview-content {
  padding: 34px;
  background:
    linear-gradient(180deg, rgba(248,250,252,.55), #fff),
    #fff;
}
.preview-kicker { color: #64748b; font-size: 11px; font-weight: 850; letter-spacing: .09em; }
.preview-stat-grid {
  margin: 16px 0 28px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}
.preview-stat-grid > div {
  min-height: 112px;
  padding: 18px;
  display: grid;
  align-content: center;
  gap: 4px;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  background: #f8fafc;
}
.preview-stat-grid strong { font-size: 29px; letter-spacing: -.04em; }
.preview-stat-grid span { color: #64748b; font-size: 12px; }
.preview-company {
  min-height: 70px;
  margin-top: 10px;
  padding: 13px 16px;
  display: grid;
  grid-template-columns: 40px 1fr auto;
  align-items: center;
  gap: 13px;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  background: #fff;
}
.preview-company.muted { opacity: .72; }
.preview-company-logo {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 11px;
  background: #e0f2fe;
  color: #0369a1;
  font-weight: 900;
}
.preview-company div { display: grid; gap: 2px; }
.preview-company div strong { font-size: 14px; }
.preview-company div span { color: #64748b; font-size: 12px; }
.preview-score {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 999px;
  background: #dcfce7;
  color: #166534;
  font-size: 12px;
  font-weight: 900;
}
.customer-strip {
  margin: 32px auto 4px;
  padding: 22px 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: clamp(18px, 4vw, 48px);
  flex-wrap: wrap;
  border-top: 1px solid #eef2f7;
  border-bottom: 1px solid #eef2f7;
  color: #94a3b8;
  font-size: 12px;
}
.customer-strip span { color: #64748b; font-weight: 700; }
.customer-strip strong { color: #94a3b8; font-size: 13px; letter-spacing: .12em; }

.site-content-grid {
  margin-top: 80px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
}
.content-card,
.form-panel {
  min-width: 0;
  padding: 30px;
  border: 1px solid #e3e9f0;
  border-radius: 20px;
  background: rgba(255,255,255,.92);
  box-shadow: 0 14px 45px rgba(15,23,42,.045);
}
.content-card h2 {
  margin: 0 0 12px;
  font-size: 25px;
  line-height: 1.13;
  letter-spacing: -.035em;
}
.content-card p { margin: 0 0 14px; color: #64748b; font-size: 15px; }
.content-card p:last-child { margin-bottom: 0; }

/* Home */
[data-test-page="home"] .site-content-grid { margin-top: 86px; }
[data-test-page="home"] [data-section-id="trust-heading"] {
  grid-column: 1 / -1;
  padding: 46px;
  text-align: center;
  background: linear-gradient(135deg, #eff6ff, #f8fafc 55%, #eef2ff);
}
[data-test-page="home"] [data-section-id="trust-heading"] h2 {
  max-width: 850px;
  margin: 0 auto 12px;
  font-size: clamp(30px, 4vw, 44px);
}
[data-test-page="home"] [data-section-id="trust-heading"] p { max-width: 760px; margin: 0 auto; font-size: 17px; }
[data-test-page="home"] [data-section-id^="metric-"] {
  min-height: 210px;
  background: #0f172a;
  border-color: #0f172a;
}
[data-test-page="home"] [data-section-id^="metric-"] h2 { color: #fff; font-size: 31px; }
[data-test-page="home"] [data-section-id^="metric-"] p { color: #94a3b8; }
[data-test-page="home"] [data-section-id="capabilities-heading"] {
  grid-column: 1 / -1;
  padding: 20px 16% 28px;
  border: 0;
  box-shadow: none;
  background: transparent;
  text-align: center;
}
[data-test-page="home"] [data-section-id="capabilities-heading"] h2 { font-size: clamp(30px, 4vw, 46px); }
[data-test-page="home"] [data-section-id="capabilities-heading"] p { font-size: 17px; }
[data-test-page="home"] [data-section-id="intelligence-heading"],
[data-test-page="home"] [data-section-id="workflow-heading"],
[data-test-page="home"] [data-section-id="signal-heading"],
[data-test-page="home"] [data-section-id="routing-heading"],
[data-test-page="home"] [data-section-id="integrations-heading"],
[data-test-page="home"] [data-section-id="activation-heading"] {
  min-height: 240px;
  position: relative;
  overflow: hidden;
}
[data-test-page="home"] [data-section-id="intelligence-heading"]::before,
[data-test-page="home"] [data-section-id="workflow-heading"]::before,
[data-test-page="home"] [data-section-id="signal-heading"]::before,
[data-test-page="home"] [data-section-id="routing-heading"]::before,
[data-test-page="home"] [data-section-id="integrations-heading"]::before,
[data-test-page="home"] [data-section-id="activation-heading"]::before {
  content: "";
  display: block;
  width: 42px;
  height: 42px;
  margin-bottom: 28px;
  border-radius: 13px;
  background: linear-gradient(135deg, #dbeafe, #e0e7ff);
  box-shadow: inset 0 0 0 1px rgba(99,102,241,.12);
}
[data-test-page="home"] [data-section-id="proof-heading"] {
  grid-column: span 2;
  padding: 42px;
  background: #f8fafc;
}
[data-test-page="home"] [data-section-id="proof-heading"] h2 { font-size: clamp(28px, 3vw, 38px); }
[data-test-page="home"] [data-section-id="final-cta-heading"] {
  grid-column: 1 / -1;
  padding: 52px;
  color: #fff;
  background: linear-gradient(135deg, #0f172a, #1e293b);
  border-color: #0f172a;
}
[data-test-page="home"] [data-section-id="final-cta-heading"] h2 { max-width: 720px; font-size: clamp(32px, 4vw, 46px); }
[data-test-page="home"] [data-section-id="final-cta-heading"] p { max-width: 720px; color: #cbd5e1; font-size: 16px; }
[data-test-page="home"] [data-section-id="final-cta-heading"] a {
  margin: 10px 0 0;
  background: #fff;
  border-color: #fff;
  color: #0f172a;
}

/* Pricing */
[data-test-page="pricing"] .page-hero { padding-bottom: 0; }
[data-test-page="pricing"] .page-hero > h1 { max-width: 820px; font-size: clamp(44px, 6vw, 70px); }
[data-test-page="pricing"] [data-section-id="starter-heading"],
[data-test-page="pricing"] [data-section-id="growth-heading"],
[data-test-page="pricing"] [data-section-id="scale-heading"] {
  min-height: 405px;
  display: flex;
  flex-direction: column;
}
[data-test-page="pricing"] [data-section-id="growth-heading"] {
  transform: translateY(-12px);
  border-color: #94a3b8;
  box-shadow: 0 24px 65px rgba(15,23,42,.11);
}
[data-test-page="pricing"] [data-section-id="growth-heading"]::before {
  content: "MOST POPULAR";
  width: fit-content;
  margin-bottom: 18px;
  padding: 6px 9px;
  border-radius: 999px;
  background: #dbeafe;
  color: #1d4ed8;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: .08em;
}
[data-test-page="pricing"] [data-block-id$="-price"] {
  margin-bottom: 18px;
  color: #0f172a;
  font-size: 27px;
  font-weight: 850;
  letter-spacing: -.035em;
}
[data-test-page="pricing"] [data-block-id$="-features"] { padding-top: 15px; border-top: 1px solid #e2e8f0; }
[data-test-page="pricing"] [data-section-id="starter-heading"] a,
[data-test-page="pricing"] [data-section-id="growth-heading"] a,
[data-test-page="pricing"] [data-section-id="scale-heading"] a { margin: auto 0 0; }
[data-test-page="pricing"] [data-section-id="comparison-heading"],
[data-test-page="pricing"] [data-section-id="pricing-contact-heading"] { grid-column: 1 / -1; }
[data-test-page="pricing"] [data-section-id="comparison-heading"] {
  padding: 42px;
  background: linear-gradient(135deg, #f8fafc, #eff6ff);
}
[data-test-page="pricing"] [data-section-id^="faq-"] { background: #fbfdff; }
[data-test-page="pricing"] [data-section-id="pricing-contact-heading"] {
  padding: 46px;
  color: #fff;
  background: #0f172a;
  border-color: #0f172a;
}
[data-test-page="pricing"] [data-section-id="pricing-contact-heading"] p { color: #cbd5e1; }
[data-test-page="pricing"] [data-section-id="pricing-contact-heading"] a { margin-left: 0; background: #fff; color: #0f172a; border-color: #fff; }

/* Contact */
[data-test-page="contact"] .site-main { width: min(1120px, calc(100% - 40px)); }
[data-test-page="contact"] .page-hero { text-align: left; padding-bottom: 0; }
[data-test-page="contact"] .page-hero > h1,
[data-test-page="contact"] .page-hero > h1 + p { margin-left: 0; text-align: left; max-width: 810px; }
[data-test-page="contact"] .page-hero > h1 { font-size: clamp(44px, 6vw, 68px); }
[data-test-page="contact"] .site-content-grid { grid-template-columns: 1.35fr .65fr; align-items: stretch; }
[data-test-page="contact"] .form-panel { grid-row: span 3; padding: 34px; background: #f8fafc; }
[data-test-page="contact"] .content-card { padding: 26px; box-shadow: none; }
form[data-test="lead-form"] { display: grid; gap: 18px; }
form[data-test="lead-form"] > div { display: grid; gap: 7px; }
form[data-test="lead-form"] > div:has(input[type="checkbox"]) { grid-template-columns: auto 1fr; align-items: center; }
form[data-test="lead-form"] label { font-size: 13px; font-weight: 760; color: #334155; }
form[data-test="lead-form"] input:not([type="checkbox"]),
form[data-test="lead-form"] select {
  width: 100%;
  min-height: 48px;
  padding: 10px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 11px;
  background: #fff;
  color: #0f172a;
  outline: none;
}
form[data-test="lead-form"] input:focus,
form[data-test="lead-form"] select:focus { border-color: #64748b; box-shadow: 0 0 0 3px rgba(148,163,184,.18); }
form[data-test="lead-form"] button[type="submit"] {
  min-height: 50px;
  border: 0;
  border-radius: 11px;
  background: #0f172a;
  color: #fff;
  font-weight: 820;
  cursor: pointer;
}

/* Thank you */
[data-test-page="thanks"] .page-hero { min-height: 58vh; display: grid; place-content: center; }
[data-test-page="thanks"] .page-hero > h1 { font-size: clamp(48px, 7vw, 76px); }
[data-test-page="thanks"] .site-content-grid { margin-top: 0; grid-template-columns: 1fr; }
[data-test-page="thanks"] .content-card { max-width: 760px; margin: 0 auto; text-align: center; }

/* Footer */
.site-footer {
  width: min(1240px, calc(100% - 40px));
  margin: 0 auto;
  padding: 48px 0 54px;
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1.1fr;
  gap: 40px;
  border-top: 1px solid #e9eef4;
  color: #64748b;
  font-size: 13px;
}
.footer-brand { display: grid; align-content: start; gap: 15px; max-width: 340px; }
.footer-brand p { margin: 0; line-height: 1.65; }
.footer-column { display: grid; align-content: start; gap: 10px; }
.footer-column strong { margin-bottom: 3px; color: #0f172a; font-size: 13px; }
.footer-column a { text-decoration: none; }
.footer-column a:hover { color: #0f172a; }
.footer-meta { display: grid; align-content: start; justify-items: end; gap: 7px; text-align: right; }

/* Consent */
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

@media (max-width: 980px) {
  .site-nav { gap: 16px; }
  .site-nav a[href="/#proof-heading"],
  .site-nav a[href="/#capabilities-heading"] { display: none; }
  .site-content-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
  [data-test-page="home"] [data-section-id="trust-heading"],
  [data-test-page="home"] [data-section-id="capabilities-heading"],
  [data-test-page="home"] [data-section-id="final-cta-heading"],
  [data-test-page="pricing"] [data-section-id="comparison-heading"],
  [data-test-page="pricing"] [data-section-id="pricing-contact-heading"] { grid-column: 1 / -1; }
  [data-test-page="home"] [data-section-id="proof-heading"] { grid-column: span 1; }
  [data-test-page="pricing"] [data-section-id="scale-heading"] { grid-column: 1 / -1; }
  [data-test-page="contact"] .site-content-grid { grid-template-columns: 1fr; }
  [data-test-page="contact"] .form-panel { grid-row: auto; }
  .site-footer { grid-template-columns: 1.5fr 1fr 1fr; }
  .footer-meta { grid-column: 1 / -1; justify-items: start; text-align: left; }
}
@media (max-width: 680px) {
  .site-announcement { display: none; }
  .site-header { min-height: 66px; padding: 0 16px; }
  .site-nav > a:not(.site-nav-cta) { display: none; }
  .site-nav-cta { padding: 9px 13px; }
  .site-main { width: min(100% - 28px, 1240px); }
  .page-hero { padding-top: 64px; }
  .page-hero > h1 { font-size: clamp(42px, 13vw, 60px); }
  .hero-product-preview { margin-top: 44px; border-radius: 18px; }
  .preview-layout { grid-template-columns: 1fr; min-height: auto; }
  .preview-sidebar { display: none; }
  .preview-content { padding: 20px; }
  .preview-stat-grid { grid-template-columns: 1fr; }
  .customer-strip { gap: 18px; }
  .customer-strip span { width: 100%; }
  .site-content-grid { grid-template-columns: 1fr; margin-top: 56px; }
  .content-card, .form-panel { padding: 24px; }
  [data-test-page="home"] [data-section-id="trust-heading"],
  [data-test-page="home"] [data-section-id="capabilities-heading"],
  [data-test-page="home"] [data-section-id="proof-heading"],
  [data-test-page="home"] [data-section-id="final-cta-heading"],
  [data-test-page="pricing"] [data-section-id="comparison-heading"],
  [data-test-page="pricing"] [data-section-id="pricing-contact-heading"],
  [data-test-page="pricing"] [data-section-id="scale-heading"] { grid-column: 1; }
  [data-test-page="home"] [data-section-id="capabilities-heading"] { padding: 10px 0; }
  [data-test-page="home"] [data-section-id="trust-heading"],
  [data-test-page="home"] [data-section-id="final-cta-heading"] { padding: 30px 24px; }
  [data-test-page="pricing"] [data-section-id="growth-heading"] { transform: none; }
  .site-footer { width: min(100% - 28px, 1240px); grid-template-columns: 1fr; gap: 26px; }
  .footer-meta { grid-column: auto; }
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
