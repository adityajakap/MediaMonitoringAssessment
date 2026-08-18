/**
 * src/app.ts
 *
 * Builds and exports the Express application instance without starting the
 * HTTP server. Keeping app creation separate from server startup lets tests
 * import `app` directly (via supertest) without binding to a real port.
 */

import express, { Application, Request, Response, NextFunction } from "express";
import apiRouter from "./routes";
import { logger } from "./utils/logger";

export function createApp(): Application {
  const app = express();

  // ── Request parsing ─────────────────────────────────────────────────────────
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // ── Request logging ─────────────────────────────────────────────────────────
  app.use((req: Request, _res: Response, next: NextFunction) => {
    logger.info(`${req.method} ${req.path}`);
    next();
  });

  // ── Routes ──────────────────────────────────────────────────────────────────
  app.use("/", apiRouter);

  // ── 404 handler ─────────────────────────────────────────────────────────────
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "Not found" });
  });

  // ── Global error handler ─────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : "Internal server error";
    logger.error("Unhandled error", { message });
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
