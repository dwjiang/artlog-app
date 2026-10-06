// Mirrors the corpus pipeline's placeholder names (scripts/data/pipeline/dedupe.py), which name no one.
const PLACEHOLDER_ARTISTS = new Set([
  "",
  "unknown",
  "unknown artist",
  "anonymous",
  "unidentified",
  "unidentified artist",
]);

export function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replaceAll(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The name an artist's works and page share across sources, whose ids differ; none for a placeholder name. */
export function artistKey(artist: string): string | undefined {
  const key = normalizeText(artist);
  return PLACEHOLDER_ARTISTS.has(key) ? undefined : key;
}

const SEARCH_MAX = 100;
const SEARCH_TERMS = 16;

/** The words a catalog search sends to the server; empty when there is nothing it can look up. */
export function catalogSearchText(query: string): string {
  if (query.length > SEARCH_MAX) return "";
  return normalizeText(query).split(" ").slice(0, SEARCH_TERMS).join(" ");
}
