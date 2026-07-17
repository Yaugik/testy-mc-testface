import type { FastifyInstance } from "fastify";
import type { RunId } from "@testy/shared-types";
import { ScenarioValidationError } from "@testy/scenario-engine";

import { ScenarioNotFoundError, type RunService } from "./run-service.js";

interface RunParams {
  readonly runId: string;
}

export function registerRunRoutes(app: FastifyInstance, runs: RunService): void {
  app.get("/v1/scenarios", async () => ({
    scenarios: (await runs.listScenarios()).map((scenario) => ({
      scenarioId: scenario.scenarioId,
      displayName: scenario.displayName,
      target: scenario.target,
      contentHash: scenario.contentHash,
    })),
  }));

  app.get<{ Params: { readonly scenarioId: string } }>(
    "/v1/scenarios/:scenarioId",
    async (request, reply) => {
      const scenario = await runs.getScenario(request.params.scenarioId);
      return scenario ?? reply.status(404).send({ error: "scenario-not-found" });
    },
  );

  app.post("/v1/scenarios/validate", async (request, reply) => {
    try {
      const scenario = await runs.validate(request.body);
      return {
        valid: true,
        scenarioId: scenario.scenarioId,
        target: scenario.target,
        contentHash: scenario.contentHash,
        resolvedScenario: scenario,
      };
    } catch (error) {
      if (error instanceof ScenarioValidationError) {
        return reply.status(400).send({ valid: false, issues: error.issues });
      }
      throw error;
    }
  });

  app.post("/v1/runs", async (request, reply) => {
    try {
      const created = await runs.create(request.body);
      return reply.status(202).send(created.run);
    } catch (error) {
      if (error instanceof ScenarioValidationError) {
        return reply.status(400).send({ error: "scenario-invalid", issues: error.issues });
      }
      if (error instanceof ScenarioNotFoundError) {
        return reply.status(404).send({ error: "scenario-not-found" });
      }
      throw error;
    }
  });

  app.get<{ Params: RunParams }>("/v1/runs/:runId", async (request, reply) => {
    const run = await runs.get(request.params.runId as RunId);
    return run ?? reply.status(404).send({ error: "run-not-found" });
  });

  app.post<{ Params: RunParams }>(
    "/v1/runs/:runId/cancel",
    async (request, reply) => {
      const runId = request.params.runId as RunId;
      const existing = await runs.get(runId);
      if (!existing) return reply.status(404).send({ error: "run-not-found" });
      const accepted = await runs.cancel(runId);
      if (!accepted) {
        return reply.status(409).send({
          error: "run-not-cancellable",
          status: existing.status,
        });
      }
      return reply.status(202).send({ runId, cancellationRequested: true });
    },
  );

  app.get<{ Params: RunParams }>(
    "/v1/runs/:runId/timeline",
    async (request, reply) => {
      const runId = request.params.runId as RunId;
      if (!(await runs.get(runId))) {
        return reply.status(404).send({ error: "run-not-found" });
      }
      return { runId, events: await runs.timeline(runId) };
    },
  );

  app.get<{ Params: RunParams }>(
    "/v1/runs/:runId/report",
    async (request, reply) => {
      const report = await runs.report(request.params.runId as RunId);
      return report ?? reply.status(404).send({ error: "run-not-found" });
    },
  );

  app.get<{ Params: RunParams }>(
    "/v1/runs/:runId/artifacts",
    async (request, reply) => {
      const runId = request.params.runId as RunId;
      if (!(await runs.get(runId))) {
        return reply.status(404).send({ error: "run-not-found" });
      }
      return { runId, artifacts: await runs.artifacts(runId) };
    },
  );
}
