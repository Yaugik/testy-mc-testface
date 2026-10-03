import { buildApp } from "./app.js";
import { closeDatabase, databasePool } from "./database.js";
import { loadConfig } from "./config.js";
import { sanitizeError } from "./errors.js";
import {
  ControlPlaneMaintenance,
  LocalArtifactCleaner,
} from "./maintenance.js";
import { createPlatformActions } from "./platform-actions.js";
import { PostgresScenarioRunRepository } from "./run-repository.js";
import { FileScenarioCatalog } from "./scenario-catalog.js";
import { ScenarioRunService } from "./run-service.js";

const config = loadConfig();
const repository = new PostgresScenarioRunRepository(databasePool);
const platform = createPlatformActions(config, repository);
const runs = new ScenarioRunService(
  repository,
  platform.actions,
  platform.resourceCleaners,
  new FileScenarioCatalog(config.scenariosDirectory),
);
const maintenance = new ControlPlaneMaintenance(
  repository,
  platform.resourceCleaners,
  new LocalArtifactCleaner(config.generatedRunsDirectory),
  config.maintenance,
);
const app = buildApp({
  logger: { level: config.logLevel },
  runs,
  maintenance,
  targetReadiness: createTargetReadinessProbe(config),
  ...(config.maintenance.adminToken
    ? { maintenanceAdminToken: config.maintenance.adminToken }
    : {}),
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "Shutting down control plane");
  try {
    await app.close();
    await closeDatabase();
  } catch (error) {
    app.log.error(
      { error: sanitizeError(error) },
      "Control plane shutdown failed",
    );
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await runs.recoverInterruptedRuns();
  await maintenance.run();
  maintenance.start((error) => {
    app.log.error(
      { error: sanitizeError(error) },
      "Scheduled maintenance cycle failed",
    );
  });
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(
    { error: sanitizeError(error) },
    "Control plane failed to start",
  );
  await app.close().catch(() => undefined);
  await closeDatabase();
  process.exitCode = 1;
}


function createTargetReadinessProbe(config: ReturnType<typeof loadConfig>) {
  const integration = config.targetIntegration;
  if (!integration) return undefined;

  if (integration.adapter !== "gl-eye") {
    return async () => ({
      status: "unconfigured" as const,
      target: integration.adapter,
    });
  }

  return async () => {
    const baseUrl = integration.glEyeBaseUrl.replace(/\/$/u, "");
    const [health, capabilities] = await Promise.all([
      fetch(baseUrl + "/up"),
      fetch(baseUrl + "/test-support/v1/capabilities", {
        headers: {
          authorization: "Bearer " + integration.glEyeAuthToken,
        },
      }),
    ]);

    let contractVersion: string | undefined;
    let errorCode: string | undefined;

    try {
      const payload = (await capabilities.json()) as Record<string, unknown>;
      if (typeof payload.contractVersion === "string") {
        contractVersion = payload.contractVersion;
      }
      if (typeof payload.error === "string") {
        errorCode = payload.error;
      }
    } catch {
      // Status codes remain sufficient for operator diagnostics.
    }

    const ready = health.ok && capabilities.ok;
    return {
      status: ready ? "ready" as const : "not-ready" as const,
      target: "gl-eye",
      healthStatus: health.status,
      capabilitiesStatus: capabilities.status,
      ...(contractVersion ? { contractVersion } : {}),
      ...(!ready && errorCode ? { error: errorCode } : {}),
    };
  };
}
