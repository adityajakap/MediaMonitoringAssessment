-- =============================================================================
-- Migration: 002_create_mentions.sql
-- =============================================================================
--
-- WHY TWO UNIQUE CONSTRAINTS?
--
-- 1. UNIQUE (source, external_id)  — the primary idempotency key.
--    Every ingest pipeline tags each record with the originating source
--    (e.g. "detik", "twitter") and the ID that source assigns the article.
--    Re-running the same ingest file (crash-recovery, scheduled re-sync) must
--    be a no-op: ON CONFLICT DO UPDATE lets the caller upsert safely without
--    duplicating rows, updating fields if the retried payload changed.
--
-- 2. UNIQUE (url_normalized)  — a cross-pipeline dedup signal.
--    The same article is sometimes ingested through two different pipelines or
--    under different source labels (e.g. a wire story picked up by both
--    "kompas_rss" and "kompas_api"). The (source, external_id) key would allow
--    both to slip in because they differ; normalizing and deduplicating on the
--    canonical URL catches this second class of duplicate before it pollutes
--    analytics counts.
--
-- Together they cover:
--   • Idempotent retries of the same pipeline    →  (source, external_id)
--   • Same article arriving via different paths  →  (url_normalized)
--
-- IMPORTANT — application-level note (not enforceable in SQL alone):
-- Postgres only supports ONE ON CONFLICT target per INSERT statement. A record
-- can pass the (source, external_id) check as a "new" row and still collide on
-- url_normalized. The ingest endpoint must handle both cases explicitly —
-- either a pre-check SELECT on url_normalized, or catching unique_violation
-- (SQLSTATE 23505) and inspecting which constraint fired — rather than
-- assuming a single ON CONFLICT clause covers both constraints.
-- =============================================================================

CREATE TABLE IF NOT EXISTS mentions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  external_id     TEXT        NOT NULL,
  source          TEXT        NOT NULL,
  source_raw      TEXT,                        -- original as received, for audit

  title           TEXT,
  content         TEXT,                        -- sanitized, HTML-stripped
  url             TEXT        NOT NULL,
  url_normalized  TEXT        NOT NULL,        -- lowercased, trimmed, no trailing slash/query
  author          TEXT,

  published_at    TIMESTAMPTZ,                 -- nullable: some sources omit dates
  engagement      INTEGER,

  raw_payload     JSONB       NOT NULL,        -- original untouched record
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- bumped on ON CONFLICT DO UPDATE,
                                                        -- proves idempotent retries update
                                                        -- rather than re-insert

  CONSTRAINT uq_mentions_source_external_id  UNIQUE (source, external_id),
  CONSTRAINT uq_mentions_url_normalized      UNIQUE (url_normalized)
);

-- Range queries ("mentions between date A and B"); partial index skips NULL
-- rows since published_at is sometimes missing, keeping the B-tree lean.
CREATE INDEX IF NOT EXISTS idx_mentions_published_at
  ON mentions (published_at)
  WHERE published_at IS NOT NULL;

-- Filter / group-by source (dashboard breakdown, per-source rate limiting)
CREATE INDEX IF NOT EXISTS idx_mentions_source
  ON mentions (source);