/**
 * src/index.ts
 *
 * Application entry point.
 *
 * Boot order:
 *   1. Load & validate environment variables
 *   2. Verify PostgreSQL connectivity (fail fast if unreachable)
 *   3. Start the HTTP server
 *   4. Register graceful-shutdown handlers for SIGTERM / SIGINT
 */

import "./utils/env"; // Ensures env vars are validated before anything else runs
import { createApp } from "./app";
import { checkDbConnection, pool } from "./db";
import { env } from "./utils/env";
import { logger } from "./utils/logger";

async function main(): Promise<void> {
  // 1. Confirm DB is reachable before accepting traffic
  await checkDbConnection();

  // 2. Build Express app and start listening
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`Server listening`, {
      port: env.PORT,
      env: env.NODE_ENV,
    });
  });

  // 3. Graceful shutdown ───────────────────────────────────────────────────────
  async function shutdown(signal: string): Promise<void> {
    logger.info(`Received ${signal} — shutting down gracefully`);

    server.close(async () => {
      logger.info("HTTP server closed");
      await pool.end();
      logger.info("PostgreSQL pool closed");
      process.exit(0);
    });

    // Force exit if graceful shutdown takes too long
    setTimeout(() => {
      logger.error("Graceful shutdown timeout — forcing exit");
      process.exit(1);
    }, 10_000).unref();
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.error("Fatal startup error", { message });
  process.exit(1);
});
