import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerMaintenanceRoutes } from "../src/maintenance-routes.js";
import type { MaintenanceService } from "../src/maintenance.js";

const apps: ReturnType<typeof Fastify>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe("maintenance routes", () => {
  it("exposes status without exposing the manual trigger", async () => {
    const maintenance = fakeMaintenance();
    const app = Fastify();
    apps.push(app);
    registerMaintenanceRoutes(app, maintenance);

    const status = await app.inject({ method: "GET", url: "/v1/maintenance" });
    const trigger = await app.inject({
      method: "POST",
      url: "/v1/maintenance/run",
    });

    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ running: false, scheduled: false });
    expect(trigger.statusCode).toBe(404);
  });

  it("requires the configured bearer token for manual cycles", async () => {
    const maintenance = fakeMaintenance();
    const app = Fastify();
    apps.push(app);
    registerMaintenanceRoutes(app, maintenance, "1234567890abcdef");

    const denied = await app.inject({
      method: "POST",
      url: "/v1/maintenance/run",
      headers: { authorization: "Bearer wrong" },
    });
    const accepted = await app.inject({
      method: "POST",
      url: "/v1/maintenance/run",
      headers: { authorization: "Bearer 1234567890abcdef" },
    });

    expect(denied.statusCode).toBe(401);
    expect(accepted.statusCode).toBe(200);
    expect(maintenance.run).toHaveBeenCalledOnce();
  });
});

function fakeMaintenance(): MaintenanceService & {
  run: ReturnType<typeof vi.fn>;
} {
  return {
    run: vi.fn().mockResolvedValue({
      startedAt: "2026-07-17T00:00:00.000Z",
      completedAt: "2026-07-17T00:00:01.000Z",
      leases: { claimed: 0, released: 0, failed: 0 },
      artifacts: { claimed: 0, deleted: 0, failed: 0 },
    }),
    start: () => undefined,
    stop: async () => undefined,
    status: () => ({ running: false, scheduled: false }),
  };
}
