/**
 * src/utils/env.ts
 *
 * Loads and validates environment variables at startup.
 * Throws early with a descriptive message if a required var is missing,
 * so misconfigured deployments fail fast rather than silently.
 */

import "dotenv/config";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `Missing required environment variable: ${key}. ` +
        `Check your .env file or deployment config.`
    );
  }
  return value;
}

export const env = {
  DATABASE_URL: requireEnv("DATABASE_URL"),
  PORT: parseInt(process.env["PORT"] ?? "3000", 10),
  NODE_ENV: (process.env["NODE_ENV"] ?? "development") as
    | "development"
    | "test"
    | "production",
} as const;
