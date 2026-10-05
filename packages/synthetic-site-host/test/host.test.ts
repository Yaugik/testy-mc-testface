import { createServer } from "node:http";
import { resolve } from "node:path";

import { loadBrowserPackage } from "@testy/browser-config";
import { describe, expect, it } from "vitest";

import { startSyntheticSite } from "../src/index.js";

const fixturePath = resolve(import.meta.dirname, "../../../customers/customer-alpha");

describe("synthetic site host", () => {
  it("serves deterministic pages and records privacy-safe form events", async () => {
    const loaded = await loadBrowserPackage(fixturePath);
    const binding = await startSyntheticSite(loaded, { runNamespace: "run-123" });

    try {
      const health = await fetch(`${binding.localOrigin}/__testy/health`);
      expect(await health.json()).toEqual({ status: "ok", siteId: "alpha-marketing-site" });

      const home = await fetch(`${binding.localOrigin}/`);
      const html = await home.text();
      expect(html).toContain('data-test="hero-heading"');
      expect(html).toContain("Northstar Cloud");
      expect(binding.hostname).toBe("run-123.customer-alpha.test");

      const form = await fetch(`${binding.localOrigin}/contact/submit`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "work_email=qa%40nordlicht.example&company_size=medium",
        redirect: "manual",
      });
      expect(form.status).toBe(303);
      expect(form.headers.get("location")).toBe("/thanks");

      const submission = binding.events().find((event) => event.type === "form-submit");
      expect(submission).toMatchObject({
        formId: "lead-form",
        fieldNames: ["company_size", "work_email"],
      });
      expect(JSON.stringify(submission)).not.toContain("qa@nordlicht.example");
    } finally {
      await binding.stop();
    }
  });

  it("bridges the real tracking script and event traffic for a manual browser session", async () => {
    const loaded = await loadBrowserPackage(fixturePath);
    let forwardedHeaders: Record<string, string | undefined> = {};
    let forwardedBody = "";
    const sdkServer = createServer((_request, response) => {
      response.statusCode = 200;
      response.setHeader("content-type", "application/javascript");
      response.end("globalThis.__testySdkLoaded = true;");
    });
    const gatewayServer = createServer((request, response) => {
      forwardedHeaders = {
        origin: request.headers.origin,
        routeToken: request.headers["x-testy-route-token"] as string | undefined,
        runId: request.headers["x-testy-run-id"] as string | undefined,
      };
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        forwardedBody = Buffer.concat(chunks).toString("utf8");
        response.statusCode = 202;
        response.end();
      });
    });
    await listen(sdkServer);
    await listen(gatewayServer);
    const sdkPort = portOf(sdkServer);
    const gatewayPort = portOf(gatewayServer);
    const binding = await startSyntheticSite(loaded, {
      runNamespace: "manual-run",
      hostname: "demo-manual.localhost",
    });

    try {
      binding.configureManualTracking({
        trackingScriptUrl: `http://127.0.0.1:${sdkPort}/sdk.js`,
        ingestionToken: "synthetic-site-token",
        gatewayProxyBaseUrl: `http://127.0.0.1:${gatewayPort}/proxy`,
        gatewayRouteToken: "synthetic-route-token",
        runId: "manual-run",
        publicOrigin: "https://demo-manual.localhost:23000",
        resetVersion: 2,
      });

      const home = await fetch(`${binding.localOrigin}/`);
      const html = await home.text();
      expect(html).toContain('src="/sdk/track.v1.min.js"');
      expect(html).toContain('data-site="synthetic-site-token"');
      expect(html).toContain('"2"');

      expect(home.headers.get("content-security-policy")).toContain("script-src 'self' 'unsafe-inline'");
      const sdk = await fetch(`${binding.localOrigin}/sdk/track.v1.min.js`);
      expect(await sdk.text()).toContain("__testySdkLoaded");

      const event = await fetch(`${binding.localOrigin}/t/v1/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "page_view" }),
      });
      expect(event.status).toBe(202);
      expect(forwardedHeaders).toEqual({
        origin: "https://demo-manual.localhost:23000",
        routeToken: "synthetic-route-token",
        runId: "manual-run",
      });
      expect(forwardedBody).toContain("page_view");
    } finally {
      await binding.stop();
      await close(sdkServer);
      await close(gatewayServer);
    }
  });
});

function listen(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
}

function portOf(server: ReturnType<typeof createServer>): number {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not expose a TCP port.");
  }
  return address.port;
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
}
