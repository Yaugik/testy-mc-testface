import { afterEach, describe, expect, it } from "vitest";

import {
  startReferenceSut,
  type ReferenceSutBinding,
} from "../src/hardened-server.js";

const serviceToken = "reference-sut-service-token";
const bindings: ReferenceSutBinding[] = [];

afterEach(async () => {
  await Promise.all(bindings.splice(0).map((binding) => binding.stop()));
});

describe("hardened reference SUT entrypoint", () => {
  it("proxies the canonical contract and returns a proper authentication error", async () => {
    const binding = await startReferenceSut({ serviceToken });
    bindings.push(binding);

    expect((await fetch(`${binding.origin}/v1/health`)).status).toBe(200);

    const unauthorized = await fetch(`${binding.origin}/test-support/v1/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId: "9a3c6461-5b62-44e1-bbbc-2e785ca49c42",
        scenarioId: "authentication-check",
        target: "reference-sut",
        environment: "local",
      }),
    });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("www-authenticate")).toBe("Bearer");

    const authorized = await fetch(`${binding.origin}/test-support/v1/runs`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        runId: "9a3c6461-5b62-44e1-bbbc-2e785ca49c42",
        scenarioId: "authentication-check",
        target: "reference-sut",
        environment: "local",
      }),
    });
    expect(authorized.status).toBe(201);
  });

  it("supports browser preflight and deterministic HTTP negative probes", async () => {
    const binding = await startReferenceSut({ serviceToken });
    bindings.push(binding);

    const preflight = await fetch(
      `${binding.origin}/test-support/v1/traffic/idempotent`,
      {
        method: "OPTIONS",
        headers: {
          origin: "http://synthetic-site.test",
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type,idempotency-key",
        },
      },
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflight.headers.get("access-control-allow-headers")).toContain(
      "idempotency-key",
    );

    const malformedJson = await fetch(
      `${binding.origin}/test-support/v1/traffic/malformed-json`,
      { method: "POST", body: "{\"broken\":" },
    );
    expect(malformedJson.status).toBe(400);

    const malformedForm = await fetch(
      `${binding.origin}/test-support/v1/traffic/malformed-form`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "company=%E0%A4%A&consent=unknown",
      },
    );
    expect(malformedForm.status).toBe(422);

    const attribution = await fetch(
      `${binding.origin}/test-support/v1/traffic/attribution`,
      {
        method: "POST",
        headers: { "x-forwarded-for": "192.0.2.250" },
        body: JSON.stringify({ eventId: "attribution-event" }),
      },
    );
    expect(attribution.status).toBe(204);
    expect(attribution.headers.get("x-reference-source-fingerprint")).toMatch(
      /^[a-f0-9]{64}$/u,
    );

    const idempotentRequest = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "synthetic-idempotency-key-001",
      },
      body: JSON.stringify({ eventId: "synthetic-duplicate-event" }),
    } satisfies RequestInit;
    expect(
      (
        await fetch(
          `${binding.origin}/test-support/v1/traffic/idempotent`,
          idempotentRequest,
        )
      ).status,
    ).toBe(202);
    expect(
      (
        await fetch(
          `${binding.origin}/test-support/v1/traffic/idempotent`,
          idempotentRequest,
        )
      ).status,
    ).toBe(409);

    const retryRequest = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId: "synthetic-retry-event" }),
    } satisfies RequestInit;
    const retryUrl = `${binding.origin}/test-support/v1/traffic/retry`;
    expect((await fetch(retryUrl, retryRequest)).status).toBe(503);
    expect((await fetch(retryUrl, retryRequest)).status).toBe(503);
    expect((await fetch(retryUrl, retryRequest)).status).toBe(202);

    const burstResponses = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        fetch(
          `${binding.origin}/test-support/v1/traffic/burst?ordinal=${String(index + 1)}`,
        ),
      ),
    );
    expect(burstResponses.every((response) => response.status === 204)).toBe(true);
  });
});

function authHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${serviceToken}`,
    "content-type": "application/json",
  };
}
