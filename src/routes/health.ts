/**
 * src/routes/health.ts
 *
 * GET /health
 *
 * Returns a JSON payload describing service liveness and DB reachability.
 * Used by load balancers, uptime monitors, and k8s liveness probes.
 *
 * Responses:
 *   200 — service is up, DB responded within timeout
 *   503 — DB is unreachable or timed out
 */

import { Router, Request, Response } from "express";
import { pool } from "../db";
import { logger } from "../utils/logger";

const router: Router = Router();

interface HealthResponse {
  status: "ok" | "degraded";
  timestamp: string;
  uptime: number;
  database: {
    connected: boolean;
    latencyMs?: number;
    error?: string;
  };
}

router.get("/health", async (_req: Request, res: Response): Promise<void> => {
  const start = Date.now();
  let dbConnected = false;
  let dbError: string | undefined;

  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
      dbConnected = true;
    } finally {
      client.release();
    }
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
    logger.warn("Health check: DB unreachable", { error: dbError });
  }

  const latencyMs = Date.now() - start;
  const status: HealthResponse["status"] = dbConnected ? "ok" : "degraded";

  const body: HealthResponse = {
    status,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    database: {
      connected: dbConnected,
      latencyMs,
      ...(dbError !== undefined ? { error: dbError } : {}),
    },
  };

  res.status(dbConnected ? 200 : 503).json(body);
});

export default router;
