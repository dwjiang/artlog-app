import { useEffect } from "react";
import { reportError } from "@/lib/observability";
import { selectArtworkEncounters } from "@/db/repos/artwork-album";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { listVisits } from "@/db/repos/visits";
import { listSavedWorks } from "@/db/repos/saved-works";
import { useLocalOwner } from "../account/owner-store";
import { useRemovedWorkIds } from "../collection/pending-removals";
import { useVenueMetadata } from "./use-venue-metadata";
import { visitSummaries } from "./visit-summaries";

export function useVisits() {
  const owner = useLocalOwner();
  const removedIds = useRemovedWorkIds(owner);
  const encounters = useLiveQuery(selectArtworkEncounters(owner), [owner]);
  const visits = useLiveQuery(listVisits(owner), [owner]);
  const works = useLiveQuery(listSavedWorks(owner), [owner]);
  const { metadata, ready } = useVenueMetadata(
    visits.data
      .filter((visit) => visit.owner === owner)
      .map((visit) => visit.venueId),
    owner,
  );
  const error = visits.error ?? works.error ?? encounters.error;
  useEffect(() => {
    if (error) reportError(error, "journal.visits.load");
  }, [error]);
  return {
    owner,
    visits: visitSummaries(
      visits.data,
      works.data.filter((work) => !removedIds.includes(work.localId)),
      metadata,
      owner,
      encounters.data,
    ),
    loading:
      !error
      && (!visits.updatedAt
        || !works.updatedAt
        || !encounters.updatedAt
        || !ready),
    error,
  };
}
