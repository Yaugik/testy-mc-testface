import { describe, expect, it } from "vitest";

import type { RunId, ScenarioId } from "@testy/shared-types";
import type { AdapterRunContext } from "@testy/target-adapter";
import { GlEyeTargetAdapter, GlEyeTestSupportError } from "../src/index.js";

const context: AdapterRunContext = {
  runId: "run-1" as RunId,
  scenarioId: "scenario-1" as ScenarioId,
  target: "gl-eye",
  createdAt: "2026-07-17T00:00:00.000Z",
};

describe("GL-EYE adapter", () => {
  it("uses only the authenticated test-support contract", async () => {
    const calls: Array<{
      url: string;
      authorization: string | null;
      method: string | undefined;
      body: string | undefined;
    }> = [];
    const adapter = new GlEyeTargetAdapter({
      baseUrl: "https://gl-eye.example.test",
      environment: "test",
      authToken: "test-support-token",
      allowedOrigins: ["https://gl-eye.example.test"],
      fetchImpl: async (input, init) => {
        const url = String(input);
        calls.push({
          url,
          authorization: new Headers(init?.headers).get("authorization"),
          method: init?.method,
          body: typeof init?.body === "string" ? init.body : undefined,
        });
        if (url.endsWith("/vendor-endpoints") || url.endsWith("/site")) {
          return new Response(null, { status: 204 });
        }
        if (url.endsWith("/observations") && init?.method === "POST") {
          return new Response(
            JSON.stringify({
              observationId: "observation-1",
              targetRunId: "target-1",
              state: "waiting",
            }),
            { status: 201, headers: { "content-type": "application/json" } },
          );
        }
        if (url.endsWith("/observations/observation-1")) {
          return new Response(
            JSON.stringify({
              observationId: "observation-1",
              targetRunId: "target-1",
              state: "completed",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.endsWith("/enrichment")) {
          return new Response(
            JSON.stringify({
              targetRunId: "target-1",
              processedDomains: ["nordlicht-example.test"],
              providerProvenance: ["apollo", "hunter", "ipinfo"],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            targetRunId: "target-1",
            tenantId: "tenant-alpha",
            controlTenantId: "tenant-beta",
            trackingScriptUrl: "https://gl-eye.example.test/sdk/track.v1.min.js",
            siteId: "site-alpha",
            ingestionToken: "test-ingestion-token-at-least-32-characters",
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      },
    });
    const prepared = await adapter.prepareRun(context);
    await adapter.configureVendorEndpoints(context, {
      ipinfo: "https://vendors.example.test/ipinfo",
      apollo: "https://vendors.example.test/apollo",
      hunter: "https://vendors.example.test/hunter",
    });
    await adapter.configureSyntheticSite(context, {
      siteId: "site-alpha",
      hostname: "run.customer-alpha.example.test",
      origin: "https://run.customer-alpha.example.test:42001",
      trackingScriptUrl: "https://gl-eye.example.test/sdk/track.v1.min.js",
      gateway: {
        proxyBaseUrl: "http://gateway.example.test/v1/proxy/route-1",
        routeToken: "secret-route-token",
        runIdHeader: context.runId,
      },
    });

    expect(prepared.ingestionToken).toBe("test-ingestion-token-at-least-32-characters");
    expect(calls[0]?.url).toBe("https://gl-eye.example.test/test-support/v1/runs");
    expect(calls[0]?.authorization).toBe("Bearer test-support-token");
    expect(calls[1]).toMatchObject({
      url: "https://gl-eye.example.test/test-support/v1/runs/target-1/vendor-endpoints",
      method: "PUT",
    });
    expect(JSON.parse(calls[1]?.body ?? "null")).toEqual({
      endpoints: {
        ipinfo: "https://vendors.example.test/ipinfo",
        apollo: "https://vendors.example.test/apollo",
        hunter: "https://vendors.example.test/hunter",
      },
    });
    expect(calls[2]).toMatchObject({
      url: "https://gl-eye.example.test/test-support/v1/runs/target-1/site",
      method: "PUT",
    });
    expect(JSON.parse(calls[2]?.body ?? "null")).toEqual({
      hostname: "run.customer-alpha.example.test",
      origin: "https://run.customer-alpha.example.test:42001",
    });
    expect(calls[2]?.body).not.toContain("secret-route-token");

    await adapter.startObservation(context);
    const completion = await adapter.waitForCompletion(context, {
      timeoutMs: 1000,
      pollIntervalMs: 1,
      expectedState: "completed",
    });

    expect(completion.completed).toBe(true);
    expect(completion.state).toBe("completed");
    expect(calls.some((call) =>
      call.url === "https://gl-eye.example.test/test-support/v1/runs/target-1/enrichment"
      && call.method === "POST"
    )).toBe(true);
  });

  it("preserves actionable GL-EYE 422 responses without exposing unknown server details", async () => {
    const valid = new GlEyeTargetAdapter({
      baseUrl: "https://gl-eye.example.test",
      environment: "test",
      authToken: "test-support-token",
      allowedOrigins: ["https://gl-eye.example.test"],
      fetchImpl: async () => new Response(JSON.stringify({
        message: "Shared Testy demo accounts are not seeded. Run ./bin/seed-demo first.",
      }), { status: 422, headers: { "content-type": "application/json" } }),
    });
    await expect(valid.prepareRun(context)).rejects.toMatchObject({
      name: "GlEyeTestSupportError",
      targetStatus: 422,
      message: "Shared Testy demo accounts are not seeded. Run ./bin/seed-demo first.",
    });

    const unsafe = new GlEyeTargetAdapter({
      baseUrl: "https://gl-eye.example.test",
      environment: "test",
      authToken: "test-support-token",
      allowedOrigins: ["https://gl-eye.example.test"],
      fetchImpl: async () => new Response(JSON.stringify({
        message: "Production internal secret: never expose this value",
      }), { status: 422, headers: { "content-type": "application/json" } }),
    });
    let error: unknown;
    try {
      await unsafe.prepareRun(context);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(GlEyeTestSupportError);
    expect(error).toMatchObject({
      targetStatus: 422,
      message: "GL-EYE test-support request failed with status 422.",
    });
    expect(String(error)).not.toContain("secret");
  });

  it("rejects production and non-allowlisted origins", () => {
    expect(
      () =>
        new GlEyeTargetAdapter({
          baseUrl: "https://gl-eye.example.test",
          environment: "production",
          authToken: "test-support-token",
          allowedOrigins: ["https://gl-eye.example.test"],
        }),
    ).toThrow(/test environments/u);
    expect(
      () =>
        new GlEyeTargetAdapter({
          baseUrl: "https://other.example.test",
          environment: "test",
          authToken: "test-support-token",
          allowedOrigins: ["https://gl-eye.example.test"],
        }),
    ).toThrow(/allowlisted/u);
  });
});
