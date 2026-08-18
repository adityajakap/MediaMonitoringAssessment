/**
 * tests/setup.integration.ts
 *
 * Jest setup for integration tests — loads the real .env file so
 * DATABASE_URL points to the actual Docker Postgres, not the fake test value
 * from setup.ts.
 *
 * This file is referenced by jest.config.integration.json only.
 * Regular unit tests continue to use tests/setup.ts with the fake DB URL.
 */

import dotenv from "dotenv";
import path from "path";

// Load .env from the project root before any test module runs.
// If .env doesn't exist (e.g. CI without secrets), the tests will skip
// gracefully when the DB connection fails.
dotenv.config({ path: path.resolve(__dirname, "../.env") });

// Provide PORT / NODE_ENV defaults that match the unit test setup.
process.env["PORT"] = process.env["PORT"] ?? "3000";
process.env["NODE_ENV"] = "test";
