/**
 * src/services/statsService.ts
 *
 * Query execution for GET /mentions/stats.
 */

import { pool } from "../db";
import { StatsBySource, StatsByDay } from "../types/mention";

export async function getStatsBySource(): Promise<StatsBySource[]> {
  const sql = `
    SELECT
      source,
      COUNT(*)::int AS count
    FROM mentions
    GROUP BY source
    ORDER BY count DESC
  `;

  const result = await pool.query<StatsBySource>(sql);
  return result.rows;
}

export async function getStatsByDay(): Promise<StatsByDay[]> {
  // Decision: Rows with published_at = NULL are excluded because a null date
  // cannot logically be grouped into a specific day. Grouping them under a
  // "null" bucket often breaks charting libraries on the frontend that expect
  // a continuous time series.
  const sql = `
    SELECT
      TO_CHAR(published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
      COUNT(*)::int AS count
    FROM mentions
    WHERE published_at IS NOT NULL
    GROUP BY day
    ORDER BY day ASC
  `;

  const result = await pool.query<StatsByDay>(sql);
  return result.rows;
}
