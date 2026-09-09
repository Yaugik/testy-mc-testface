import { describe, expect, it } from "vitest";

import type { RunId, ScenarioId } from "@testy/shared-types";
import type { AdapterRunContext } from "@testy/target-adapter";
import { GlEyeTargetAdapter } from "../src/index.js";

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
        if (url.endsWith("/vendor-endpoints")) {
          return new Response(null, { status: 204 });
        }
        return new Response(
          JSON.stringify({
            targetRunId: "target-1",
            tenantId: "tenant-alpha",
            controlTenantId: "tenant-beta",
            trackingScriptUrl: "https://gl-eye.example.test/tracker.js",
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
