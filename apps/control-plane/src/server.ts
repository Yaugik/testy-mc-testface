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
