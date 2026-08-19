/**
 * src/routes/ingest.ts
 *
 * POST /internal/mentions/bulk
 *
 * Internal-only ingestion endpoint. Accepts a JSON array of raw mention
 * records, normalises each one, and bulk-upserts them into the `mentions`
 * table.  All records are wrapped in a single DB transaction; per-record
 * SAVEPOINTs allow url_normalized duplicates to be skipped without aborting
 * the whole batch.
 *
 * Response (200):
 *   { inserted: n, updated: n, skipped_as_duplicate: n }
 *
 * Error responses:
 *   400 — body is not a non-empty array, or a record is missing required fields
 *   500 — unexpected DB or server error
 */

import { Router, Request, Response } from "express";
import { pool } from "../db";
import { bulkInsertMentions, normalizeRawMention } from "../services/mentionService";
import { RawMentionInput } from "../types/mention";
import { logger } from "../utils/logger";

const router: Router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Validation helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a human-readable error message if the record is missing required
 * fields, or null if it is valid.
 */
function validateRecord(
  record: unknown,
  index: number
): string | null {
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    return `Record at index ${index} is not an object.`;
  }
  const r = record as Record<string, unknown>;
  if (typeof r["external_id"] !== "string" || r["external_id"].trim() === "") {
    return `Record at index ${index} is missing required field: external_id.`;
  }
  if (typeof r["source"] !== "string" || r["source"].trim() === "") {
    return `Record at index ${index} is missing required field: source.`;
  }
  if (typeof r["url"] !== "string" || r["url"].trim() === "") {
    return `Record at index ${index} is missing required field: url.`;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Route
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  "/internal/mentions/bulk",
  async (req: Request, res: Response): Promise<void> => {
    // ── Input validation ────────────────────────────────────────────────────

    if (!Array.isArray(req.body)) {
      res.status(400).json({
        error: "Request body must be a JSON array of mention records.",
      });
      return;
    }

    if (req.body.length === 0) {
      res.status(400).json({
        error: "Request body array must not be empty.",
      });
      return;
    }

    // Validate each record before touching the DB — fail fast on bad input.
    for (let i = 0; i < req.body.length; i++) {
      const validationError = validateRecord(req.body[i], i);
      if (validationError !== null) {
        res.status(400).json({ error: validationError });
        return;
      }
    }

    // ── Normalise ───────────────────────────────────────────────────────────

    const rawRecords = req.body as RawMentionInput[];
    const normalised = rawRecords.map(normalizeRawMention);

    // ── DB transaction ──────────────────────────────────────────────────────

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const summary = await bulkInsertMentions(client, normalised);

      await client.query("COMMIT");

      logger.info("Bulk ingest complete", {
        total: rawRecords.length,
        ...summary,
      });

      res.status(200).json(summary);
    } catch (err) {
      await client.query("ROLLBACK");

      const message = err instanceof Error ? err.message : String(err);
      logger.error("Bulk ingest failed — transaction rolled back", { message });

      res.status(500).json({ error: "Bulk ingest failed. Transaction rolled back." });
    } finally {
      client.release();
    }
  }
);

export default router;
