import { afterEach, describe, expect, it } from "vitest";

import { startReferenceSut, type ReferenceSutBinding } from "../src/index.js";

const bindings: ReferenceSutBinding[] = [];
afterEach(async () => {
  await Promise.all(bindings.splice(0).map((binding) => binding.stop()));
});

const token = "reference-contract-token-test";
const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };

describe("reference SUT target contract", () => {
  it("implements authenticated lifecycle, idempotency, isolation, and cleanup", async () => {
    const providerCalls: string[] = [];
    const binding = await startReferenceSut({
      authToken: token,
      fetchImpl: async (input) => {
        providerCalls.push(String(input));
        return new Response("{}", { status: 200 });
      },
    });
    bindings.push(binding);

    expect((await fetch(`${binding.origin}/v1/health`)).status).toBe(200);
    expect(
      (await fetch(`${binding.origin}/test-support/v1/runs`, { method: "POST" })).status,
    ).toBe(401);

    const prepared = await json(
      fetch(`${binding.origin}/test-support/v1/runs`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          runId: "00000000-0000-4000-8000-000000000701",
          scenarioId: "reference-vertical",
          target: "reference-sut",
          environment: "local",
        }),
      }),
    );
    const targetRunId = String(prepared.targetRunId);
    expect(prepared.contractVersion).toBe("1.0");
    expect(String(prepared.trackingScriptUrl)).toContain(targetRunId);

    expect(
      (
        await fetch(
          `${binding.origin}/test-support/v1/runs/${targetRunId}/vendor-endpoints`,
          {
            method: "PUT",
            headers: auth,
            body: JSON.stringify({
              endpoints: {
                ipinfo: "http://providers.test/ipinfo/",
                apollo: "http://providers.test/apollo/",
                hunter: "http://providers.test/hunter/",
              },
            }),
          },
        )
      ).status,
    ).toBe(204);

    const observation = await json(
      fetch(`${binding.origin}/test-support/v1/runs/${targetRunId}/observations`, {
        method: "POST",
        headers: auth,
        body: "{}",
      }),
    );
    const eventUrl = `${binding.origin}/test-support/v1/traffic/idempotent?targetRunId=${targetRunId}`;
    const eventInit = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "reference-event-key",
      },
      body: JSON.stringify({ eventId: "reference-event-001" }),
    };
    expect((await fetch(eventUrl, eventInit)).status).toBe(202);
    expect((await fetch(eventUrl, eventInit)).status).toBe(409);

    const status = await json(
      fetch(
        `${binding.origin}/test-support/v1/runs/${targetRunId}/observations/${String(observation.observationId)}`,
        { headers: auth },
      ),
    );
    expect(status).toMatchObject({ completed: true, state: "completed" });

    const outcome = await json(
      fetch(`${binding.origin}/test-support/v1/runs/${targetRunId}/outcome`, {
        headers: auth,
      }),
    );
    expect(outcome.companyCount).toBe(1);
    expect(outcome.scoreCount).toBe(1);
    expect(outcome.duplicateEventCount).toBe(1);
    expect(outcome.visibleTenantIds).toEqual([prepared.tenantId]);
    expect(outcome.providerSequence).toEqual(["ipinfo", "apollo", "hunter"]);
    expect(providerCalls).toHaveLength(3);

    expect(
      (
        await fetch(`${binding.origin}/test-support/v1/runs/${targetRunId}`, {
          method: "DELETE",
          headers: auth,
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await fetch(`${binding.origin}/test-support/v1/runs/${targetRunId}/outcome`, {
          headers: auth,
        })
      ).status,
    ).toBe(404);
  });

  it("provides deterministic mutation switches for assertion testing", async () => {
    const binding = await startReferenceSut({
      authToken: token,
      mutations: { leakToControlTenant: true, duplicateScores: true },
    });
    bindings.push(binding);
    const prepared = await json(
      fetch(`${binding.origin}/test-support/v1/runs`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          runId: "00000000-0000-4000-8000-000000000702",
          scenarioId: "reference-mutation",
          target: "reference-sut",
          environment: "local",
        }),
      }),
    );
    const targetRunId = String(prepared.targetRunId);
    const endpoint = `${binding.origin}/test-support/v1/traffic/idempotent?targetRunId=${targetRunId}`;
    const init = {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "duplicate" },
      body: JSON.stringify({ eventId: "duplicate-event" }),
    };
    expect((await fetch(endpoint, init)).status).toBe(202);
    expect((await fetch(endpoint, init)).status).toBe(409);
    const outcome = await json(
      fetch(`${binding.origin}/test-support/v1/runs/${targetRunId}/outcome`, {
        headers: auth,
      }),
    );
    expect(outcome.scoreCount).toBe(2);
    expect(outcome.visibleTenantIds).toContain(prepared.controlTenantId);
  });

  it("implements malformed, retry, slow, and bounded burst endpoints", async () => {
    const binding = await startReferenceSut({ authToken: token });
    bindings.push(binding);
    const prepared = await json(
      fetch(`${binding.origin}/test-support/v1/runs`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          runId: "00000000-0000-4000-8000-000000000703",
          scenarioId: "reference-negative",
          target: "reference-sut",
          environment: "local",
        }),
      }),
    );
    const targetRunId = String(prepared.targetRunId);
    expect(
      (
        await fetch(`${binding.origin}/test-support/v1/traffic/malformed-json`, {
          method: "POST",
          body: '{"broken":',
        })
      ).status,
    ).toBe(400);
    const retryUrl = `${binding.origin}/test-support/v1/traffic/retry?targetRunId=${targetRunId}`;
    const retryInit = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId: "retry-event" }),
    };
    expect((await fetch(retryUrl, retryInit)).status).toBe(503);
    expect((await fetch(retryUrl, retryInit)).status).toBe(503);
    expect((await fetch(retryUrl, retryInit)).status).toBe(202);

    await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        fetch(
          `${binding.origin}/test-support/v1/traffic/burst?targetRunId=${targetRunId}&ordinal=${index}`,
        ),
      ),
    );
    const outcome = await json(
      fetch(`${binding.origin}/test-support/v1/runs/${targetRunId}/outcome`, {
        headers: auth,
      }),
    );
    expect(Number(outcome.maximumBurstConcurrency)).toBeGreaterThan(1);
  });
});

async function json(responsePromise: Promise<Response>): Promise<Record<string, unknown>> {
  const response = await responsePromise;
  expect(response.ok).toBe(true);
  return (await response.json()) as Record<string, unknown>;
}
