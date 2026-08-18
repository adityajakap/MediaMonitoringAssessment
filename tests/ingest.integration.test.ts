/**
 * tests/ingest.integration.test.ts
 *
 * Integration tests for POST /internal/mentions/bulk.
 *
 * These tests talk to the REAL Docker Postgres (port 5433 by default).
 * Run with:
 *
 *   pnpm test:integration
 *
 * Prerequisites:
 *   • Docker container is running  (`docker compose up -d`)
 *   • Migrations are applied       (`pnpm migrate`)
 *   • .env has DATABASE_URL pointing at the real DB
 *
 * If the database is unreachable, every test in this suite will be skipped
 * rather than failing with a misleading error.
 */

import request from "supertest";
import { Pool } from "pg";
import { createApp } from "../src/app";

const app = createApp();

// ─────────────────────────────────────────────────────────────────────────────
// DB connection — real pool using DATABASE_URL from .env
// ─────────────────────────────────────────────────────────────────────────────

const dbPool = new Pool({
  connectionString: process.env["DATABASE_URL"],
  connectionTimeoutMillis: 3_000,
});

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

/** Unique prefix so these test rows don't collide with real data. */
const PREFIX = "__integration_test__";

const RECORD_A = {
  external_id: `${PREFIX}001`,
  source: "thestar",
  source_raw: "The Star",
  title: "Integration Test Article One",
  content: "<p>Body text for article one.</p>",
  url: "https://www.thestar.com.my/news/integration-test-001",
  author: "Test Author",
  published_at: "2024-03-15T08:00:00Z",
  engagement: "1,200",
};

const RECORD_B = {
  external_id: `${PREFIX}002`,
  source: "malaysiakini",
  source_raw: "Malaysiakini",
  title: "Integration Test Article Two",
  content: null,
  url: "https://www.malaysiakini.com/news/integration-test-002",
  published_at: 1_700_000_000, // Unix timestamp (seconds)
  engagement: null,
};

