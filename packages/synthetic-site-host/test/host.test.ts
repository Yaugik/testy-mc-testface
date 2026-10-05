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
      expect(html).toContain('class="hero-product-preview"');
      expect(html).toContain('class="site-content-grid"');
      expect(html).toContain('data-section-id="metric-pipeline-heading"');
      expect(html).toContain("Halcyon Systems");

      const solutions = await fetch(`${binding.localOrigin}/solutions`);
      expect(solutions.status).toBe(200);
      expect(await solutions.text()).toContain('data-test="solutions-heading"');

      const customers = await fetch(`${binding.localOrigin}/customers`);
      expect(customers.status).toBe(200);
      expect(await customers.text()).toContain("Verdant Networks");

      const integrations = await fetch(`${binding.localOrigin}/integrations`);
      expect(integrations.status).toBe(200);

      const security = await fetch(`${binding.localOrigin}/security`);
      expect(security.status).toBe(200);
      expect(await security.text()).toContain('data-test="security-heading"');

      const resources = await fetch(`${binding.localOrigin}/resources`);
      expect(resources.status).toBe(200);
      expect(await resources.text()).toContain("anonymous traffic to account action");

      const product = await fetch(`${binding.localOrigin}/product`);
      expect(product.status).toBe(200);
      const productHtml = await product.text();
      expect(productHtml).toContain('data-test="product-heading"');
      expect(productHtml).toContain("/product/account-identification");
      expect(productHtml).toContain("/product/intent-signals");

      const accountIdentification = await fetch(
        `${binding.localOrigin}/product/account-identification`,
      );
      expect(accountIdentification.status).toBe(200);
      expect(await accountIdentification.text()).toContain(
        'data-test="account-identification-heading"',
      );

      const intentSignals = await fetch(
        `${binding.localOrigin}/product/intent-signals`,
      );
      expect(intentSignals.status).toBe(200);

      const enrichment = await fetch(
        `${binding.localOrigin}/product/enrichment`,
      );
      expect(enrichment.status).toBe(200);

      const scoring = await fetch(
        `${binding.localOrigin}/product/scoring`,
      );
      expect(scoring.status).toBe(200);

      const routing = await fetch(
        `${binding.localOrigin}/product/routing-workflows`,
      );
      expect(routing.status).toBe(200);

      const sales = await fetch(`${binding.localOrigin}/solutions/sales`);
      expect(sales.status).toBe(200);
      expect(await sales.text()).toContain('data-test="sales-solution-heading"');

      const revops = await fetch(`${binding.localOrigin}/solutions/revops`);
      expect(revops.status).toBe(200);

      const marketing = await fetch(
        `${binding.localOrigin}/solutions/marketing`,
      );
      expect(marketing.status).toBe(200);

      const about = await fetch(`${binding.localOrigin}/about`);
      expect(about.status).toBe(200);
      expect(await about.text()).toContain('data-test="about-heading"');

      const careers = await fetch(`${binding.localOrigin}/careers`);
      expect(careers.status).toBe(200);

      const blog = await fetch(`${binding.localOrigin}/blog`);
      expect(blog.status).toBe(200);
      expect(await blog.text()).toContain('data-test="blog-heading"');

      const changelog = await fetch(`${binding.localOrigin}/changelog`);
      expect(changelog.status).toBe(200);

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
      expect(html).toContain('async src="/sdk/track.v1.min.js"');
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
      expect(binding.events()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "sdk-load",
            event: "loaded",
            statusCode: 200,
          }),
          expect.objectContaining({
            type: "tracking-forward",
            event: "forwarded",
            statusCode: 202,
          }),
        ]),
      );
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
