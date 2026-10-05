import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";

import { databasePool, databaseProbe, type DatabaseProbe } from "./database.js";
import { registerInteractiveDemoRoutes } from "./demo-routes.js";
import type { InteractiveDemoService } from "./demo-service.js";
import { sanitizeError } from "./errors.js";
import { registerMaintenanceRoutes } from "./maintenance-routes.js";
import type { MaintenanceService } from "./maintenance.js";
import { PostgresScenarioRunRepository } from "./run-repository.js";
import { registerRunRoutes } from "./run-routes.js";
import { ScenarioRunService, type RunService } from "./run-service.js";
import { registerControlPlaneUi } from "./ui.js";

export interface TargetReadinessResult {
  readonly status: "ready" | "not-ready" | "unconfigured";
  readonly target?: string;
  readonly healthStatus?: number;
  readonly capabilitiesStatus?: number;
  readonly contractVersion?: string;
  readonly error?: string;
}

export interface BuildAppOptions {
  readonly database?: DatabaseProbe;
  readonly logger?: FastifyServerOptions["logger"];
  readonly runs?: RunService;
  readonly maintenance?: MaintenanceService;
  readonly maintenanceAdminToken?: string;
  readonly targetReadiness?: () => Promise<TargetReadinessResult>;
  readonly demos?: InteractiveDemoService;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
  });
  const database = options.database ?? databaseProbe;
  const runs =
    options.runs ??
    new ScenarioRunService(new PostgresScenarioRunRepository(databasePool));

  if (options.demos) {
    registerInteractiveDemoRoutes(app, options.demos);
  }
  registerControlPlaneUi(app);

  app.get("/v1/health", async () => ({
    status: "ok",
    service: "control-plane",
    timestamp: new Date().toISOString(),
  }));

  app.get("/v1/target-readiness", async (_request, reply) => {
    if (!options.targetReadiness) {
      return {
        status: "unconfigured",
        target: "none",
      };
    }

    try {
      const result = await options.targetReadiness();
      return result.status === "ready"
        ? result
        : reply.status(503).send(result);
    } catch (error) {
      const sanitizedError = sanitizeError(error);
      app.log.warn({ error: sanitizedError }, "Target readiness check failed");
      return reply.status(503).send({
        status: "not-ready",
        error: sanitizedError.message,
      });
    }
  });

  app.get("/v1/readiness", async (_request, reply) => {
    try {
      await database.check();

      return {
        status: "ready",
        service: "control-plane",
        dependencies: {
          database: "ready",
        },
        ...(options.maintenance
          ? { maintenance: options.maintenance.status() }
          : {}),
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const sanitizedError = sanitizeError(error);
      app.log.warn({ error: sanitizedError }, "Readiness check failed");

      return reply.status(503).send({
        status: "not-ready",
        service: "control-plane",
        dependencies: {
          database: "not-ready",
        },
        timestamp: new Date().toISOString(),
      });
    }
  });

  registerRunRoutes(app, runs);
  if (options.maintenance) {
    registerMaintenanceRoutes(
      app,
      options.maintenance,
      options.maintenanceAdminToken,
    );
  }
  app.setErrorHandler((error, _request, reply) => {
    const sanitizedError = sanitizeError(error);
    app.log.error({ error: sanitizedError }, "Control Plane request failed");
    return reply.status(500).send({ error: "internal-error" });
  });
  app.addHook("onClose", async () => {
    await options.maintenance?.stop();
    await options.demos?.shutdown();
    await runs.shutdown();
  });

  return app;
}
