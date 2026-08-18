/**
 * tests/stats.integration.test.ts
 *
 * Integration tests for GET /mentions/stats.
 *
 * Runs against the real Postgres DB (pnpm test:integration).
 */

import request from "supertest";
import { Pool } from "pg";
import { createApp } from "../src/app";

const app = createApp();
const dbPool = new Pool({
  connectionString: process.env["DATABASE_URL"],
  connectionTimeoutMillis: 3_000,
});

const PREFIX = "__stats_test__";

// ─────────────────────────────────────────────────────────────────────────────
// Test Fixtures
// ─────────────────────────────────────────────────────────────────────────────

// We insert 5 records.
// Source distribution:
//   __stats_test_A__: 3
//   __stats_test_B__: 2
// Day distribution (UTC):
//   2024-03-01: 2
//   2024-03-02: 1
//   NULL:       2
const RECORDS = [
  {
    external_id: `${PREFIX}001`,
    source: `${PREFIX}A__`,
    url: "https://example.com/s001",
    url_normalized: "example.com/s001",
    published_at: "2024-03-01T10:00:00Z", // Day: 2024-03-01
    raw_payload: {},
  },
  {
    external_id: `${PREFIX}002`,
    source: `${PREFIX}A__`,
    url: "https://example.com/s002",
    url_normalized: "example.com/s002",
    published_at: "2024-03-01T23:59:59Z", // Day: 2024-03-01
    raw_payload: {},
  },
  {
    external_id: `${PREFIX}003`,
    source: `${PREFIX}A__`,
    url: "https://example.com/s003",
    url_normalized: "example.com/s003",
    published_at: "2024-03-02T00:00:01Z", // Day: 2024-03-02
    raw_payload: {},
  },
  {
    external_id: `${PREFIX}004`,
    source: `${PREFIX}B__`,
    url: "https://example.com/s004",
    url_normalized: "example.com/s004",
    published_at: null, // Should be excluded from group_by=day
    raw_payload: {},
  },
  {
    external_id: `${PREFIX}005`,
    source: `${PREFIX}B__`,
    url: "https://example.com/s005",
    url_normalized: "example.com/s005",
    published_at: null, // Should be excluded from group_by=day
    raw_payload: {},
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Setup / Teardown
// ─────────────────────────────────────────────────────────────────────────────

let dbAvailable = false;

beforeAll(async () => {
  try {
    await dbPool.query("SELECT 1");
    dbAvailable = true;

    await dbPool.query(`DELETE FROM mentions WHERE external_id LIKE $1`, [`${PREFIX}%`]);

    for (const r of RECORDS) {
      await dbPool.query(
        `INSERT INTO mentions (external_id, source, url, url_normalized, published_at, raw_payload)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [r.external_id, r.source, r.url, r.url_normalized, r.published_at, r.raw_payload]
      );
    }
  } catch (e) {
    dbAvailable = false;
    console.warn("⚠ Stats integration tests skipped (DB unreachable).", e);
  }
});

afterAll(async () => {
  if (dbAvailable) {
    await dbPool.query(`DELETE FROM mentions WHERE external_id LIKE $1`, [`${PREFIX}%`]);
  }
  await dbPool.end();
});

function dbTest(name: string, fn: () => Promise<void>) {
  // eslint-disable-next-line jest/no-conditional-in-test
  it(name, async () => {
    if (!dbAvailable) return;
    await fn();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /mentions/stats", () => {
  dbTest("returns 400 for missing group_by", async () => {
    const res = await request(app).get("/mentions/stats");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing or invalid `group_by`/);
  });

  dbTest("returns 400 for invalid group_by", async () => {
    const res = await request(app).get("/mentions/stats?group_by=author");
    expect(res.status).toBe(400);
  });

  dbTest("group_by=source aggregates counts correctly", async () => {
    const res = await request(app).get("/mentions/stats?group_by=source");
    expect(res.status).toBe(200);

    // Filter to only our test prefix in case the DB has other records.
    const data = res.body.filter((r: any) => r.source.startsWith(PREFIX));

    // A__ has 3, B__ has 2. Should be ordered by count DESC.
    expect(data).toHaveLength(2);
    expect(data[0]).toEqual({ source: `${PREFIX}A__`, count: 3 });
    expect(data[1]).toEqual({ source: `${PREFIX}B__`, count: 2 });
  });

  dbTest("group_by=day aggregates counts correctly and excludes nulls", async () => {
    const res = await request(app).get("/mentions/stats?group_by=day");
    expect(res.status).toBe(200);

    // Because this endpoint returns all days in the DB, we just need to verify
    // that our specific test days exist with the expected counts.
    // (If the DB has other data, it might have other days, which is fine.)
    
    const day1 = res.body.find((r: any) => r.day === "2024-03-01");
    const day2 = res.body.find((r: any) => r.day === "2024-03-02");
    const dayNull = res.body.find((r: any) => r.day === null);

    expect(day1).toBeDefined();
    expect(day1.count).toBeGreaterThanOrEqual(2); // In case other test data falls on this date

    expect(day2).toBeDefined();
    expect(day2.count).toBeGreaterThanOrEqual(1);

    // The query explicitly excludes `published_at IS NOT NULL`, so a literal `null` 
    // day string or a JavaScript null should not exist in the results.
    expect(dayNull).toBeUndefined();
  });
});
