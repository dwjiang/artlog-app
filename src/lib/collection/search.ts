import type { ArtworkEncounter, SavedWork, Visit } from "@/db/schema";
import { normalizeSearch } from "../../../shared/journal/limits";
import { compareText, matchesSearch, searchTerm } from "../journal/query";

type Searchable = Pick<SavedWork, "title" | "artist" | "institution">
  & Partial<Pick<SavedWork, "date" | "venueName">> & {
    city?: string | null;
    visitSearchTerms?: string[];
  };

export function filterWorks<T extends Searchable>(
  works: T[],
  query: string,
): T[] {
  const term = searchTerm(query);
  if (term === null) return [];
  if (!term) return works;
  return works.filter((work) =>
    matchesSearch(
      [
        work.title,
        work.artist,
        work.date,
        work.institution,
        work.venueName,
        work.city,
        ...(work.visitSearchTerms ?? []),
      ],
      term,
    ),
  );
}

export function linkedVisitSearchTerms(
  owner: string,
  encounters: Pick<
    ArtworkEncounter,
    "owner" | "savedLocalId" | "visitLocalId" | "deletedAt"
  >[],
  visits: (Pick<Visit, "owner" | "localId" | "venueName"> & {
    venueId: string;
  })[],
  metadata: ReadonlyMap<string, { city?: string | null }>,
) {
  const byVisit = new Map(
    visits
      .filter((visit) => visit.owner === owner)
      .map((visit) => [visit.localId, visit]),
  );
  const terms = new Map<string, string[]>();
  for (const encounter of encounters) {
    if (encounter.owner !== owner || encounter.deletedAt !== null) continue;
    const visit = byVisit.get(encounter.visitLocalId);
    if (!visit) continue;
    const city = metadata.get(visit.venueId)?.city;
    terms.set(encounter.savedLocalId, [
      ...(terms.get(encounter.savedLocalId) ?? []),
      visit.venueName,
      ...(city ? [city] : []),
    ]);
  }
  return terms;
}

export function artworkYear(date?: string | null): number | undefined {
  const match = date?.match(/\b(\d{1,4})(?:\s*(?:BCE?|CE|AD)\b|(?=\b))/i);
  if (!match) return undefined;
  return /\bBCE?\b/i.test(date!) ? -Number(match[1]) : Number(match[1]);
}

export function sortWorksByArtist<
  T extends Pick<SavedWork, "localId" | "artist" | "title" | "date">,
>(works: T[]): T[] {
  return [...works].sort(
    (a, b) =>
      compareText(normalizeSearch(a.artist), normalizeSearch(b.artist))
      || (artworkYear(a.date) ?? Infinity) - (artworkYear(b.date) ?? Infinity)
      || 0
      || compareText(normalizeSearch(a.title), normalizeSearch(b.title))
      || compareText(a.localId, b.localId),
  );
}
