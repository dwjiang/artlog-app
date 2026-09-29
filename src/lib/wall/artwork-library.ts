import type { SavedWork } from "@/db/schema";
import { matchesSearch } from "@/lib/journal/query";
import type { VisitSummary } from "@/lib/journal/visit-summaries";
import { normalizeSearch } from "@/shared/journal/limits";

export type ArtworkSort = "recent" | "title" | "artist";
export type LibraryVisit = Pick<VisitSummary, "localId" | "venueName" | "visitedOn" | "works">;

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
    .sort(
      (a, b) =>
        (sort === "recent"
          ? b.savedAt - a.savedAt
          : a[sort].localeCompare(b[sort], undefined, { sensitivity: "base" })
            || a.title.localeCompare(b.title, undefined, { sensitivity: "base" }))
        || a.localId.localeCompare(b.localId),
    );
}

export function canHangArtwork(work: SavedWork, signedIn: boolean) {
  return work.deletedAt === null && (!signedIn || work.syncedBy !== null);
}
