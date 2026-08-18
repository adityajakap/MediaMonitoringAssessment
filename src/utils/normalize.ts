/**
 * src/utils/normalize.ts
 */

import sanitizeHtml from "sanitize-html";
import he from "he";

// ─────────────────────────────────────────────────────────────────────────────
// 1. normalizeSource
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps raw source strings (messy, inconsistent) to a canonical display name.
 *
 * Keys must be in lowercase — the lookup always lowercases the input first.
 * Values are the canonical names stored in the DB `source` column.
 */
const SOURCE_ALIAS_MAP: Record<string, string> = {
  // The Star
  "the star": "The Star",
  thestar: "The Star",
  "thestar.com": "The Star",
  "the star online": "The Star",

  // Malaysiakini
  malaysiakini: "Malaysiakini",
  "malaysiakini.com": "Malaysiakini",
  mkini: "Malaysiakini",

  // New Straits Times
  "new straits times": "New Straits Times",
  nst: "New Straits Times",
  "nst.com.my": "New Straits Times",

  // Twitter / X
  twitter: "Twitter",
  "twitter.com": "Twitter",
  x: "Twitter",
  "x.com": "Twitter",

  // Instagram
  instagram: "Instagram",
  "instagram.com": "Instagram",
  ig: "Instagram",

  // Facebook
  facebook: "Facebook",
  "facebook.com": "Facebook",
  fb: "Facebook",
};

/**
 * Title-cases each word in a string — used as a fallback for unknown sources.
 * e.g. "some unknown blog" → "Some Unknown Blog"
 */
