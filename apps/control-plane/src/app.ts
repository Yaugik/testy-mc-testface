import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";

import { databasePool, databaseProbe, type DatabaseProbe } from "./database.js";
import { sanitizeError } from "./errors.js";
import { PostgresScenarioRunRepository } from "./run-repository.js";
import { registerRunRoutes } from "./run-routes.js";
import { ScenarioRunService, type RunService } from "./run-service.js";

export interface BuildAppOptions {
  readonly database?: DatabaseProbe;
  readonly logger?: FastifyServerOptions["logger"];
  readonly runs?: RunService;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
  });
  const database = options.database ?? databaseProbe;
  const runs =
    options.runs ??
    new ScenarioRunService(new PostgresScenarioRunRepository(databasePool));

  app.get("/v1/health", async () => ({
    status: "ok",
    service: "control-plane",
    timestamp: new Date().toISOString(),
  }));

  app.get("/v1/readiness", async (_request, reply) => {
    try {
      await database.check();

      return {
        status: "ready",
        service: "control-plane",
        dependencies: {
          database: "ready",
        },
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
  app.setErrorHandler((error, _request, reply) => {
    const sanitizedError = sanitizeError(error);
    app.log.error({ error: sanitizedError }, "Control Plane request failed");
    return reply.status(500).send({ error: "internal-error" });
  });
  app.addHook("onClose", async () => {
    await runs.shutdown();
  });

  return app;
}
