import {
  createServer,
  type RequestListener,
  type Server,
} from "node:http";
import type { AddressInfo } from "node:net";

import type { RunId } from "@testy/shared-types";
import { startTrafficGateway, type TrafficGatewayBinding } from "@testy/traffic-gateway";
import { afterEach, describe, expect, it } from "vitest";

import { HttpTrafficGenerator } from "../src/index.js";

const servers: Server[] = [];
const gateways: TrafficGatewayBinding[] = [];

afterEach(async () => {
  await Promise.all(gateways.splice(0).map(async (gateway) => gateway.stop()));
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    ),
  );
});

describe("direct HTTP traffic generator", () => {
  it("routes malformed bodies through the gateway without retaining raw data", async () => {
    let forwardedFor: string | undefined;
    let suppliedSpoof: string | undefined;
    const target = await listen(async (request, response) => {
      forwardedFor = header(request.headers["x-forwarded-for"]);
      suppliedSpoof = header(request.headers["x-client-ip"]);
      const body = await readBody(request);
      try {
        JSON.parse(body);
        response.statusCode = 204;
      } catch {
        response.statusCode = 400;
      }
      response.end("target-secret-response");
    });
    const gateway = await startTrafficGateway({
      adminToken: "gateway-admin-token-test",
      allowedTargetOrigins: [target.origin],
    });
    gateways.push(gateway);
    const runId = "00000000-0000-4000-8000-000000000401" as RunId;
    const route = gateway.registry.createRoute(
      {
        runId,
        targetOrigin: target.origin,
        syntheticIp: "198.51.100.44",
        ttlMs: 60_000,
      },
      gateway.origin,
    );
    const generator = new HttpTrafficGenerator();

    const result = await generator.send(route, {
      id: "malformed-json",
      path: "/ingest?private=query-value",
      headers: {
        "x-forwarded-for": "203.0.113.200",
        "x-client-ip": "203.0.113.201",
      },
      body: {
        kind: "malformed-json",
        value: "{\"private\":\"body-value\"",
      },
      expect: { statusCodes: [400] },
    });

    expect(result.status).toBe("passed");
    expect(forwardedFor).toBe("198.51.100.44");
    expect(suppliedSpoof).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("query-value");
    expect(JSON.stringify(result)).not.toContain("body-value");
    expect(JSON.stringify(result)).not.toContain("target-secret-response");
    expect(result.attempts[0]?.pathFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(gateway.registry.listLedger(route.routeId)).toHaveLength(1);
    await expect(
      generator.send(route, {
        id: "credential-header",
        path: "/ingest",
        headers: { authorization: "Bearer not-a-synthetic-secret" },
      }),
    ).rejects.toThrow(/synthetic-data|platform-managed/u);
  });

  it("supports deterministic retries, duplicates, bounded bursts, and client aborts", async () => {
    let retryCount = 0;
    let active = 0;
    let maximumActive = 0;
    const idempotencyKeys = new Set<string>();
    const target = await listen(async (request, response) => {
      const path = new URL(request.url ?? "/", "http://target.test").pathname;
      if (path === "/retry") {
        retryCount += 1;
        response.statusCode = retryCount < 3 ? 503 : 200;
        response.end(`attempt-${retryCount}`);
        return;
      }
      if (path === "/duplicate") {
        const key = header(request.headers["idempotency-key"]) ?? "missing";
        const duplicate = idempotencyKeys.has(key);
        idempotencyKeys.add(key);
        response.statusCode = duplicate ? 409 : 201;
        response.end(duplicate ? "duplicate" : "created");
        return;
      }
      if (path.startsWith("/concurrent/")) {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 30));
        active -= 1;
        response.statusCode = 204;
        response.end();
        return;
      }
      if (path === "/slow") {
        await new Promise((resolve) => setTimeout(resolve, 200));
        response.statusCode = 200;
        response.end("late");
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    const gateway = await startTrafficGateway({
      adminToken: "gateway-admin-token-test",
      allowedTargetOrigins: [target.origin],
    });
    gateways.push(gateway);
    const runId = "00000000-0000-4000-8000-000000000402" as RunId;
    const route = gateway.registry.createRoute(
      {
        runId,
        targetOrigin: target.origin,
        syntheticIp: "203.0.113.44",
        ttlMs: 60_000,
      },
      gateway.origin,
    );
    const generator = new HttpTrafficGenerator({ maxConcurrency: 4 });

    const retry = await generator.send(route, {
      id: "retry-sequence",
      path: "/retry",
      retry: {
        attempts: 3,
        delayMs: 1,
        retryOnStatuses: [503],
      },
      expect: { statusCodes: [200], attemptCount: 3 },
    });
    const duplicates = await generator.repeat(route, {
      batchId: "duplicate-input",
      count: 3,
      concurrency: 3,
      request: {
        id: "duplicate",
        path: "/duplicate",
        idempotencyKey: "stable-idempotency-key",
        expect: { statusCodes: [201, 409] },
      },
    });
    const burst = await generator.burst(route, {
      batchId: "bounded-burst",
      concurrency: 2,
      requests: Array.from({ length: 5 }, (_, index) => ({
        id: `concurrent-${index + 1}`,
        path: `/concurrent/${index + 1}`,
        expect: { statusCodes: [204] },
      })),
    });
    const aborted = await generator.send(route, {
      id: "client-disconnect",
      path: "/slow",
      abortAfterMs: 10,
      expect: { networkFailure: true },
    });

    expect(retry.status).toBe("passed");
    expect(retry.attemptCount).toBe(3);
    expect(duplicates.status).toBe("passed");
    expect(idempotencyKeys).toEqual(new Set(["stable-idempotency-key"]));
    expect(burst.status).toBe("passed");
    expect(maximumActive).toBeLessThanOrEqual(2);
    expect(aborted.status).toBe("passed");
    expect(aborted.attempts[0]?.outcome).toBe("client-abort");
  });
});

async function listen(
  handler: RequestListener,
): Promise<{ readonly origin: string }> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${address.port}` };
}

async function readBody(request: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function header(value: string | readonly string[] | undefined): string | undefined {
  if (typeof value === "string" || value === undefined) return value;
  return value[0];
}
