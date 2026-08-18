/**
 * tests/health.test.ts
 *
 * Integration smoke-test for GET /health.
 *
 * Uses supertest to drive requests through the real Express app.
 * The DB pool is mocked so the test suite runs without a live PostgreSQL
 * instance (useful in CI).
 */

import request from "supertest";
import { createApp } from "../src/app";

// ── Mock the pg pool so the health route works without a real DB ────────────
jest.mock("../src/db/pool", () => ({
  pool: {
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({}),
      release: jest.fn(),
    }),
    on: jest.fn(),
    end: jest.fn(),
  },
  checkDbConnection: jest.fn().mockResolvedValue(undefined),
}));

const app = createApp();

describe("GET /health", () => {
  it("returns 200 with status ok when DB is reachable", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "ok",
      database: { connected: true },
    });
    expect(typeof res.body.uptime).toBe("number");
    expect(typeof res.body.timestamp).toBe("string");
  });

  it("returns 503 with status degraded when DB is unreachable", async () => {
    // Temporarily make pool.connect throw
    const { pool } = await import("../src/db/pool");
    (pool.connect as jest.Mock).mockRejectedValueOnce(
      new Error("Connection refused")
    );

    const res = await request(app).get("/health");

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      status: "degraded",
      database: { connected: false },
    });
  });

  it("returns 404 for unknown routes", async () => {
    const res = await request(app).get("/unknown-route");
    expect(res.status).toBe(404);
  });
});
