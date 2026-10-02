import type { Multiplicity } from "./validators";

/** Picks kept per museum by the rebuild, and how many a museum's list returns. */
export const PICKS_PER_MUSEUM = 24;
export const PICKS_RETURNED = 10;
/** One person's recent save at the museum outweighs any difference between catalogue guesses. */
export const SAVER_WEIGHT = 10;
/** Less than the gap between an early Wikidata painting and a bulk-imported one, so the day only reorders peers. */
export const DAILY_JITTER = 3;

const PAINTING_MEDIUM = /\b(oil|tempera|acrylic|canvas|panel)\b/i;
const GENERIC_ARTIST =
  /^(unknown|anonymous|unidentified)\b|\b(workshop|school|circle|follower|manner) of\b|\b(painter|artist)$/i;
const UNLABELED_TITLE = /^Q\d+$/;
// Wikidata created items for paintings that already had a Wikipedia article in its first years; the bulk museum
// imports that followed (2014 onwards) start well above this number.
const EARLY_WIKIDATA_ITEM = 12_000_000;

export type PickCandidate = {
  title: string;
  artist: string;
  wikidataId?: string;
  medium?: string;
  multiplicity: Multiplicity;
  onView: boolean;
  /** Placements from the Wikidata paintings source are paintings even when no medium was recorded. */
  fromPaintingsSource: boolean;
};

/** The catalogue's guess at how worth seeking out a work is, or null when it cannot be shown at all. */
export function pickPrior(work: PickCandidate): number | null {
  if (UNLABELED_TITLE.test(work.title)) return null;
  let score = 0;
  if (work.wikidataId) score += Number(work.wikidataId.slice(1)) < EARLY_WIKIDATA_ITEM ? 6 : 1;
  if (work.onView) score += 2;
  if (work.fromPaintingsSource || (work.medium && PAINTING_MEDIUM.test(work.medium))) score += 1;
  if (GENERIC_ARTIST.test(work.artist.trim())) score -= 3;
  if (work.multiplicity === "multiple") score -= 1;
  return score;
}

/** A fixed pseudo-random number per id, so ties between equal scores break the same way every time. */
export function stableTiebreak(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

/**
 * A number in [0, 1) that is the same for everyone on one day and changes the next. Added to scores (scaled by
 * DAILY_JITTER) it rotates works of similar standing without letting a weak guess pass a much stronger one.
 */
export function dailyJitter(seed: string, id: string): number {
  return stableTiebreak(`${seed}:${id}`) / 4294967296;
}
