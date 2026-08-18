/**
 * src/routes/index.ts
 *
 * Central router — mounts all feature routers under their base paths.
 * Add new routers here as features are implemented.
 */

import { Router } from "express";
import healthRouter from "./health";
import ingestRouter from "./ingest";

const apiRouter = Router();

// ── Core ─────────────────────────────────────────────────────────────────────
apiRouter.use(healthRouter);

// ── Ingest ────────────────────────────────────────────────────────────────────
apiRouter.use(ingestRouter);

// ── Future feature routes ─────────────────────────────────────────────────────
// apiRouter.use("/articles",  articlesRouter);
// apiRouter.use("/sources",   sourcesRouter);
// apiRouter.use("/mentions",  mentionsRouter);

export default apiRouter;
