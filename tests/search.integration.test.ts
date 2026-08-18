/**
 * tests/search.integration.test.ts
 *
 * Integration tests for GET /mentions (search & filter endpoint).
 *
 * These tests talk to the REAL Docker Postgres (port 5433 by default).
 * Run with: pnpm test:integration
 */

import request from "supertest";
import { Pool } from "pg";
import { createApp } from "../src/app";

const app = createApp();
const dbPool = new Pool({
  connectionString: process.env["DATABASE_URL"],
  connectionTimeoutMillis: 3_000,
});

const PREFIX = "__search_test__";

// ─────────────────────────────────────────────────────────────────────────────
// Test Fixtures
// ─────────────────────────────────────────────────────────────────────────────

// We insert 5 records with specific dates and content to test all filters.
// Expected sort order (published_at DESC NULLS LAST, id ASC):
// 1. 2024-03-05 (003)
// 2. 2024-03-02 (002)
// 3. 2024-03-01 (001)
// 4. NULL       (004)
// 5. NULL       (005)

const RECORDS = [
  {
    external_id: `${PREFIX}001`,
    source: "__search_test_source__",
    title: "Government announces new EV policy",
    content: "The Prime Minister today outlined incentives for electric vehicles.",
    url: "https://example.com/001",
    url_normalized: "example.com/001",
    published_at: "2024-03-01T10:00:00Z",
    raw_payload: {},
  },
  {
    external_id: `${PREFIX}002`,
    source: "Malaysiakini",
    title: "EV subsidies criticized by opposition",
    content: "Opposition MPs argue the EV policy is poorly targeted.",
    url: "https://example.com/002",
    url_normalized: "example.com/002",
    published_at: "2024-03-02T15:30:00Z",
    raw_payload: {},
  },
  {
    external_id: `${PREFIX}003`,
    source: "__search_test_source__",
    title: "Local election results",
    content: "Voter turnout was unusually high this weekend.",
    url: "https://example.com/003",
    url_normalized: "example.com/003",
    published_at: "2024-03-05T08:00:00Z",
    raw_payload: {},
  },
  {
    external_id: `${PREFIX}004`,
    source: "Bernama",
    title: "Weather update: Heavy rain expected",
    content: "The meteorological department issued a storm warning.",
    url: "https://example.com/004",
    url_normalized: "example.com/004",
    published_at: null,
    raw_payload: {},
  },
  {
    external_id: `${PREFIX}005`,
    source: "__search_test_source__",
    title: "Stock market closes lower",
    content: "Investors reacted poorly to global economic indicators.",
    url: "https://example.com/005",
    url_normalized: "example.com/005",
    published_at: null,
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

    // Clean up any lingering data
    await dbPool.query(`DELETE FROM mentions WHERE external_id LIKE $1`, [`${PREFIX}%`]);

    // Insert test fixtures directly (bypassing the ingest endpoint so we test
    // search in isolation, and to guarantee exact timestamps).
    for (const r of RECORDS) {
      await dbPool.query(
        `INSERT INTO mentions (external_id, source, title, content, url, url_normalized, published_at, raw_payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [r.external_id, r.source, r.title, r.content, r.url, r.url_normalized, r.published_at, r.raw_payload]
      );
    }
  } catch (e) {
    dbAvailable = false;
    console.warn("⚠ Search integration tests skipped (DB unreachable).", e);
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

// Helper to filter test rows out of the response (in case the DB has real data
// from other manual testing) so we only assert against our fixtures.
const getTestRows = (res: request.Response) =>
  res.body.data.filter((r: any) => r.external_id.startsWith(PREFIX));

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /mentions", () => {
  // ── Source Filter ─────────────────────────────────────────────────────────
  dbTest("filters by source exact match", async () => {
    const res = await request(app).get("/mentions?source=__search_test_source__");
    expect(res.status).toBe(200);

    const rows = getTestRows(res);
    // Fixtures 001, 003, 005 are from __search_test_source__
    expect(rows.length).toBe(3);
    rows.forEach((r: any) => expect(r.source).toBe("__search_test_source__"));
  });

  // ── Keyword Search (q) ────────────────────────────────────────────────────
  dbTest("searches by keyword (case-insensitive substring in title/content)", async () => {
    // "EV" appears in 001 (title and content) and 002 (title and content)
    const res = await request(app).get("/mentions?q=ev");
    expect(res.status).toBe(200);

    const rows = getTestRows(res);
    expect(rows.length).toBe(2);
    const ids = rows.map((r: any) => r.external_id).sort();
    expect(ids).toEqual([`${PREFIX}001`, `${PREFIX}002`]);
  });

  // ── Date Range (from/to) ──────────────────────────────────────────────────
  dbTest("filters by date range (inclusive)", async () => {
    // 001 is Mar 1, 002 is Mar 2, 003 is Mar 5.
    // Filter Mar 2 through Mar 5 -> should return 002 and 003.
    const res = await request(app).get("/mentions?from=2024-03-02T00:00:00Z&to=2024-03-05T23:59:59Z");
    expect(res.status).toBe(200);

    const rows = getTestRows(res);
    expect(rows.length).toBe(2);
    const ids = rows.map((r: any) => r.external_id).sort();
    expect(ids).toEqual([`${PREFIX}002`, `${PREFIX}003`]);
  });

  dbTest("date range excludes null published_at rows", async () => {
    // A wide open range from the year 2000 to year 2100.
    const res = await request(app).get("/mentions?from=2000-01-01T00:00:00Z");
    expect(res.status).toBe(200);

    const rows = getTestRows(res);
    // Should return 001, 002, 003. Should NOT return 004, 005 (which have null dates).
    expect(rows.length).toBe(3);
    const hasNull = rows.some((r: any) => r.published_at === null);
    expect(hasNull).toBe(false);
  });

  // ── Pagination & Sorting ──────────────────────────────────────────────────
  dbTest("paginates correctly while respecting the documented sort order", async () => {
    // Expected global order of fixtures: 003, 002, 001, (004, 005 tie-broken by ID)
    // We fetch page 1 size 2, then page 2 size 2, then page 3 size 2.

    // To ensure we only test our pagination logic against OUR rows, we'll
    // combine pagination with a filter that only matches our test rows (e.g., q=__search_test)
    // Actually, to simulate pure pagination, we'll just parse the global results
    // but since the DB might have other rows, we'll pass `q=__search_test` (we didn't
    // put this string in the content, so let's just update the title/content of one row?
    // No, better to just let the DB return everything, and we'll check that the
    // *relative* order of our test rows is stable.
    // Wait, simpler: filter by a unique keyword we inject into all fixtures.
    // Since we didn't inject one, let's just use the fact that the test DB is clean.)

    // Instead, let's just test LIMIT and OFFSET directly against a source we control entirely.
    const res = await request(app).get("/mentions?source=__search_test_source__&pageSize=2&page=1");
    expect(res.status).toBe(200);

    const p1 = res.body.data;
    // Expected "__search_test_source__" rows: 003 (Mar 5), 001 (Mar 1), 005 (null)
    expect(p1.length).toBe(2);
    expect(p1[0].external_id).toBe(`${PREFIX}003`);
    expect(p1[1].external_id).toBe(`${PREFIX}001`);

    const res2 = await request(app).get("/mentions?source=__search_test_source__&pageSize=2&page=2");
    const p2 = res2.body.data;
    expect(p2.length).toBe(1); // Only 1 left
    expect(p2[0].external_id).toBe(`${PREFIX}005`);

    // Verify metadata
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(2);
    expect(res.body.total).toBe(3); // 3 total for "__search_test_source__"
    expect(res.body.sort).toBe("published_at DESC NULLS LAST, id ASC");
  });

  // ── Validation Errors ─────────────────────────────────────────────────────
  it("returns 400 for invalid page", async () => {
    const res = await request(app).get("/mentions?page=-1");
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid date format", async () => {
    const res = await request(app).get("/mentions?from=not-a-date");
    expect(res.status).toBe(400);
  });
});
