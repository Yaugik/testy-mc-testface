import { Pool } from "pg";

import { loadConfig } from "./config.js";

const config = loadConfig();

export const databasePool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export interface DatabaseProbe {
  check(): Promise<void>;
}

export const databaseProbe: DatabaseProbe = {
  async check(): Promise<void> {
    await databasePool.query("SELECT 1");
  },
};

export async function closeDatabase(): Promise<void> {
  await databasePool.end();
}
