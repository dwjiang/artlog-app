import { normalizePassage } from "../../shared/audio/guide";
import { expandYearEnd } from "../../shared/catalog/dates";
import { separateUnspacedCharacters } from "../../shared/docent/word-boundaries";
import review from "../../shared/sources/reference-review.json";
import type { SourceDoc } from "./docentPrompts";
import type { ResearchConflict } from "./validators";

// The review compares identifiers, which sit near the top of a page; the rest only makes the prompt longer.
const REVIEW_CATALOGUE_CHARS = 2500;
const REVIEW_REFERENCE_CHARS = 6000;

export function referenceReviewInput(sources: SourceDoc[], target: { title: string; artist: string; date?: string }) {
  return {
    target: { title: target.title, artist: target.artist, date: target.date },
    catalogue: sources
      .filter((s) => !s.referenceUrl)
      .map((s) => ({ url: s.url, text: s.text.slice(0, REVIEW_CATALOGUE_CHARS) })),
    references: sources.flatMap((s, index) =>
      s.referenceUrl
        ? [
            {
              source: `s${index + 1}`,
              url: s.url,
              label: s.label,
              referenceUrl: s.referenceUrl,
              text: s.text.slice(0, REVIEW_REFERENCE_CHARS),
            },
          ]
        : [],
    ),
  };
}

// Models can change a caption's punctuation, so a quote must repeat the page's words in order, not its characters.
function quoteWords(text: string): string {
  return ` ${separateUnspacedCharacters(normalizePassage(text))
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .trim()} `;
}

export type ReviewTarget = { artist: string; date?: string; yearStart?: number; yearEnd?: number };

const UNNAMED =
  /^(?:(?:unknown|anonymous|anon|unidentified|not identified)(?: (?:artist|maker|painter|author))?|(?:artist|maker) unknown)$/;
const lifeDates = (name: string) => name.replaceAll(/\([^)]*\d{4}[^)]*\)/g, " ");

// The years a quoted date covers: "Dated 1840", "ca. 1700–1710", "1665–67", "18th century".
function yearRange(text: string): { start: number; end: number } | null {
  const years: number[] = [];
  for (const [, first, last] of text.matchAll(/\b(1\d{3}|20\d{2})(?:\s*[–—-]\s*(\d{2,4})\b)?/g)) {
    years.push(Number(first));
    if (last) years.push(expandYearEnd(first, last));
  }
  for (const [, century] of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th) century\b/gi)) {
    years.push((Number(century) - 1) * 100, (Number(century) - 1) * 100 + 99);
  }
  return years.length > 0 ? { start: Math.min(...years), end: Math.max(...years) } : null;
}

// Models flag a quote that agrees with the work ("Dated 1840" against 1840, "ca. 1700–1710" against 1705)
// or merely lacks a name ("Unknown"); neither is a conflict the work should be held back for.
function agrees(conflict: { field: string; text: string }, target: ReviewTarget): boolean {
  if (conflict.field === "artist") {
    const quoted = normalizePassage(lifeDates(conflict.text)).replace(/[.,;:]+$/, "");
    return UNNAMED.test(quoted) || quoted === normalizePassage(lifeDates(target.artist));
  }
  const quoted = yearRange(conflict.text);
  const own =
    target.yearStart !== undefined
      ? { start: target.yearStart, end: target.yearEnd ?? target.yearStart }
      : yearRange(target.date ?? "");
  if (!quoted || !own) return false;
  const slack = /\b(?:c|ca|circa|about|around)\b\.?/i.test(conflict.text) ? 5 : 0;
  return quoted.start - slack <= own.end && quoted.end + slack >= own.start;
}

// Each reference stands or falls on its own row: a row that is missing, repeated, not quoted from its page or
// citing an invented conflict leaves only that reference out. The museum's own catalogue text stays either way.
export function applyReferenceReview(
  value: unknown,
  sources: SourceDoc[],
  target?: ReviewTarget,
): { sources: SourceDoc[]; conflicts: ResearchConflict[]; incomplete: boolean; diagnostics: Record<string, number> } {
  const references = new Map(
    sources.flatMap((source, index) => (source.referenceUrl ? [[`s${index + 1}`, source] as const] : [])),
  );
  const rows =
    value && typeof value === "object" && "reviews" in value && Array.isArray(value.reviews) ? value.reviews : [];
  const diagnostics = {
    referenceCount: references.size,
    reviewCount: rows.length,
    missingReviewCount: 0,
    invalidReviewCount: 0,
    ungroundedEvidenceCount: 0,
    invalidConflictCount: 0,
  };
  const accepted = new Set<SourceDoc>();
  const conflicts: ResearchConflict[] = [];
  let incomplete = false;
  const quoted = (text: unknown, source: SourceDoc): text is string =>
    typeof text === "string" && !!quoteWords(text).trim() && quoteWords(source.text).includes(quoteWords(text));
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const source = references.get(row.source);
    references.delete(row.source);
    if (!source) continue;
    if (row.relation === "other" || row.relation === "uncertain") {
      if (!Array.isArray(row.conflicts) || row.conflicts.length > 0) {
        incomplete = true;
        diagnostics.invalidConflictCount++;
      }
      continue;
    }
    if (row.relation !== "same_artwork" || !Array.isArray(row.conflicts)) {
      incomplete = true;
      diagnostics.invalidReviewCount++;
      continue;
    }
    if (!quoted(row.evidence, source)) {
      incomplete = true;
      diagnostics.ungroundedEvidenceCount++;
      continue;
    }
    const listed: unknown[] = row.conflicts;
    const cited = listed.filter(
      (conflict): conflict is { field: "artist" | "date"; text: string } =>
        !!conflict
        && typeof conflict === "object"
        && ["artist", "date"].includes((conflict as { field?: unknown }).field as string),
    );
    if (cited.length !== listed.length || cited.some((conflict) => !quoted(conflict.text, source))) {
      incomplete = true;
      diagnostics.invalidConflictCount++;
      continue;
    }
    accepted.add(source);
    for (const conflict of cited) {
      if (target && agrees(conflict, target)) continue;
      conflicts.push({
        field: conflict.field,
        text: conflict.text,
        sourceUrl: source.url,
        sourceLabel: source.label,
        referenceUrl: source.referenceUrl!,
      });
    }
  }
  diagnostics.missingReviewCount = references.size;
  return {
    diagnostics,
    sources: sources.filter((source) => !source.referenceUrl || source.firstParty || accepted.has(source)),
    conflicts,
    incomplete: incomplete || references.size > 0,
  };
}

export function referenceReviewSchema(sources: SourceDoc[]) {
  const ids = sources.flatMap((source, index) => (source.referenceUrl ? [`s${index + 1}`] : []));
  const { schema } = review;
  return {
    ...schema,
    properties: {
      reviews: {
        ...schema.properties.reviews,
        minItems: ids.length,
        maxItems: ids.length,
        items: {
          ...schema.properties.reviews.items,
          properties: { ...schema.properties.reviews.items.properties, source: { type: "string", enum: ids } },
        },
      },
    },
  };
}
