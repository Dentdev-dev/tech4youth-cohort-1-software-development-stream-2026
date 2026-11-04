import pg from "pg";
import { env } from "../config/env.ts";

// NUMERIC (oid 1700) comes back as a string by default; parse it to a JS number.
pg.types.setTypeParser(1700, (value) => parseFloat(value));

export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
});

/** Run `fn` inside a transaction, committing on success and rolling back on error. */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
