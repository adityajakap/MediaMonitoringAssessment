# Media Monitoring API

A REST API for ingesting, querying, and analyzing media mentions. Built with Node.js, TypeScript, Express, and PostgreSQL.

## 1. Getting Started

Assuming a fresh machine with only Node.js (>=20) and PostgreSQL installed, here's how to get it running.

```bash
# 1. Enable pnpm (comes with modern Node.js)
corepack enable pnpm

# 2. Install dependencies
pnpm install

# 3. Configure environment variables
cp .env.example .env
# Open .env and make sure DATABASE_URL matches your local Postgres setup,
# e.g. postgresql://postgres:postgres@localhost:5432/media_monitoring

# 4. Start Postgres locally via Docker
docker compose up -d

# 5. Run the migration
pnpm run migrate

# 6. Start the dev server (terminal 1)
pnpm run dev
```

With the server running on port 3000, open a second terminal and seed it with the provided dataset:

```bash
# 7. Seed the database
curl -X POST http://localhost:3000/internal/mentions/bulk \
  -H "Content-Type: application/json" \
  -d @data/seed_mentions.json
```

I ran this twice against the provided `seed_mentions.json` (15 records) while building this: the first POST returned `{"inserted":13,"updated":1,"skipped_as_duplicate":1}`, and running the exact same request again returned `{"inserted":0,"updated":14,"skipped_as_duplicate":1}` — no new rows on the second pass, which is the idempotency behavior the brief asks for.

Once seeded, `GET http://localhost:3000/mentions` and `GET http://localhost:3000/mentions/stats?group_by=source` should return real data.

## 2. Schema

One core table, `mentions`. I kept it flat rather than splitting sources/authors into their own tables — at this scale a join would add complexity without buying much, and the brief cares more about the dedup/ingestion logic than a fully normalized relational model.

- `id` (UUID, PK)
- `external_id` (TEXT, not null) — the ID the source system assigned
- `source` (TEXT, not null) — canonical source name after normalization
- `source_raw` (TEXT) — what actually came in, before I mapped it (e.g. `"thestar"` or `"malaysiakini "` with a trailing space)
- `title` (TEXT, nullable) — empty strings get normalized to null on ingest
- `content` (TEXT, nullable) — HTML-stripped and sanitized
- `url` (TEXT, not null)
- `url_normalized` (TEXT, not null) — lowercased, no trailing slash or query string
- `author` (TEXT, nullable)
- `published_at` (TIMESTAMPTZ, nullable) — some source records genuinely have no date
- `engagement` (INTEGER, nullable)
- `raw_payload` (JSONB, not null) — the untouched original record
- `created_at` / `updated_at` (TIMESTAMPTZ)

I kept `raw_payload` and `source_raw` around even though they're not used by any endpoint yet, mainly so that if I get the normalization rules wrong somewhere, I can re-derive the normalized fields later without having lost the original data.

**Two unique constraints, and why I needed both:**

1. `UNIQUE (source, external_id)` — this is what makes re-posting the same ingest file safe. If the same file gets sent twice (crash-recovery, a scheduled re-sync), the second pass hits `ON CONFLICT DO UPDATE` instead of inserting a new row.
2. `UNIQUE (url_normalized)` — the seed data actually has a case this alone doesn't cover: `str-99120` ("The Star") and `nst-40021` ("thestar", which normalizes to the same source) point at the exact same URL but have different `external_id`s. Without a second constraint on the URL, both would slip through as "new" rows under constraint #1. Deduplicating on the normalized URL catches that.

One thing worth flagging about implementing this: Postgres only lets you target one constraint per `ON CONFLICT` clause. A record can pass the `(source, external_id)` check as new and still collide on `url_normalized` — that's exactly what happens with `nst-40021` above. I handle that case explicitly in the ingest endpoint (catching the `unique_violation` on the second constraint) rather than assuming one `ON CONFLICT` clause covers both.

## 3. How I Defined "Duplicate"

The brief left this open on purpose, so here's my reasoning, using what I actually found in `seed_mentions.json`:

