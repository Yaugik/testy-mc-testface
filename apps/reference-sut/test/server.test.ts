import { createServer } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { startReferenceSut, type ReferenceSutBinding } from "../src/server.js";

const serviceToken = "reference-sut-service-token";
const bindings: ReferenceSutBinding[] = [];

afterEach(async () => {
  await Promise.all(bindings.splice(0).map((binding) => binding.stop()));
});

describe("reference SUT", () => {
  it("processes one idempotent event with tenant isolation", async () => {
    const provider = await startProvider();
    const target = await startReferenceSut({
      serviceToken,
      publicOrigin: "http://127.0.0.1:8080",
    });
    bindings.push(target);
    const origin = `http://127.0.0.1:${String(target.port)}`;
    const prepared = await request(origin, "/test-support/v1/runs", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        runId: "6f16a2c7-ff43-4e0b-9d35-6ead32a2047f",
        scenarioId: "reference",
        target: "reference-sut",
        environment: "local",
      }),
    });
    const targetRunId = String(prepared.targetRunId);
    await request(origin, `/test-support/v1/runs/${targetRunId}/vendor-endpoints`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({
        endpoints: { ipinfo: provider.origin, apollo: provider.origin, hunter: provider.origin },
      }),
    });
    const ingestionToken = String(prepared.ingestionToken);
    const first = await request(origin, `/test-support/v1/traffic/events?token=${ingestionToken}`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "event-1" },
      body: JSON.stringify({ eventId: "event-1" }),
    });
    const duplicate = await request(origin, `/test-support/v1/traffic/events?token=${ingestionToken}`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "event-1" },
      body: JSON.stringify({ eventId: "event-1" }),
    });
    expect(first.duplicate).toBe(false);
    expect(duplicate.duplicate).toBe(true);
    await waitFor(async () => {
      const outcome = await request(origin, `/test-support/v1/runs/${targetRunId}/outcome`, {
        headers: authHeaders(),
      });
      return outcome.companyCount === 1 ? outcome : undefined;
    });
    const outcome = await request(origin, `/test-support/v1/runs/${targetRunId}/outcome`, {
      headers: authHeaders(),
    });
    expect(outcome).toMatchObject({
      companyCount: 1,
      scoreCount: 1,
      processedEventCount: 1,
      duplicateEventCount: 1,
      confidence: "high",
    });
    expect(outcome.visibleTenantIds).toEqual([prepared.tenantId]);
    expect(outcome.providerProvenance).toEqual(["ipinfo", "apollo", "hunter"]);
    await provider.stop();
  });

  it("exposes deliberate isolation and idempotency mutations", async () => {
    const target = await startReferenceSut({ serviceToken });
    bindings.push(target);
    const origin = `http://127.0.0.1:${String(target.port)}`;
    const prepared = await request(origin, "/test-support/v1/runs", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        runId: "2e79ed57-75c1-4d40-805f-c8ca2dc484e8",
        scenarioId: "mutated",
        target: "reference-sut",
        environment: "local",
        mutations: { leakControlTenant: true, duplicateScore: true },
      }),
    });
    const outcome = await request(
      origin,
      `/test-support/v1/runs/${String(prepared.targetRunId)}/outcome`,
      { headers: authHeaders() },
    );
    expect(outcome.visibleTenantIds).toContain(prepared.controlTenantId);
  });
});

function authHeaders(): Record<string, string> {
  return { authorization: `Bearer ${serviceToken}`, "content-type": "application/json" };
}

async function request(origin: string, path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(`${origin}${path}`, init);
  const body = response.status === 204 ? {} : ((await response.json()) as Record<string, unknown>);
  if (!response.ok) throw new Error(`HTTP ${String(response.status)} ${JSON.stringify(body)}`);
  return body;
}

async function waitFor<T>(read: () => Promise<T | undefined>): Promise<T> {
  for (let index = 0; index < 50; index += 1) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for reference target.");
}

async function startProvider(): Promise<{ origin: string; stop(): Promise<void> }> {
  const server = createServer((request, response) => {
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ ok: true, path: request.url }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Provider did not bind.");
  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    stop: async () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
