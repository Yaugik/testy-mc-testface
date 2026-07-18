import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";

import { databaseProbe, type DatabaseProbe } from "./database.js";
import { sanitizeError } from "./errors.js";

export interface BuildAppOptions {
  readonly database?: DatabaseProbe;
  readonly logger?: FastifyServerOptions["logger"];
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
  });
  const database = options.database ?? databaseProbe;

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

  return app;
}
