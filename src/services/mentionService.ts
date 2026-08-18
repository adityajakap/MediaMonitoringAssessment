/**
 * src/services/mentionService.ts
 *
 * Database-layer logic for the mentions ingest pipeline.
 *
 * Design notes:
 *
 * ON CONFLICT strategy — DO UPDATE vs. DO NOTHING
 * ─────────────────────────────────────────────────
 * We use DO UPDATE instead of DO NOTHING so that re-posting the same ingest
 * file is a true no-op in terms of row count but still refreshes mutable
 * fields (title, content, engagement, etc.) if the source record changed
 * between runs.  `updated_at` is bumped on every successful conflict-update,
 * giving an audit trail of retries even when data is unchanged.
 *
 * Dual unique-constraint problem
 * ───────────────────────────────
 * The mentions table has TWO unique constraints:
 *   1. (source, external_id) — the ON CONFLICT target above.
 *   2. url_normalized         — a cross-pipeline dedup signal.
 *
 * Postgres supports only ONE ON CONFLICT target per INSERT, so we cannot
 * handle both in a single SQL statement.  We use approach (b) from the spec:
 *
 *   • Wrap each INSERT in a per-record SAVEPOINT.
 *   • If the INSERT throws SQLSTATE 23505 AND the constraint name is
 *     'uq_mentions_url_normalized', roll back to the savepoint and count
 *     the record as `skipped_as_duplicate`.
 *   • Any other error re-throws, unwinding the whole transaction.
 *
 * Why (b) over (a) [pre-check SELECT]:
 *   • No extra DB round-trip in the happy path.
 *   • Avoids a TOCTOU race: another concurrent transaction could insert the
 *     same URL between our SELECT and our INSERT.
 *   • The DB is the authoritative source of truth — we let it detect the
 *     conflict rather than trying to predict it.
 *
 * RETURNING (xmax = 0) AS is_insert
 * ────────────────────────────────────
 * xmax = 0 means the tuple was freshly written (INSERT).
 * xmax > 0 means the tuple was the result of an UPDATE (ON CONFLICT fired).
 * This lets us distinguish inserts from conflict-updates in one round-trip.
 */

import { PoolClient } from "pg";
import {
  NormalizedMention,
  RawMentionInput,
  BulkIngestSummary,
} from "../types/mention";
import {
  normalizeSource,
  normalizeUrl,
  parsePublishedAt,
  parseEngagement,
  sanitizeContent,
  normalizeTitle,
} from "../utils/normalize";

// ─────────────────────────────────────────────────────────────────────────────
// Type helpers
// ─────────────────────────────────────────────────────────────────────────────

interface DatabaseError extends Error {
  code: string;
  constraint?: string;
  detail?: string;
}

function isDatabaseError(err: unknown): err is DatabaseError {
  return err instanceof Error && "code" in err;
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts a raw ingest record into a DB-ready NormalizedMention.
 * The entire raw object is stored in raw_payload so nothing is discarded.
 */
export function normalizeRawMention(raw: RawMentionInput): NormalizedMention {
  const rawUrl = String(raw.url ?? "").trim();
  return {
    external_id:    String(raw.external_id ?? "").trim(),
    source:         normalizeSource(String(raw.source ?? "")),
    source_raw:     raw.source_raw != null ? String(raw.source_raw).trim() || null : null,
    title:          normalizeTitle(raw.title != null ? String(raw.title) : null),
    content:        sanitizeContent(raw.content != null ? String(raw.content) : null),
    url:            rawUrl,
    url_normalized: normalizeUrl(rawUrl),
    author:         raw.author != null ? String(raw.author).trim() || null : null,
    published_at:   parsePublishedAt(raw.published_at ?? null),
    engagement:     parseEngagement(raw.engagement ?? null),
    // Store the complete original record — nothing is thrown away.
    raw_payload:    raw as Record<string, unknown>,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Insert SQL
// ─────────────────────────────────────────────────────────────────────────────

const INSERT_SQL = `
  INSERT INTO mentions (
    external_id,
    source,
    source_raw,
    title,
    content,
    url,
    url_normalized,
    author,
    published_at,
    engagement,
    raw_payload,
    updated_at
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10, $11::jsonb, NOW())
  ON CONFLICT (source, external_id) DO UPDATE SET
    source_raw     = EXCLUDED.source_raw,
    title          = EXCLUDED.title,
    content        = EXCLUDED.content,
    url            = EXCLUDED.url,
    url_normalized = EXCLUDED.url_normalized,
    author         = EXCLUDED.author,
    published_at   = EXCLUDED.published_at,
    engagement     = EXCLUDED.engagement,
    raw_payload    = EXCLUDED.raw_payload,
    updated_at     = NOW()
  RETURNING (xmax = 0) AS is_insert
`;

// ─────────────────────────────────────────────────────────────────────────────
// Bulk insert
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Inserts an array of normalised mentions within the provided client (which
 * must already have a BEGIN transaction open).
 *
 * Each record is wrapped in its own SAVEPOINT so that a cross-pipeline
 * url_normalized collision can be caught and skipped without aborting the
 * entire batch transaction.
 */
export async function bulkInsertMentions(
  client: PoolClient,
  records: NormalizedMention[]
): Promise<BulkIngestSummary> {
  const summary: BulkIngestSummary = {
    inserted: 0,
    updated: 0,
    skipped_as_duplicate: 0,
  };

  let i = 0;
  for (const record of records) {
    // Savepoint name must be a valid SQL identifier — no special chars.
    const sp = `sp_mention_${i}`;

    await client.query(`SAVEPOINT ${sp}`);

    try {
      const result = await client.query<{ is_insert: boolean }>(INSERT_SQL, [
        record.external_id,
        record.source,
        record.source_raw,
        record.title,
        record.content,
        record.url,
        record.url_normalized,
        record.author,
        record.published_at?.toISOString() ?? null,
        record.engagement,
        JSON.stringify(record.raw_payload),
      ]);

      await client.query(`RELEASE SAVEPOINT ${sp}`);

      // xmax = 0 → freshly inserted row; xmax > 0 → ON CONFLICT updated row.
      if (result.rows[0]?.is_insert === true) {
        summary.inserted++;
      } else {
        summary.updated++;
      }
    } catch (err) {
      if (
        isDatabaseError(err) &&
        err.code === "23505" &&
        err.constraint === "uq_mentions_url_normalized"
      ) {
        // Cross-pipeline duplicate: this record's url_normalized collides with
        // a row that has a different (source, external_id).  It's the same
        // article arriving via a different pipeline — skip it silently and
        // record it in the summary so the caller has full visibility.
        await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        await client.query(`RELEASE SAVEPOINT ${sp}`);
        summary.skipped_as_duplicate++;
      } else {
        // Unexpected error (e.g. DB connectivity, null constraint violation on
        // a required field) — rollback the savepoint to clear the error state,
        // then re-throw so the route handler rolls back the whole transaction.
        // We do NOT swallow unknown errors.
        try {
          await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
          await client.query(`RELEASE SAVEPOINT ${sp}`);
        } catch {
          // If even the rollback fails, let the outer handler deal with it.
        }
        throw err;
      }
    }
    i++;
  }

  return summary;
}