- **`str-99120` appearing twice, identical except `engagement` (412 vs 415)** — this is a plain retry of the same record. `(source, external_id)` catches it and the update just takes the newer engagement number.
- **`str-99120` / `nst-40021`, same URL, different external_id, source label spelled two different ways** — this is the same article picked up by what look like two different ingestion pipelines. I treat this as a duplicate via the `url_normalized` constraint.
- **`mkn-1201` / `mkn-1202`** — same author, same content, near-identical title ("second-half" vs "second half"), but different `external_id` *and* different URL (`/1201` vs `/1202`). I decided **not** to merge these. My guess is this is a republish under a new URL, but I can't be fully sure it isn't a correction or a follow-up — and I'd rather show two similar-looking rows than risk silently dropping one that turns out to matter.
- **`str-99502` / `nst-40199`, the tourism-arrivals story** — same underlying stat (12% YoY, 2.4 million arrivals), but two different outlets independently covering it, different authors, different URLs. This one I'm confident is genuinely two pieces of coverage, not a duplicate — and for a PR monitoring tool specifically, an analyst probably *wants* to see reach across both outlets rather than have it collapsed into one.

So the actual rule is: exact retries and same-URL-different-pipeline get deduplicated automatically; anything that only *looks* similar in title or content stays as separate rows. I didn't want to guess at a similarity threshold under time pressure — a wrong threshold either merges things that shouldn't be merged, or misses things that should. Leaving near-duplicates visible felt like the safer failure mode.

## 4. Assumptions

- **Ambiguous dates** (`mkn-1202`'s `"11/08/2026"`) — I assumed `DD/MM/YYYY`, since every other dated record in the file falls in the 10–15 August 2026 range and that's the regional convention. If this were a real system I'd want to confirm this per-source rather than guess globally.
- **Empty-string titles** (`fb_772341` has `""`, while the Twitter/Instagram records use `null`) — I normalized both to `null` so the API has one consistent "no title" representation instead of two.
- **Source aliasing** — I used a small static lookup table in code to map raw source strings to a canonical name. Good enough for the six sources in this dataset; wouldn't scale to a real pipeline with dozens of feeds (see section 7).
- **`published_at` as a Unix timestamp** (`nst-40088`'s `1786435200`) — I detect this as a bare number and parse it as seconds-since-epoch, distinct from the string-based date formats.

## 5. Trade-offs I Accepted

- **`url_normalized` uniqueness can misfire** if an outlet ever replaces an article's content at the same URL (a live-updating story, for instance) — a legitimate update could get treated as a duplicate-skip instead of an update. I didn't have a clean way to distinguish "same URL, genuinely new version" from "same URL, duplicate ingestion" without more signal than I had.
- **`ILIKE` for the `q` search param**, not full-text search. Simpler to implement correctly under time pressure; it'll get slow and won't handle typos/stemming as the dataset grows. `source` is filtered with exact match instead, since it's a normalized, closed set of values rather than free text — an `ILIKE` there would risk loosely matching source names that just happen to share a substring.
- **No fuzzy matching** between near-duplicate content (the `mkn-1201`/`1202` and tourism cases above). I chose to leave these as separate rows rather than risk a wrong auto-merge.

## 6. Time Spent
- Hours spent: ~4-5 hours (includes reading the brief, the coding sessions below, and writing this README)
- Sessions: 3 (initial build session ~2 hours on 19 Aug morning, a short fix session same day evening, plus README/testing) 

## 7. With Another Week, I Would…

1. Add trigram similarity matching (`pg_trgm`) on title/content to *flag* candidate duplicates like the `mkn-1201`/`1202` pair for a human to review, rather than leaving that judgment call entirely unautomated.
2. Move the source-alias mapping out of code and into a `sources` table, so adding a new outlet doesn't require a deploy.
3. Replace `ILIKE` with proper `tsvector`/`tsquery` full-text search — mainly for ranking and typo tolerance, which matter more once there's real volume of articles.