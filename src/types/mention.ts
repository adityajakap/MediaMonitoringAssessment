/**
 * src/types/mention.ts
 *
 * Shared TypeScript types for the mentions ingest pipeline.
 * Kept in a dedicated file so both the service and route can import them
 * without creating circular dependencies.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Raw input (what arrives in the JSON request body)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shape accepted by POST /internal/mentions/bulk.
 * Extra fields (beyond the declared ones) are accepted and stored verbatim
 * inside `raw_payload` so no source data is discarded.
 */
export interface RawMentionInput {
  external_id: string;
  source: string;
  source_raw?: string | null;
  title?: string | null;
  content?: string | null;
  url: string;
  author?: string | null;
  published_at?: string | number | null;
  engagement?: string | number | null;
  [key: string]: unknown; // extra fields → raw_payload
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalized record (ready for DB insert)
// ─────────────────────────────────────────────────────────────────────────────

export interface NormalizedMention {
  external_id: string;
  source: string;
  source_raw: string | null;
  title: string | null;
  content: string | null;
  url: string;
  url_normalized: string;
  author: string | null;
  published_at: Date | null;
  engagement: number | null;
  raw_payload: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Response shape
// ─────────────────────────────────────────────────────────────────────────────

export interface BulkIngestSummary {
  /** Rows that did not previously exist — xmax = 0 after INSERT */
  inserted: number;
  /**
   * Rows whose (source, external_id) already existed — the ON CONFLICT
   * DO UPDATE clause fired and refreshed the fields.
   */
  updated: number;
  /**
   * Records whose url_normalized collided with a different (source, external_id)
   * row — the same article arriving via a second pipeline.  These are skipped
   * silently rather than overwriting the existing row.
   */
  skipped_as_duplicate: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Search
// ─────────────────────────────────────────────────────────────────────────────

/** A single row returned by GET /mentions — raw_payload excluded (internal). */
export interface MentionRow {
  id: string;
  external_id: string;
  source: string;
  source_raw: string | null;
  title: string | null;
  content: string | null;
  url: string;
  url_normalized: string;
  author: string | null;
  published_at: Date | null;
  engagement: number | null;
  created_at: Date;
  updated_at: Date;
}

/** Validated, coerced query parameters for the search endpoint. */
export interface SearchParams {
  q?: string;
  source?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

/** Response envelope for GET /mentions. */
export interface SearchResponse {
  data: MentionRow[];
  page: number;
  pageSize: number;
  total: number;
/**
   * Documents the exact ORDER BY applied so callers can predict which rows
   * appear on which page without guessing.
   */
  sort: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stats
// ─────────────────────────────────────────────────────────────────────────────

export type GroupByMode = "source" | "day";

export interface StatsBySource {
  source: string;
  count: number;
}

export interface StatsByDay {
  day: string; // YYYY-MM-DD
  count: number;
}

