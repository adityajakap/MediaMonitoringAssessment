/**
 * src/routes/stats.ts
 *
 * GET /mentions/stats
 *
 * Query parameters:
 *   group_by — required. Must be either "source" or "day".
 *
 * Response:
 *   [{ source, count }, ...] for group_by=source (descending count)
 *   [{ day, count }, ...] for group_by=day (ascending date, nulls excluded)
 */

import { Router, Request, Response } from "express";
import { getStatsBySource, getStatsByDay } from "../services/statsService";
import { logger } from "../utils/logger";
import { GroupByMode } from "../types/mention";

const router: Router = Router();

router.get("/mentions/stats", async (req: Request, res: Response): Promise<void> => {
  const groupBy = req.query["group_by"];

  if (groupBy !== "source" && groupBy !== "day") {
    res.status(400).json({
      error: "Missing or invalid `group_by` parameter. Must be 'source' or 'day'.",
    });
    return;
  }

  const mode = groupBy as GroupByMode;

  try {
    let data;
    if (mode === "source") {
      data = await getStatsBySource();
    } else {
      data = await getStatsByDay();
    }
    res.status(200).json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Stats query failed", { message, mode });
    res.status(500).json({ error: "Stats query failed." });
  }
});

export default router;
