import path from "node:path";
import { pool } from "../lib/db.ts";
import fs from "node:fs";
import { logger } from "../lib/logger.ts";

const MIGRATION_DIR = path.join(process.cwd(), "migrations");

const CREATE_MIGRATION_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS migrations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    executed_at TIMESTAMP NOT NULL DEFAULT NOW()
)
`;

type MigrationRow = {
  name: string;
};

async function getExcutedMigrations(): Promise<string[]> {
  const result = await pool.query<MigrationRow>(
    "SELECT name FROM migrations ORDER BY name",
  );

  return result.rows.map((row: MigrationRow) => row.name);
}

function getMigrationFiles(): string[] {
  return fs
    .readdirSync(MIGRATION_DIR)
    .filter((file) => file.endsWith("sql"))
    .sort();
}

async function runMigration(fileName: string): Promise<void> {
  const sql = fs.readFileSync(path.join(MIGRATION_DIR, fileName), "utf-8");
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO migrations (name) values ($1)", [fileName]);
    await client.query("COMMIT");

    logger.info(`migration completed ${fileName}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function migrate(): Promise<void> {
  await pool.query(CREATE_MIGRATION_TABLE_SQL);

  const executed = new Set(await getExcutedMigrations());
  const pending = getMigrationFiles().filter((file) => !executed.has(file));

  if (pending.length === 0) {
    logger.info("no pending migration");
  }

  for (const fileName of pending) {
    await runMigration(fileName);
  }

  logger.info("all migration completed");
}

migrate()
  .catch((error) => {
    logger.error({ err: error }, "migration failed");
    process.exit(1);
  })
  .finally(() => pool.end());
