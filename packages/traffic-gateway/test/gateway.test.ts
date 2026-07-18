import { createServer } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import {
  GatewayAdminClient,
  InMemoryGatewayRouteRegistry,
  isReservedSyntheticIpv4,
  startTrafficGateway,
} from "../src/index.js";
import type { RunId } from "@testy/shared-types";

const stops: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(stops.splice(0).map((stop) => stop())));

describe("traffic gateway", () => {
  it("accepts only RFC 5737 visitor addresses", () => {
    expect(isReservedSyntheticIpv4("192.0.2.10")).toBe(true);
    expect(isReservedSyntheticIpv4("198.51.100.20")).toBe(true);
    expect(isReservedSyntheticIpv4("203.0.113.30")).toBe(true);
    expect(isReservedSyntheticIpv4("8.8.8.8")).toBe(false);
  });

  it("rejects non-allowlisted and real provider origins", () => {
    const registry = new InMemoryGatewayRouteRegistry({
      allowedTargetOrigins: ["https://target.example.test", "https://api.ipinfo.io"],
    });
    expect(() => registry.createRoute({
      runId: "run-1" as RunId,
      targetOrigin: "https://other.example.test",
      syntheticIp: "198.51.100.10",
      ttlMs: 1000,
    }, "http://gateway.test")).toThrow(/allowlisted/u);
    expect(() => registry.createRoute({
      runId: "run-1" as RunId,
      targetOrigin: "https://api.ipinfo.io",
      syntheticIp: "198.51.100.10",
      ttlMs: 1000,
    }, "http://gateway.test")).toThrow(/provider/u);
  });

  it("strips spoofed attribution and internal headers", async () => {
    let observed: Record<string, string | undefined> = {};
    const target = createServer((request, response) => {
      observed = {
        forwarded: request.headers.forwarded,
        xForwardedFor: request.headers["x-forwarded-for"],
        internal: request.headers["x-testy-secret"] as string | undefined,
      };
      response.statusCode = 204;
      response.end();
    });
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
    const address = target.address();
    if (!address || typeof address === "string") throw new Error("target did not listen");
    const targetOrigin = `http://127.0.0.1:${address.port}`;
    stops.push(async () => new Promise<void>((resolve, reject) => target.close((error) => error ? reject(error) : resolve())));

    const gateway = await startTrafficGateway({
      adminToken: "test-admin-token-1234",
      allowedTargetOrigins: [targetOrigin],
    });
    stops.push(gateway.stop);
    const client = new GatewayAdminClient({
      baseUrl: gateway.origin,
      adminToken: "test-admin-token-1234",
    });
    const route = await client.createRoute({
      runId: "run-1" as RunId,
      targetOrigin,
      syntheticIp: "198.51.100.10",
      ttlMs: 60_000,
    });
    const response = await fetch(`${route.proxyBaseUrl}/collect?email=private@example.test`, {
      headers: {
        "x-testy-route-token": route.routeToken,
        "x-testy-run-id": "run-1",
        "x-testy-secret": "must-not-forward",
        "x-forwarded-for": "8.8.8.8",
        forwarded: "for=8.8.8.8",
      },
    });
    expect(response.status).toBe(204);
    expect(observed.xForwardedFor).toBe("198.51.100.10");
    expect(observed.forwarded).toContain("198.51.100.10");
    expect(observed.internal).toBeUndefined();
    const ledger = await client.getLedger(route.routeId);
    expect(ledger).toHaveLength(1);
    expect(JSON.stringify(ledger)).not.toContain("private@example.test");
    expect(JSON.stringify(ledger)).not.toContain("198.51.100.10");
  });
});
