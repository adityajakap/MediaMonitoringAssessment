/**
 * tests/setup.ts
 *
 * Jest global setup — runs before every test file.
 * Sets fake env vars so `src/utils/env.ts` doesn't throw on import.
 */

process.env["DATABASE_URL"] = "postgresql://test:test@localhost:5432/test_db";
process.env["PORT"] = "3000";
process.env["NODE_ENV"] = "test";
