import type { SavedWork } from "@/db/schema";
import { artworkYear } from "@/lib/collection/search";
import { compareText, matchesSearch } from "@/lib/journal/query";
import type { VisitSummary } from "@/lib/journal/visit-summaries";
import { artistKey } from "@/shared/catalog/text";
import { normalizeSearch } from "@/shared/journal/limits";

export type ArtworkSort = "recent" | "title" | "artist";
export type LibraryVisit = Pick<VisitSummary, "localId" | "venueName" | "visitedOn" | "works">;
type ArtistWork = Pick<SavedWork, "localId" | "artist" | "title" | "date">;

const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "elder", "younger", "the"]);

// Surname first, as museum indexes file artists: "Vincent van Gogh" as "gogh vincent van", "Kahlo, Frida" as
// "kahlo frida". Undefined for a missing or placeholder name.
function filingName(artist: string) {
  if (!artistKey(artist)) return undefined;
  const [lead, ...rest] = artist
    .replaceAll(/\([^)]*\)/g, " ")
    .split(/\s+(?:and|&)\s+|[;/]/)[0]
    .split(",");
  const words = (text = "") =>
    text
      .split(/\s+/)
      .map((word) => normalizeSearch(word).replaceAll(/[^\p{L}\p{N}'’-]/gu, ""))
      .filter(Boolean);
  const name = words(lead);
  while (name.length > 1 && NAME_SUFFIXES.has(name.at(-1)!)) name.pop();
  if (name.length === 0) return undefined;
  // A lone word before a comma is an inverted surname; several are a full name followed by a note such as nationality.
  const given =
    name.length === 1
      ? rest.flatMap((part) => words(part)).filter((word) => !NAME_SUFFIXES.has(word))
      : name.slice(0, -1);
  return [name.at(-1)!, ...given].join(" ");
}

function shelfOf(artist: string) {
  const filed = filingName(artist);
  const letter = filed?.charAt(0).toUpperCase();
  const title = letter && /^[A-Z]$/.test(letter) ? letter : "#";
  // "#" holds names outside A–Z, then unknown artists, after every letter.
  return { filed: filed ?? "", title, rank: filed === undefined ? 2 : title === "#" ? 1 : 0 };
}

function compareByArtist(a: ArtistWork, b: ArtistWork) {
  const [left, right] = [shelfOf(a.artist), shelfOf(b.artist)];
  return (
    left.rank - right.rank
    || compareText(left.filed, right.filed)
    || (artworkYear(a.date) ?? Infinity) - (artworkYear(b.date) ?? Infinity)
    || compareText(normalizeSearch(a.title), normalizeSearch(b.title))
    || compareText(a.localId, b.localId)
  );
}

/**
 * Works by artist surname, under letter headings once the sections would fill a grid row of `columns` on average;
 * a smaller collection stays one untitled section, so lone tiles don't leave rows half empty.
 */
export function sectionWorksByArtist<T extends ArtistWork>(works: T[], columns: number) {
  const sorted = [...works].sort(compareByArtist);
  const sections = new Map<string, T[]>();
  for (const work of sorted) {
    const { title } = shelfOf(work.artist);
    sections.set(title, [...(sections.get(title) ?? []), work]);
  }
  if (sections.size < 2 || sorted.length < sections.size * columns) {
    return [{ key: "all", title: undefined, data: sorted }];
  }
  return [...sections].map(([title, data]) => ({ key: title, title, data }));
}

export function libraryArtworks(
  works: SavedWork[],
  {
    search,
    sort,
    visit,
    notOnWall,
    hungIds,
  }: {
    search: string;
    sort: ArtworkSort;
    visit?: LibraryVisit;
    notOnWall: boolean;
    hungIds: Set<string>;
  },
) {
  const term = normalizeSearch(search);
  const visitIds = visit && new Set(visit.works.map((work) => work.localId));
  return works
    .filter(
      (work) =>
        work.deletedAt === null
        && (!notOnWall || !hungIds.has(work.localId))
        && (!visit || visitIds!.has(work.localId) || work.visitLocalId === visit.localId)
        && (!term || matchesSearch([work.title, work.artist], term)),
    )
    .sort((a, b) =>
      sort === "artist"
        ? compareByArtist(a, b)
        : (sort === "recent"
            ? b.savedAt - a.savedAt
            : a.title.localeCompare(b.title, undefined, { sensitivity: "base" })) || a.localId.localeCompare(b.localId),
    );
}

export function canHangArtwork(work: SavedWork, signedIn: boolean) {
  return work.deletedAt === null && (!signedIn || work.syncedBy !== null);
}
