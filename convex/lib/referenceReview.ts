import { normalizePassage } from "../../shared/audio/guide";
import review from "../../shared/sources/reference-review.json";
import type { SourceDoc } from "./docentPrompts";
import type { ResearchConflict } from "./validators";

export function referenceReviewInput(sources: SourceDoc[], target: { title: string; artist: string; date?: string }) {
  return {
    target: { title: target.title, artist: target.artist, date: target.date },
    catalogue: sources.filter((s) => !s.referenceUrl).map((s) => ({ url: s.url, text: s.text })),
    references: sources.flatMap((s, index) => (s.referenceUrl ? [{ source: `s${index + 1}`, ...s }] : [])),
  };
}

// Models copying a caption drop its punctuation (MoMA's "The Starry Night. Saint Rémy" came back
// as "The Starry Night\nSaint Rémy"), so a quote must repeat the page's words in order, not its characters.
function quoteWords(text: string): string {
  // Han and kana have no required spaces; keep character boundaries without splitting Latin words or numbers.
  return ` ${normalizePassage(text)
    .replaceAll(
      /([\u3000-\u30ff\u31f0-\u31ff\u3400-\u9fff\uf900-\ufaff\u{1aff0}-\u{1b16f}\u{20000}-\u{3347f}])/gu,
      " $1 ",
    )
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .trim()} `;
}

export function applyReferenceReview(
  value: unknown,
  sources: SourceDoc[],
): { sources: SourceDoc[]; conflicts: ResearchConflict[] } {
  const invalid = () => {
    throw new Error("Invalid reference review");
  };
  if (!value || typeof value !== "object" || !("reviews" in value) || !Array.isArray(value.reviews)) return invalid();
  const references = new Map(
    sources.flatMap((source, index) => (source.referenceUrl ? [[`s${index + 1}`, source] as const] : [])),
  );
  const accepted = new Set<SourceDoc>();
  const conflicts: ResearchConflict[] = [];
  const quoted = (text: unknown, source: SourceDoc): text is string =>
    typeof text === "string" && !!quoteWords(text).trim() && quoteWords(source.text).includes(quoteWords(text));
  for (const row of value.reviews) {
    if (!row || typeof row !== "object") return invalid();
    const source = references.get(row.source);
    if (
      !source
      || !["same_artwork", "other", "uncertain"].includes(row.relation)
      || !Array.isArray(row.conflicts)
      || typeof row.comparison !== "string"
      || !row.comparison.trim()
    ) {
      return invalid();
    }
    references.delete(row.source);
    if (row.relation !== "same_artwork") {
      if (row.conflicts.length > 0) return invalid();
      continue;
    }
    if (!quoted(row.evidence, source)) return invalid();
    accepted.add(source);
    for (const conflict of row.conflicts) {
      if (!conflict || !["artist", "date"].includes(conflict.field) || !quoted(conflict.text, source)) return invalid();
      conflicts.push({
        field: conflict.field,
        text: conflict.text,
        sourceUrl: source.url,
        sourceLabel: source.label,
        referenceUrl: source.referenceUrl!,
      });
    }
  }
  if (references.size > 0) return invalid();
  return { sources: sources.filter((source) => !source.referenceUrl || accepted.has(source)), conflicts };
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