/** Same article as RECORD_A but from a different pipeline. */
const RECORD_A_CROSS_PIPELINE = {
  external_id: `${PREFIX}001-alt`,   // different external_id
  source: "kompas",                  // different source
  url: "https://www.thestar.com.my/news/integration-test-001", // same URL → same url_normalized
  title: "Cross-pipeline duplicate of article one",
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function countTestRows(): Promise<number> {
  const result = await dbPool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM mentions WHERE external_id LIKE $1`,
    [`${PREFIX}%`]
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function cleanupTestRows(): Promise<void> {
  await dbPool.query(
    `DELETE FROM mentions WHERE external_id LIKE $1`,
    [`${PREFIX}%`]
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DB availability guard
// ─────────────────────────────────────────────────────────────────────────────

let dbAvailable = false;

beforeAll(async () => {
  try {
    await dbPool.query("SELECT 1");
    dbAvailable = true;
    await cleanupTestRows(); // start with a clean slate
  } catch {
    dbAvailable = false;
    console.warn(
      "\n⚠  Integration DB not reachable — all tests in this suite will be skipped.\n" +
      "   Make sure the Docker container is running: docker compose up -d\n"
    );
  }
});

afterAll(async () => {
  if (dbAvailable) {
    await cleanupTestRows();
  }
  await dbPool.end();
});

// Convenience wrapper: skips a test if the DB is not available.
function dbTest(name: string, fn: () => Promise<void>): void {
  // eslint-disable-next-line jest/no-conditional-in-test
  it(name, async () => {
    if (!dbAvailable) {
      console.warn(`SKIPPED (no DB): ${name}`);
      return;
    }
    await fn();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /internal/mentions/bulk", () => {
  // ── Input validation ────────────────────────────────────────────────────────

  it("returns 400 when body is not an array", async () => {
    const res = await request(app)
      .post("/internal/mentions/bulk")
      .send({ external_id: "foo" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when body is an empty array", async () => {
    const res = await request(app)
      .post("/internal/mentions/bulk")
      .send([]);
    expect(res.status).toBe(400);
  });

  it("returns 400 when a record is missing external_id", async () => {
    const res = await request(app)
      .post("/internal/mentions/bulk")
      .send([{ source: "thestar", url: "https://example.com" }]);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/external_id/i);
  });

  it("returns 400 when a record is missing url", async () => {
    const res = await request(app)
      .post("/internal/mentions/bulk")
      .send([{ external_id: "x", source: "thestar" }]);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/url/i);
  });

  // ── Happy path ──────────────────────────────────────────────────────────────

  dbTest("inserts 2 new records and returns correct summary", async () => {
    const res = await request(app)
      .post("/internal/mentions/bulk")
      .send([RECORD_A, RECORD_B]);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ inserted: 2, updated: 0, skipped_as_duplicate: 0 });
    expect(await countTestRows()).toBe(2);
  });

  // ── Idempotency — the key requirement ────────────────────────────────────────

  dbTest(
    "posting the same records a second time does NOT double the row count",
    async () => {
      const res = await request(app)
        .post("/internal/mentions/bulk")
        .send([RECORD_A, RECORD_B]);

      expect(res.status).toBe(200);
      // Rows were updated (ON CONFLICT DO UPDATE), not re-inserted.
      expect(res.body.inserted).toBe(0);
      expect(res.body.updated).toBe(2);
      expect(res.body.skipped_as_duplicate).toBe(0);
      // THE key assertion: row count must still be 2, not 4.
      expect(await countTestRows()).toBe(2);
    }
  );

  dbTest("updated records reflect changed fields", async () => {
    const updated = { ...RECORD_A, title: "Updated Title After Re-ingest" };
    const res = await request(app)
      .post("/internal/mentions/bulk")
      .send([updated]);

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);

    const row = await dbPool.query<{ title: string }>(
      `SELECT title FROM mentions WHERE external_id = $1`,
      [RECORD_A.external_id]
    );
    expect(row.rows[0]?.title).toBe("Updated Title After Re-ingest");
  });

  // ── Cross-pipeline duplicate (url_normalized constraint) ──────────────────

  dbTest(
    "skips a cross-pipeline record whose url_normalized already exists",
    async () => {
      const res = await request(app)
        .post("/internal/mentions/bulk")
        .send([RECORD_A_CROSS_PIPELINE]);

      expect(res.status).toBe(200);
      // The article's URL was already in the DB under a different pipeline.
      expect(res.body).toMatchObject({
        inserted: 0,
        updated: 0,
        skipped_as_duplicate: 1,
      });
      // Row count must still be 2 — the cross-pipeline record was skipped.
      expect(await countTestRows()).toBe(2);
    }
  );

  dbTest(
    "processes remaining records after a url_normalized skip within the same batch",
    async () => {
      const newRecord = {
        external_id: `${PREFIX}003`,
        source: "nst",
        url: "https://www.nst.com.my/news/integration-test-003",
        title: "A genuinely new article",
      };

      const res = await request(app)
        .post("/internal/mentions/bulk")
        // Mix: one cross-pipeline dup, one new article.
        .send([RECORD_A_CROSS_PIPELINE, newRecord]);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        inserted: 1,
        skipped_as_duplicate: 1,
      });
      // 3 test rows: A, B (from earlier), and the new 003.
      expect(await countTestRows()).toBe(3);
    }
  );

  // ── Normalisation smoke-checks ─────────────────────────────────────────────

  dbTest("normalises source alias correctly", async () => {
    const row = await dbPool.query<{ source: string }>(
      `SELECT source FROM mentions WHERE external_id = $1`,
      [RECORD_A.external_id]
    );
    // "thestar" must be mapped to the canonical "The Star"
    expect(row.rows[0]?.source).toBe("The Star");
  });

  dbTest("strips HTML from content column", async () => {
    const row = await dbPool.query<{ content: string | null }>(
      `SELECT content FROM mentions WHERE external_id = $1`,
      [RECORD_A.external_id]
    );
    expect(row.rows[0]?.content).not.toMatch(/<[^>]+>/);
    expect(row.rows[0]?.content).toBe("Body text for article one.");
  });

  dbTest("parses Unix timestamp engagement", async () => {
    const row = await dbPool.query<{ published_at: Date }>(
      `SELECT published_at FROM mentions WHERE external_id = $1`,
      [RECORD_B.external_id]
    );
    // 1_700_000_000 seconds → 2023-11-14T22:13:20Z
    expect(row.rows[0]?.published_at?.toISOString()).toBe(
      "2023-11-14T22:13:20.000Z"
    );
  });
});
