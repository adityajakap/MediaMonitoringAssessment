/**
 * src/db/index.ts
 *
 * Re-exports everything the rest of the application needs from the db layer.
 * Import from here rather than drilling into sub-modules:
 *
 *   import { pool, checkDbConnection } from "../db";
 */

export { pool, checkDbConnection } from "./pool";
