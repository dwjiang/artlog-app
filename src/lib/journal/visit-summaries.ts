import type { ArtworkEncounter, SavedWork, Visit } from "@/db/schema";
import { venueLocation } from "../venue/venue-location";
import type { VenueRow } from "../venue/resolve";
import { filterWorks } from "../collection/search";
import { filterVisits, groupHistoryByMonth, placeIdentity } from "./history";

export type VisitSummary = Visit & {
  city?: string | null;
  cityKey?: string | null;
  country?: string | null;
  regionKey?: string;
  regionName?: string;
  coordinates?: { latitude: number; longitude: number };
  location: string;
  works: SavedWork[];
};

export function visitSummaries(
  visits: Visit[],
  works: SavedWork[],
  metadata: Map<string, VenueRow>,
  owner: string,
  encounters: ArtworkEncounter[] = [],
): VisitSummary[] {
  const byVisit = new Map<string, SavedWork[]>();
  for (const encounter of encounters) {
    if (encounter.owner !== owner || encounter.deletedAt !== null) continue;
    const work = works.find(
      (row) =>
        row.owner === owner
        && row.localId === encounter.savedLocalId
        && row.deletedAt === null,
    );
    if (!work) continue;
    const group = byVisit.get(encounter.visitLocalId) ?? [];
    group.push(work);
    byVisit.set(encounter.visitLocalId, group);
  }
  return groupHistoryByMonth(visits.filter((visit) => visit.owner === owner))
    .flatMap((group) => group.data)
    .map((visit) => {
      const venue = metadata.get(visit.venueId);
      const place = venue ? venueLocation(venue) : { location: "" };
      const coordinates =
        venue
        && Number.isFinite(venue.lat)
        && Number.isFinite(venue.lng)
        && Math.abs(venue.lat) <= 90
        && Math.abs(venue.lng) <= 180
          ? { latitude: venue.lat, longitude: venue.lng }
          : undefined;
      return {
        ...visit,
        city: venue?.city,
        cityKey: venue?.cityKey,
        coordinates,
        ...place,
        works: (byVisit.get(visit.localId) ?? []).sort(
          (a, b) => b.savedAt - a.savedAt || a.localId.localeCompare(b.localId),
        ),
      };
    });
}

export function searchVisitSummaries(
  visits: VisitSummary[],
  search: string,
): VisitSummary[] {
  const matches = new Set(
    filterVisits(visits, search).map((visit) => visit.localId),
  );
  return visits.filter(
    (visit) =>
      matches.has(visit.localId) || filterWorks(visit.works, search).length > 0,
  );
}

export function visitCounts(visits: VisitSummary[]) {
  return {
    museums: new Set(visits.map((visit) => visit.venueId)).size,
    visits: visits.length,
  };
}

export function mappedMuseums(visits: VisitSummary[]) {
  const seen = new Set<string>();
  return visits.filter((visit) => {
    if (!visit.coordinates || seen.has(visit.venueId)) return false;
    seen.add(visit.venueId);
    return true;
  });
}

export function visitsAtPlace(visits: VisitSummary[], key: string) {
  return visits.filter((visit) => placeIdentity(visit).key === key);
}
