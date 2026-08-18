/**
 * src/utils/logger.ts
 *
 * Minimal structured logger. In development it pretty-prints; in production
 * it emits newline-delimited JSON suitable for log aggregation pipelines.
 */

import { env } from "./env";

type LogLevel = "info" | "warn" | "error" | "debug";

function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(meta !== undefined ? { meta } : {}),
  };

  if (env.NODE_ENV === "production") {
    // Structured JSON for log aggregators (e.g. Cloud Logging, Datadog)
    process.stdout.write(JSON.stringify(entry) + "\n");
  } else {
    const prefix = `[${entry.timestamp}] [${level.toUpperCase()}]`;
    const suffix = meta !== undefined ? ` ${JSON.stringify(meta)}` : "";
    // eslint-disable-next-line no-console
    console.log(`${prefix} ${message}${suffix}`);
  }
}

export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => log("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => log("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log("error", msg, meta),
  debug: (msg: string, meta?: Record<string, unknown>) => log("debug", msg, meta),
};
