/**
 * src/routes/index.ts
 *
 * Central router — mounts all feature routers under their base paths.
 * Add new routers here as features are implemented.
 */

import { Router } from "express";
import healthRouter from "./health";
import ingestRouter from "./ingest";
import searchRouter from "./search";
import statsRouter from "./stats";

const apiRouter: Router = Router();

// ── Core ─────────────────────────────────────────────────────────────────────
apiRouter.use(healthRouter);

// ── Ingest ────────────────────────────────────────────────────────────────────
apiRouter.use(ingestRouter);

// ── Search ────────────────────────────────────────────────────────────────────
apiRouter.use(searchRouter);

// ── Stats ─────────────────────────────────────────────────────────────────────
apiRouter.use(statsRouter);

// ── Future feature routes ─────────────────────────────────────────────────────
// apiRouter.use("/articles",  articlesRouter);
// apiRouter.use("/sources",   sourcesRouter);

export default apiRouter;
