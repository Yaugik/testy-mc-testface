import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { databasePool } from "./database.js";
import { sanitizeError } from "./errors.js";

const migrationsDirectory =
  process.env.MIGRATIONS_DIR ??
  fileURLToPath(new URL("../../../infrastructure/database/migrations/", import.meta.url));

interface AppliedMigration {
  readonly checksum: string;
}

async function runMigrations(): Promise<void> {
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS platform_schema_migrations (
      name TEXT PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const migrationNames = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const migrationName of migrationNames) {
    const sql = await readFile(join(migrationsDirectory, migrationName), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");

    const existing = await databasePool.query<AppliedMigration>(
      "SELECT checksum FROM platform_schema_migrations WHERE name = $1",
      [migrationName],
    );

    if (existing.rowCount === 1) {
      const appliedChecksum = existing.rows[0]?.checksum.trim();
      if (appliedChecksum !== checksum) {
        throw new Error(`Migration ${migrationName} changed after it was applied`);
      }

      continue;
    }

    const client = await databasePool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO platform_schema_migrations (name, checksum) VALUES ($1, $2)",
        [migrationName, checksum],
      );
      await client.query("COMMIT");
      console.info(`Applied migration ${migrationName}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

try {
  await runMigrations();
} catch (error) {
  console.error("Database migration failed", sanitizeError(error));
  process.exitCode = 1;
} finally {
  await databasePool.end();
}
