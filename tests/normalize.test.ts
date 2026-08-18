/**
 * tests/normalize.test.ts
 *
 * Unit tests for src/utils/normalize.ts.
 * Uses small inline fixtures — no seed files, no DB, no network.
 */

import {
  normalizeSource,
  normalizeUrl,
  parsePublishedAt,
  parseEngagement,
  sanitizeContent,
  normalizeTitle,
} from "../src/utils/normalize";

// ─────────────────────────────────────────────────────────────────────────────
// normalizeSource
// ─────────────────────────────────────────────────────────────────────────────
describe("normalizeSource", () => {
  // Alias resolution
  it('maps "thestar" → "The Star"', () => {
    expect(normalizeSource("thestar")).toBe("The Star");
  });

  it('maps "the star" (with spaces) → "The Star"', () => {
    expect(normalizeSource("the star")).toBe("The Star");
  });

  it('maps "TWITTER" (uppercase) → "Twitter"', () => {
    expect(normalizeSource("TWITTER")).toBe("Twitter");
  });

  it('maps "twitter" → "Twitter"', () => {
    expect(normalizeSource("twitter")).toBe("Twitter");
  });

  it('maps "  malaysiakini  " (trailing spaces) → "Malaysiakini"', () => {
    expect(normalizeSource("  malaysiakini  ")).toBe("Malaysiakini");
  });

  it('maps "new straits times" → "New Straits Times"', () => {
    expect(normalizeSource("new straits times")).toBe("New Straits Times");
  });

  it('maps "instagram" → "Instagram"', () => {
    expect(normalizeSource("instagram")).toBe("Instagram");
  });

  it('maps "facebook" → "Facebook"', () => {
    expect(normalizeSource("facebook")).toBe("Facebook");
  });

  // Unknown source fallback — title-case, no throw
  it("title-cases unknown sources instead of throwing", () => {
    expect(normalizeSource("some obscure blog")).toBe("Some Obscure Blog");
  });

  it("handles a single-word unknown source", () => {
    expect(normalizeSource("detik")).toBe("Detik");
  });

  // Idempotency: normalising an already-canonical name must be stable
  // (retry-duplicate scenario — the same source field normalised twice
  //  must produce the same value so the UNIQUE constraint fires correctly).
  it("is idempotent — normalising an already-canonical value is stable", () => {
    const first = normalizeSource("thestar");
    const second = normalizeSource(first);
    expect(second).toBe(first); // "The Star" → "The Star"
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// normalizeUrl
// ─────────────────────────────────────────────────────────────────────────────
describe("normalizeUrl", () => {
  it("lowercases the URL", () => {
    expect(normalizeUrl("HTTPS://Example.COM/Path")).toBe(
      "https://example.com/path"
    );
  });

  it("strips trailing slash", () => {
    expect(normalizeUrl("https://example.com/article/")).toBe(
      "https://example.com/article"
    );
  });

  it("strips multiple trailing slashes", () => {
    expect(normalizeUrl("https://example.com/article///")).toBe(
      "https://example.com/article"
    );
  });

  it("strips query string", () => {
    expect(normalizeUrl("https://example.com/article?utm_source=twitter")).toBe(
      "https://example.com/article"
    );
  });

  it("strips fragment", () => {
    expect(normalizeUrl("https://example.com/article#comments")).toBe(
      "https://example.com/article"
    );
  });

  it("strips query and fragment together", () => {
    expect(
      normalizeUrl("https://example.com/article?ref=home#top")
    ).toBe("https://example.com/article");
  });

  // Idempotency: the same URL ingested twice must produce identical
  // url_normalized so the UNIQUE constraint catches it as a duplicate.
  it("is idempotent — normalising the same URL twice yields the same result", () => {
    const url = "https://Example.COM/article/?utm_source=rss#top";
    expect(normalizeUrl(normalizeUrl(url))).toBe(normalizeUrl(url));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parsePublishedAt
// ─────────────────────────────────────────────────────────────────────────────
describe("parsePublishedAt", () => {
  it("returns null for null input", () => {
    expect(parsePublishedAt(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parsePublishedAt("")).toBeNull();
  });

  // Unix timestamp (seconds) — common in social media APIs
  it("parses a Unix timestamp (seconds) correctly", () => {
    // 1_700_000_000 seconds = 2023-11-14T22:13:20Z
    const result = parsePublishedAt(1_700_000_000);
    expect(result).toBeInstanceOf(Date);
    expect(result?.toISOString()).toBe("2023-11-14T22:13:20.000Z");
  });

  // ISO 8601 with Z
  it("parses ISO 8601 with Z suffix", () => {
    const result = parsePublishedAt("2024-03-15T08:30:00Z");
    expect(result?.toISOString()).toBe("2024-03-15T08:30:00.000Z");
  });

  // ISO with numeric offset — common in Malaysian content (+08:00)
  it("parses ISO 8601 with +08:00 offset", () => {
    const result = parsePublishedAt("2024-03-15T16:30:00+08:00");
    expect(result?.toISOString()).toBe("2024-03-15T08:30:00.000Z");
  });

  // ISO with space instead of T and no timezone — assume UTC
  it("parses ISO-like string with space separator (no tz → UTC)", () => {
    const result = parsePublishedAt("2024-03-15 08:30:00");
    expect(result?.toISOString()).toBe("2024-03-15T08:30:00.000Z");
  });

  // DD/MM/YYYY — ambiguous format, day-first assumption
  // "15/03/2024" must be March 15, not the 3rd of the 15th (nonsensical)
  // and not January 15 (MM/DD would be "01/15/2024" — invalid month 15).
  it("parses DD/MM/YYYY as day-first (Malaysian/Indonesian convention)", () => {
    // 01/02/2024 → day=1, month=2 → February 1, NOT January 2
    const result = parsePublishedAt("01/02/2024");
    expect(result?.toISOString()).toBe("2024-02-01T00:00:00.000Z");
  });

  it("parses single-digit DD/MM/YYYY correctly", () => {
    const result = parsePublishedAt("5/8/2023");
    expect(result?.toISOString()).toBe("2023-08-05T00:00:00.000Z");
  });

  it("returns null for a completely invalid string without throwing", () => {
    expect(parsePublishedAt("not-a-date")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseEngagement
// ─────────────────────────────────────────────────────────────────────────────
describe("parseEngagement", () => {
  it("returns null for null input", () => {
    expect(parseEngagement(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseEngagement("")).toBeNull();
  });

  // Comma-formatted engagement — common in social media dashboards
  it('parses comma-formatted string "1,204" → 1204', () => {
    expect(parseEngagement("1,204")).toBe(1204);
  });

  it('parses large comma-formatted string "1,234,567" → 1234567', () => {
    expect(parseEngagement("1,234,567")).toBe(1_234_567);
  });

  it("parses a plain number string", () => {
    expect(parseEngagement("42")).toBe(42);
  });

  it("parses a numeric value directly", () => {
    expect(parseEngagement(99)).toBe(99);
  });

  it("truncates floats to integer", () => {
    expect(parseEngagement(3.9)).toBe(3);
  });

  it("returns null for non-numeric string without throwing", () => {
    expect(parseEngagement("N/A")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// sanitizeContent
// ─────────────────────────────────────────────────────────────────────────────
describe("sanitizeContent", () => {
  it("returns null for null input", () => {
    expect(sanitizeContent(null)).toBeNull();
  });

  it("strips basic HTML tags", () => {
    expect(sanitizeContent("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  // Script injection — the core security case
  it("strips <script> tags AND their content (not just the tag)", () => {
    const malicious =
      '<p>Safe text</p><script>alert("xss")</script><p>More text</p>';
    const result = sanitizeContent(malicious);
    // The script content must NOT appear in output
    expect(result).not.toContain("alert");
    expect(result).not.toContain("xss");
    // sanitize-html strips tags without injecting spaces between adjacent
    // block elements; the text nodes themselves are preserved verbatim.
    expect(result).toBe("Safe textMore text");
  });

  it("strips inline event handlers", () => {
    const result = sanitizeContent('<a onclick="steal()">Click me</a>');
    expect(result).not.toContain("steal");
    expect(result).toBe("Click me");
  });

  it("decodes HTML entities", () => {
    expect(sanitizeContent("Hello&nbsp;World")).toBe("Hello World");
    // he.decode() resolves &amp; → & and named entities like &pound; → £
    expect(sanitizeContent("Price: &pound;10 &amp; tax")).toBe(
      "Price: \u00a310 & tax"
    );
  });

  it("returns null for whitespace-only input after stripping", () => {
    expect(sanitizeContent("   <br/>   ")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// normalizeTitle
// ─────────────────────────────────────────────────────────────────────────────
describe("normalizeTitle", () => {
  it("returns null for null input", () => {
    expect(normalizeTitle(null)).toBeNull();
  });

  it('returns null for empty string ""', () => {
    expect(normalizeTitle("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(normalizeTitle("   ")).toBeNull();
  });

  it("returns trimmed title for valid input", () => {
    expect(normalizeTitle("  Hello World  ")).toBe("Hello World");
  });

  it("preserves internal whitespace", () => {
    expect(normalizeTitle("Breaking News: Something Happened")).toBe(
      "Breaking News: Something Happened"
    );
  });
});
