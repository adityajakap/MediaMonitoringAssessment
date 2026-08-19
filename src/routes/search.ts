/**
 * src/routes/search.ts
 *
 * GET /mentions
 *
 * Query parameters (all optional):
 *   q        — keyword substring search across title and content (ILIKE)
 *   source   — exact match on the normalized source name (e.g. "The Star")
 *   from     — ISO 8601 lower bound on published_at (inclusive)
 *   to       — ISO 8601 upper bound on published_at (inclusive)
 *   page     — 1-indexed page number (default: 1)
 *   pageSize — rows per page (default: 20, max: 100)
 *
 * Sort order: published_at DESC NULLS LAST, id ASC
 *   Rows with null published_at sink to the bottom and are only returned
 *   when no from/to filter is applied.  See searchService.ts for details.
 *
 * Response: { data, page, pageSize, total, sort }
 */

import { Router, Request, Response } from "express";
import { searchMentions } from "../services/searchService";
import { SearchParams } from "../types/mention";
import { logger } from "../utils/logger";

const router: Router = Router();

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

// ─────────────────────────────────────────────────────────────────────────────
// Query-param parsers & validators
// ─────────────────────────────────────────────────────────────────────────────

function parsePositiveInt(
  value: unknown,
  defaultValue: number
): number | null {
  if (value === undefined || value === "") return defaultValue;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

function isValidIsoDate(value: string): boolean {
  const d = new Date(value);
  return !isNaN(d.getTime());
}

// ─────────────────────────────────────────────────────────────────────────────
// Route
// ─────────────────────────────────────────────────────────────────────────────

router.get("/mentions", async (req: Request, res: Response): Promise<void> => {
  const query = req.query;

  // ── page ──────────────────────────────────────────────────────────────────
  const page = parsePositiveInt(query["page"], DEFAULT_PAGE);
  if (page === null) {
    res.status(400).json({ error: "`page` must be a positive integer." });
    return;
  }

  // ── pageSize ───────────────────────────────────────────────────────────────
  let pageSize = parsePositiveInt(query["pageSize"], DEFAULT_PAGE_SIZE);
  if (pageSize === null) {
    res.status(400).json({ error: "`pageSize` must be a positive integer." });
    return;
  }
  if (pageSize > MAX_PAGE_SIZE) {
    pageSize = MAX_PAGE_SIZE; // silently cap rather than error — UX choice
  }

  // ── from / to ──────────────────────────────────────────────────────────────
  const fromRaw = query["from"];
  const toRaw = query["to"];

  if (fromRaw !== undefined && typeof fromRaw === "string" && !isValidIsoDate(fromRaw)) {
    res.status(400).json({ error: "`from` must be a valid ISO 8601 date string." });
    return;
  }
  if (toRaw !== undefined && typeof toRaw === "string" && !isValidIsoDate(toRaw)) {
    res.status(400).json({ error: "`to` must be a valid ISO 8601 date string." });
    return;
  }

  // ── Build params ───────────────────────────────────────────────────────────
  const params: SearchParams = { page, pageSize };

  if (typeof query["q"] === "string") params.q = query["q"];
  if (typeof query["source"] === "string") params.source = query["source"];
  if (typeof fromRaw === "string") params.from = fromRaw;
  if (typeof toRaw === "string") params.to = toRaw;

  try {
    const result = await searchMentions(params);
    res.status(200).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Search query failed", { message });
    res.status(500).json({ error: "Search failed." });
  }
});

export default router;