function toTitleCase(str: string): string {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Returns a canonical source name for a given raw string.
 * - Trims whitespace and lowercases before the alias lookup.
 * - Unknown sources receive a title-cased version rather than an error.
 */
export function normalizeSource(raw: string): string {
  const key = raw.trim().toLowerCase();
  return SOURCE_ALIAS_MAP[key] ?? toTitleCase(key);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. normalizeUrl
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a canonical URL string for deduplication.
 *
 * Steps:
 *  1. Trim surrounding whitespace
 *  2. Lowercase the entire string
 *  3. Strip fragment  (#section)
 *  4. Strip query string  (?key=val)
 *  5. Strip one or more trailing slashes
 *
 * The result is stored in `url_normalized` and must match the DB constraint.
 */
export function normalizeUrl(raw: string): string {
  let url = raw.trim().toLowerCase();

  // Strip fragment first (must come before query check, because a fragment
  // can theoretically contain a "?" character).
  const hashIdx = url.indexOf("#");
  if (hashIdx !== -1) url = url.slice(0, hashIdx);

  // Strip query string
  const queryIdx = url.indexOf("?");
  if (queryIdx !== -1) url = url.slice(0, queryIdx);

  // Strip trailing slash(es)
  url = url.replace(/\/+$/, "");

  return url;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. parsePublishedAt
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parses a variety of date representations into a UTC Date object.
 *
 * Handles:
 *  - null / undefined                 → null (never throws)
 *  - number                           → treated as Unix timestamp in SECONDS
 *  - "DD/MM/YYYY"                     → day-first (see assumption note below)
 *  - "YYYY-MM-DD HH:MM[:SS]" (no tz) → assumed UTC
 *  - ISO 8601 with Z or offset        → parsed normally by Date constructor
 *
 *  DD/MM/YYYY ASSUMPTION:
 *  This format is inherently ambiguous ("01/02/2024" could be Jan 2 or Feb 1).
 *  We treat it as day-first (DD/MM) because the primary data sources for
 *  this system are Malaysian and Indonesian publications, which consistently
 *  use the DD/MM/YYYY convention (following ISO 8601 regional practice and
 *  British date formatting inherited from colonial-era press standards).
 *  If a source is later found to use MM/DD, it must be handled upstream
 *  (in its own parser) before calling this function.
 */
export function parsePublishedAt(raw: string | number | null): Date | null {
  if (raw === null || raw === undefined) return null;

  try {
    // ── Unix timestamp (seconds) ───────────────────────────────────────────
    if (typeof raw === "number") {
      const d = new Date(raw * 1000);
      return isNaN(d.getTime()) ? null : d;
    }

    const trimmed = raw.trim();
    if (trimmed === "") return null;

    // ── DD/MM/YYYY (day-first — see assumption note above) ─────────────────
    const ddmmyyyy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
    if (ddmmyyyy !== null) {
      const day = parseInt(ddmmyyyy[1] ?? "0", 10);
      const month = parseInt(ddmmyyyy[2] ?? "0", 10);
      const year = parseInt(ddmmyyyy[3] ?? "0", 10);
      const d = new Date(Date.UTC(year, month - 1, day));
      return isNaN(d.getTime()) ? null : d;
    }

    // ── ISO with space separator and NO timezone (assume UTC) ──────────────
    // e.g. "2024-01-15 10:30:00"  or  "2024-01-15 10:30"
    // The trailing $ ensures we only match strings without a tz suffix.
    const isoSpaceNoTz =
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(trimmed);
    if (isoSpaceNoTz) {
      const d = new Date(trimmed.replace(" ", "T") + "Z");
      return isNaN(d.getTime()) ? null : d;
    }

    // ── ISO 8601 with Z or numeric offset (+08:00, -05:00) ─────────────────
    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. parseEngagement
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parses an engagement count from a raw string or number.
 * - Strips thousands-separator commas ("1,204" → 1204).
 * - Returns null for null input, empty strings, or non-numeric values.
 * - Never throws.
 */
export function parseEngagement(raw: string | number | null): number | null {
  if (raw === null || raw === undefined) return null;

  if (typeof raw === "number") {
    return Number.isFinite(raw) ? Math.trunc(raw) : null;
  }

  const cleaned = raw.trim().replace(/,/g, "");
  if (cleaned === "") return null;

  const parsed = parseInt(cleaned, 10);
  return isNaN(parsed) ? null : parsed;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. sanitizeContent
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strips all HTML markup from content, removing <script> blocks entirely
 * (including their text content — not just the tags).
 *
 * Uses `sanitize-html` which is backed by `htmlparser2` and handles:
 *  - Malformed / nested tags
 *  - Inline event handlers (onclick="...")
 *  - Entity decoding (&nbsp; → space, &quot; → ", &amp; → &, etc.)
 *
 * A naive regex-based approach would leave <script> content behind — e.g.
 * replacing `/<script[^>]*>.*?<\/script>/s` misses edge cases like nested
 * quotes in attributes or split-across-whitespace tags.
 *
 * Returns null if input is null.
 */
export function sanitizeContent(raw: string | null): string | null {
  if (raw === null) return null;

  // Pass 1: strip all tags with sanitize-html.
  // sanitize-html removes <script> blocks and their content by default
  // because `script` is in its `nonTextTags` list (not just stripped, fully
  // excised). The exclusiveFilter provides a belt-and-suspenders guarantee.
  const stripped = sanitizeHtml(raw, {
    allowedTags: [],
    allowedAttributes: {},
    exclusiveFilter: (frame) => frame.tag === "script",
  });

  // Pass 2: decode HTML entities.
  // sanitize-html@2.x re-encodes `&` as `&amp;` in text nodes, so
  // `&amp;` in source becomes `&amp;amp;` after stripping — he.decode()
  // resolves this and also handles named entities (&pound;, &nbsp;, etc.).
  const decoded = he.decode(stripped);

  // Collapse multiple whitespace runs (artifacts of stripped block elements)
  return decoded.replace(/\s+/g, " ").trim() || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. normalizeTitle
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a trimmed title, or null for empty/null input.
 * Treats an empty string the same as null so the DB column is never
 * polluted with blank strings.
 */
export function normalizeTitle(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}
