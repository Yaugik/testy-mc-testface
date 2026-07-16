import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe("control plane health endpoints", () => {
  it("returns a liveness response without probing the database", async () => {
    const database = {
      check: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };
    const app = buildApp({ database });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      service: "control-plane",
    });
    expect(database.check).not.toHaveBeenCalled();
  });

  it("reports ready when PostgreSQL is reachable", async () => {
    const database = {
      check: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };
    const app = buildApp({ database });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/readiness",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ready",
      dependencies: {
        database: "ready",
      },
    });
    expect(database.check).toHaveBeenCalledOnce();
  });

  it("returns 503 without leaking the database error", async () => {
    const database = {
      check: vi.fn<() => Promise<void>>().mockRejectedValue(
        new Error("password=do-not-log host=internal-db"),
      ),
    };
    const app = buildApp({ database });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/readiness",
    });

    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain("do-not-log");
    expect(response.body).not.toContain("internal-db");
    expect(response.json()).toMatchObject({
      status: "not-ready",
      dependencies: {
        database: "not-ready",
      },
    });
  });
});
