/**
 * src/routes/index.ts
 *
 * Central router — mounts all feature routers under their base paths.
 * Add new routers here as features are implemented.
 */

import { Router } from "express";
import healthRouter from "./health";

const apiRouter = Router();

// ── Core ─────────────────────────────────────────────────────────────────────
apiRouter.use(healthRouter);

// ── Feature routes (not yet implemented) ─────────────────────────────────────
// apiRouter.use("/articles",  articlesRouter);
// apiRouter.use("/sources",   sourcesRouter);
// apiRouter.use("/mentions",  mentionsRouter);

export default apiRouter;
