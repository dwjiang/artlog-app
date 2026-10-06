import { normalizeText } from "../../shared/catalog/text";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { eligibleObjectRecord } from "./recognitionEligibility";
import {
  spellingSimilarity,
  surnameMatches,
  TITLE_MATCH_THRESHOLD,
  titleQualifiersMatch,
  titleSimilarity,
} from "./textMatch";

export const MAX_CORPUS_MATCHES = 3;
// Search ranks by shared words only; misspelled titles are judged here, among the rows sharing the artist's name.
const SEARCH_POOL = 64;
const MAX_SEARCH_TERMS = 16;
const SPELLING_THRESHOLD = 0.7;
const YEAR_SLACK = 2;
const YEAR_BONUS = 0.25;
const MAX_OBJECTS_PER_ARTWORK = 16;

export type CorpusQuery = { title: string; artist?: string; date?: string; wikidataId?: string };
export type CorpusMatch = { objectId: Id<"objects">; artworkId: Id<"artworks"> };

function labelYear(date: string | undefined): number | undefined {
  const match = date ? /\b(\d{4})\b/.exec(date) : null;
  return match ? Number(match[1]) : undefined;
}

function yearAgrees(year: number | undefined, artwork: Doc<"artworks">): boolean {
  if (year === undefined || artwork.yearStart === undefined) return false;
  return year >= artwork.yearStart - YEAR_SLACK && year <= (artwork.yearEnd ?? artwork.yearStart) + YEAR_SLACK;
}

// 0 unless the titles share enough words or letters; a study or copy never names the finished work.
export function titleScore(label: string, title: string): number {
  if (!titleQualifiersMatch(label, title)) return 0;
  const words = titleSimilarity(label, title);
  const spelling = spellingSimilarity(label, title);
  return words >= TITLE_MATCH_THRESHOLD || spelling >= SPELLING_THRESHOLD ? Math.max(words, spelling) : 0;
}

/** Catalogue artworks a label names, best first: its exact Wikidata work, then title and artist matches. */
export async function rankArtworks(ctx: QueryCtx, query: CorpusQuery): Promise<Doc<"artworks">[]> {
  const ranked = new Map<Id<"artworks">, { artwork: Doc<"artworks">; score: number }>();
  if (query.wikidataId) {
    const exact = await ctx.db
      .query("artworks")
      .withIndex("by_wikidataId", (q) => q.eq("wikidataId", query.wikidataId))
      .take(MAX_CORPUS_MATCHES);
    for (const artwork of exact) {
      if (artwork.retiredAt === undefined) ranked.set(artwork._id, { artwork, score: Infinity });
    }
  }
  const { artist } = query;
  const terms = artist
    ? normalizeText(`${artist} ${query.title}`).split(" ").filter(Boolean).slice(0, MAX_SEARCH_TERMS)
    : [];
  if (artist && terms.length > 0) {
    const year = labelYear(query.date);
    const hits = await ctx.db
      .query("artworks")
      .withSearchIndex("search_text", (q) => q.search("searchText", terms.join(" ")))
      .take(SEARCH_POOL);
    for (const artwork of hits) {
      if (artwork.retiredAt !== undefined || ranked.has(artwork._id) || !surnameMatches(artist, artwork.artist)) {
        continue;
      }
      const score = titleScore(query.title, artwork.title);
      if (score > 0) {
        ranked.set(artwork._id, { artwork, score: score + (yearAgrees(year, artwork) ? YEAR_BONUS : 0) });
      }
    }
  }
  return [...ranked.values()].sort((a, b) => b.score - a.score).map(({ artwork }) => artwork);
}

// Visitor entries stay with their own venue's label flow; a link always names a catalogue object.
async function catalogueObject(
  ctx: QueryCtx,
  artworkId: Id<"artworks">,
  venueId: Id<"museums"> | undefined,
): Promise<Doc<"objects"> | undefined> {
  let fallback: Doc<"objects"> | undefined;
  const objects = await ctx.db
    .query("objects")
    .withIndex("by_artworkId", (q) => q.eq("artworkId", artworkId))
    .take(MAX_OBJECTS_PER_ARTWORK);
  for (const object of objects) {
    if (object.identityStatus !== "established" || !(await eligibleObjectRecord(ctx, object))) continue;
    if (venueId !== undefined && object.ownerId === venueId) return object;
    fallback ??= object;
  }
  return fallback;
}

export async function findCorpusMatches(
  ctx: QueryCtx,
  query: CorpusQuery,
  venueId?: Id<"museums">,
): Promise<CorpusMatch[]> {
  const matches: CorpusMatch[] = [];
  for (const artwork of await rankArtworks(ctx, query)) {
    const object = await catalogueObject(ctx, artwork._id, venueId);
    if (object) matches.push({ objectId: object._id, artworkId: artwork._id });
    if (matches.length === MAX_CORPUS_MATCHES) break;
  }
  return matches;
}
