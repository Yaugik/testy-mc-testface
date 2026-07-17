import type { FastifyInstance } from "fastify";

import {
  verifyMaintenanceToken,
  type MaintenanceService,
} from "./maintenance.js";

export function registerMaintenanceRoutes(
  app: FastifyInstance,
  maintenance: MaintenanceService,
  adminToken?: string,
): void {
  app.get("/v1/maintenance", async () => maintenance.status());

  app.post("/v1/maintenance/run", async (request, reply) => {
    if (!verifyMaintenanceToken(adminToken, request.headers.authorization)) {
      return reply.status(adminToken ? 401 : 404).send({
        error: adminToken ? "unauthorized" : "maintenance-trigger-disabled",
      });
    }
    return maintenance.run();
  });
}
