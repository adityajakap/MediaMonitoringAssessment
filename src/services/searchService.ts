/**
 * src/services/searchService.ts
 *
 * Query-building and execution for GET /mentions.
 *
 * ── Keyword search: ILIKE vs. to_tsvector ────────────────────────────────────
 * We use ILIKE for the `q` parameter.  Rationale:
 *
 *   • The spec explicitly permits "case-insensitive substring match".
 *   • ILIKE is trivially readable: the query is self-documenting.
 *   • No extra index or migration is required for a working first version.
 *   • Upgrading to to_tsvector + GIN index is a two-step drop-in:
 *       1. Add a generated tsvector column (migration).
 *       2. Replace the ILIKE clause with a @@ to_tsquery match.
 *
 * Trade-off accepted: ILIKE performs a sequential scan on large tables.
 * At the scale this assessment targets, that is acceptable.  A GIN index
 * on `to_tsvector('english', coalesce(title,'') || ' ' || coalesce(content,''))`
 * should be added before going to production.
 *
 * ── Sort order ────────────────────────────────────────────────────────────────
 * ORDER BY published_at DESC NULLS LAST, id ASC
 *
 *   • published_at DESC — newest articles first.
 *   • NULLS LAST        — articles with no date sink to the bottom of every page.
 *   • id ASC            — stable tie-breaker for rows sharing the same timestamp
 *                         (or for the null-date bucket).  UUIDs are not time-ordered
 *                         but they ARE unique, so this guarantees a total order and
 *                         prevents rows from appearing on two pages or being skipped
 *                         between pages when the client pages through results.
 *
 * ── Pagination ────────────────────────────────────────────────────────────────
 * page / pageSize (1-indexed page numbers).
 * Defaults: page=1, pageSize=20.  Maximum pageSize capped at 100.
 * offset = (page - 1) * pageSize.
 */

import { pool } from "../db";
import { MentionRow, SearchParams, SearchResponse } from "../types/mention";

// Exposed in the response `sort` field so clients know the exact order.
export const SORT_ORDER = "published_at DESC NULLS LAST, id ASC";

// ─────────────────────────────────────────────────────────────────────────────
// WHERE clause builder
// ─────────────────────────────────────────────────────────────────────────────

interface WhereClause {
  sql: string;
  values: unknown[];
}

/**
 * Builds the SQL WHERE clause and parameter list from the validated search
 * params.  Returns both so the caller can run a COUNT query and a data query
 * reusing the same conditions and parameter array.
 */
function buildWhere(params: SearchParams): WhereClause {
  const conditions: string[] = [];
  const values: unknown[] = [];

  // ── Keyword search (ILIKE) ─────────────────────────────────────────────────
  if (params.q !== undefined && params.q.trim() !== "") {
    values.push(`%${params.q.trim()}%`);
    // Both columns reference the same parameter index — pg handles this correctly.
    const n = values.length;
    conditions.push(`(title ILIKE $${n} OR content ILIKE $${n})`);
  }

  // ── Source filter (exact match on normalized source name) ──────────────────
  if (params.source !== undefined && params.source.trim() !== "") {
    values.push(params.source.trim());
    conditions.push(`source = $${values.length}`);
  }

  // ── Date range filter ──────────────────────────────────────────────────────
  // Rows with published_at = NULL are excluded whenever either bound is given,
  // because a NULL date cannot be ordered relative to a concrete timestamp.
  if (params.from !== undefined || params.to !== undefined) {
    conditions.push("published_at IS NOT NULL");
  }

  if (params.from !== undefined) {
    values.push(params.from);
    conditions.push(`published_at >= $${values.length}::timestamptz`);
  }

  if (params.to !== undefined) {
    values.push(params.to);
    conditions.push(`published_at <= $${values.length}::timestamptz`);
  }

  const sql =
    conditions.length > 0 ? conditions.join(" AND ") : "TRUE";

  return { sql, values };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public search function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs a COUNT + SELECT against the mentions table and returns the paginated
 * result envelope.
 *
 * Two queries are issued:
 *   1. COUNT(*) — for the `total` field so the client can compute page counts.
 *   2. SELECT   — actual rows for the current page.
 *
 * Both share the same WHERE clause and parameter values; the SELECT appends
 * LIMIT / OFFSET as two additional parameters.
 */
export async function searchMentions(
  params: SearchParams
): Promise<SearchResponse> {
  const { sql: where, values } = buildWhere(params);

  // ── Total count ────────────────────────────────────────────────────────────
  const countSql = `SELECT COUNT(*) AS total FROM mentions WHERE ${where}`;
  const countResult = await pool.query<{ total: string }>(countSql, values);
  const total = Number(countResult.rows[0]?.total ?? 0);

  // ── Paginated data ─────────────────────────────────────────────────────────
  const offset = (params.page - 1) * params.pageSize;
  const dataValues = [...values, params.pageSize, offset];
  const limitIdx = dataValues.length - 1; // 1-indexed: last two params
  const offsetIdx = dataValues.length;

  const dataSql = `
    SELECT
      id,
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
      created_at,
      updated_at
    FROM mentions
    WHERE ${where}
    ORDER BY ${SORT_ORDER}
    LIMIT  $${limitIdx}
    OFFSET $${offsetIdx}
  `;

  const dataResult = await pool.query<MentionRow>(dataSql, dataValues);

  return {
    data: dataResult.rows,
    page: params.page,
    pageSize: params.pageSize,
    total,
    sort: SORT_ORDER,
  };
}
