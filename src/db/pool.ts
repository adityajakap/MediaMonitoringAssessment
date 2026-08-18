/**
 * src/db/pool.ts
 *
 * Creates and exports the single application-wide pg.Pool instance.
 * All database access goes through this pool — never create ad-hoc clients.
 *
 * Raw SQL is written directly in service files (no ORM), keeping queries
 * explicit, auditable, and easy to optimize with EXPLAIN ANALYZE.
 */

import { Pool } from "pg";
import { env } from "../utils/env";
import { logger } from "../utils/logger";

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  // Keep a small idle pool; tune per environment.
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err: Error) => {
  logger.error("Unexpected pg pool error", { message: err.message });
});

/**
 * Verifies that the pool can reach PostgreSQL.
 * Called once at startup — throws if the DB is unreachable so the process
 * exits immediately with a clear error rather than serving requests.
 */
export async function checkDbConnection(): Promise<void> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ now: Date }>("SELECT NOW() AS now");
    const serverTime = result.rows[0]?.now;
    logger.info("PostgreSQL connection verified", {
      serverTime: serverTime?.toISOString() ?? "unknown",
    });
  } finally {
    client.release();
  }
}
