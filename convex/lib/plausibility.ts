import type { Lifespan } from "./wikidata";

export type YearRange = { start: number; end: number };

const CENTURY = /\b(\d{1,2})(?:st|nd|rd|th)\s+century\b/;
const YEARS = /(?<![\d.])(\d{4})(?![\d.])(?:\s*[–—/-]\s*(\d{2}|\d{4})(?![\d.]))?/g;

export function parseYearRange(value: string): YearRange | null {
  const text = value.normalize("NFKC").toLowerCase();
  const spans: YearRange[] = [];
  for (const match of text.matchAll(YEARS)) {
    const start = Number(match[1]);
    if (start < 1000 || start > 2099) continue;
    let end = match[2] === undefined ? start : Number(match[2]);
    if (match[2]?.length === 2) end = Math.floor(start / 100) * 100 + end;
    if (end < start) end += 100;
    spans.push({ start, end });
  }
  if (spans.length > 0) {
    return {
      start: Math.min(...spans.map((span) => span.start)),
      end: Math.max(...spans.map((span) => span.end)),
    };
  }
  const century = CENTURY.exec(text);
  if (century) {
    const n = Number(century[1]);
    return { start: (n - 1) * 100 + 1, end: n * 100 };
  }
  return null;
}

// The date must fall within the artist's lifespan. A living artist's window opens ten
// years after birth; a death-only record allows a long working life before it.
export function lifespanWindow(span: Lifespan, now = new Date().getUTCFullYear()): YearRange | null {
  if (span.birth !== undefined && span.death !== undefined) {
    return { start: span.birth, end: span.death };
  }
  if (span.birth !== undefined) return { start: span.birth + 10, end: now };
  if (span.death !== undefined) {
    return { start: span.death - 120, end: span.death };
  }
  return null;
}

export type PlausibilityWarning = "artist_not_found" | "date_outside_lifespan" | "venue_unlikely";

export type PlausibilityInput = {
  artistFound?: boolean;
  lifespan?: Lifespan;
  date?: string;
  venueCountryMatch?: boolean;
};

export function assessPlausibility(input: PlausibilityInput): PlausibilityWarning[] {
  const warnings: PlausibilityWarning[] = [];
  if (input.artistFound === false) warnings.push("artist_not_found");
  const range = input.date ? parseYearRange(input.date) : null;
  const window = input.lifespan ? lifespanWindow(input.lifespan) : null;
  if (range && window && (range.end < window.start || range.start > window.end)) {
    warnings.push("date_outside_lifespan");
  }
  if (input.venueCountryMatch === false) warnings.push("venue_unlikely");
  return warnings;
}
