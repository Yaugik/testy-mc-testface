import { buildApp } from "./app.js";
import { closeDatabase } from "./database.js";
import { loadConfig } from "./config.js";
import { sanitizeError } from "./errors.js";

const config = loadConfig();
const app = buildApp({
  logger: {
    level: config.logLevel,
  },
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  app.log.info({ signal }, "Shutting down control plane");

  try {
    await app.close();
    await closeDatabase();
  } catch (error) {
    app.log.error({ error: sanitizeError(error) }, "Control plane shutdown failed");
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

try {
  await app.listen({
    host: config.host,
    port: config.port,
  });
} catch (error) {
  app.log.error({ error: sanitizeError(error) }, "Control plane failed to start");
  await closeDatabase();
  process.exitCode = 1;
}
