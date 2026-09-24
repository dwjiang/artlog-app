import { ConvexError } from "convex/values";
import { getLocalOwner } from "../../lib/account/owner-store";
import { filterVisits, summarizeJournal } from "../../lib/journal/history";
import { pageRows, searchTerm, type PageOptions } from "../../lib/journal/query";
import { applyVenueMetadata, openVenueDb, venueMetadataForIds, type VenueMetadata } from "../../lib/venue/venue-db";
import * as visits from "./visits";
import { selectArtworkEncounters } from "./artwork-album";
import { listSavedWorks } from "./saved-works";

export function createJournalRepository(owner = getLocalOwner(), isCurrent = () => true) {
  async function completeHistory() {
    const rows = await visits.listVisits(owner);
    const venues = new Map((await venueMetadataForIds(rows.map((row) => row.venueId))).map((row) => [row.id, row]));
    return rows.map((row) => ({
      ...row,
      city: venues.get(row.venueId)?.city,
      cityKey: venues.get(row.venueId)?.cityKey,
      country: venues.get(row.venueId)?.country,
    }));
  }
  return {
    listUnsyncedVisits: () => visits.listUnsyncedVisits(owner),
    markVisitsSynced: (rows: Parameters<typeof visits.markVisitsSynced>[0]) => visits.markVisitsSynced(rows, owner),
    upsertVisitsFromRemote: (rows: Parameters<typeof visits.upsertVisitsFromRemote>[0]) =>
      visits.upsertVisitsFromRemote(rows, owner),
    async applyVenues(rows: VenueMetadata[]) {
      if (!rows.length || !isCurrent()) return;
      const db = await openVenueDb();
      if (isCurrent()) await applyVenueMetadata(db, rows);
    },
    async detail(localId: string) {
      const visit = await visits.getVisit(localId, owner);
      if (!visit) throw new ConvexError({ code: "not_found" });
      return visit;
    },
    async history(options: PageOptions & { venueId?: string; search?: string } = {}) {
      const rows = filterVisits(
        (await completeHistory()).filter((row) => !options.venueId || row.venueId === options.venueId),
        options.search,
      );
      return pageRows(
        rows,
        (row) => `${row.visitedOn}|${row.localId}`,
        JSON.stringify([owner, "history", options.venueId, searchTerm(options.search)]),
        options,
      );
    },
    async savedWorks(localId: string, options: PageOptions = {}) {
      const visit = await visits.getVisit(localId, owner);
      if (!visit) throw new ConvexError({ code: "not_found" });
      const linked = new Set(
        selectArtworkEncounters(owner)
          .all()
          .filter((row) => row.visitLocalId === localId)
          .map((row) => row.savedLocalId),
      );
      const rows = (await listSavedWorks(owner)).filter((row) => linked.has(row.localId));
      return pageRows(
        rows,
        (row) => `${String(row.savedAt).padStart(16, "0")}|${row.localId}`,
        JSON.stringify([owner, "membership", localId]),
        options,
      );
    },
    async summaries(by: "museum" | "place", options: PageOptions = {}) {
      return pageRows(
        summarizeJournal(await completeHistory(), by),
        (row) => `${row.latestVisitedOn}|${row.key}`,
        JSON.stringify([owner, by]),
        options,
      );
    },
  };
}
export type JournalRepository = ReturnType<typeof createJournalRepository>;
