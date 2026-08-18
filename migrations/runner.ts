/**
 * migrations/runner.ts
 *
 * Minimal migration runner — executes raw SQL files in `migrations/sql/`
 * in lexicographic order (e.g., 001_init.sql, 002_add_articles.sql).
 *
 * A `schema_migrations` table tracks which files have already been applied,
 * so the runner is idempotent and safe to re-run.
 *
 * Usage: npm run migrate
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { Pool } from "pg";

const DATABASE_URL = process.env["DATABASE_URL"];
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL environment variable is not set.");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

const SQL_DIR = path.join(__dirname, "sql");

async function run(): Promise<void> {
  const client = await pool.connect();
  try {
    // ── Ensure tracking table exists ─────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT        PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ── Collect .sql files not yet applied ───────────────────────────────────
    const files = fs
      .readdirSync(SQL_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const { rows } = await client.query<{ filename: string }>(
      "SELECT filename FROM schema_migrations"
    );
    const applied = new Set(rows.map((r) => r.filename));

    // ── Apply pending migrations inside individual transactions ──────────────
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`  SKIP  ${file}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(SQL_DIR, file), "utf8");

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (filename) VALUES ($1)",
          [file]
        );
        await client.query("COMMIT");
        console.log(`  APPLY ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }

    console.log("Migrations complete.");
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err: unknown) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
