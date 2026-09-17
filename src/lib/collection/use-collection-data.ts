import { selectArtworkEncounters, selectAllArtworkPhotos } from '@/db/repos/artwork-album';
import { usePendingRemovals } from './pending-removals';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { listSavedWorks } from '@/db/repos/saved-works';
import { listVisits } from '@/db/repos/visits';
import { useLocalOwner } from '../account/owner-store';
import { useVenueMetadata } from '../journal/use-venue-metadata';
import { visitSummaries } from '../journal/visit-summaries';
import { linkedVisitSearchTerms } from './search';

export function useCollectionData() {
  const owner = useLocalOwner();
  const encounters = useLiveQuery(selectArtworkEncounters(owner), [owner]);
  const photos = useLiveQuery(selectAllArtworkPhotos(owner), [owner]);
  const removals = usePendingRemovals();
  const worksQuery = useLiveQuery(listSavedWorks(owner, true), [owner]);
  const visitsQuery = useLiveQuery(listVisits(owner), [owner]);
  const hiddenIds = [...new Set([
    ...worksQuery.data.filter((row) => row.owner === owner && row.deletedAt !== null).map((row) => row.localId),
    ...removals.filter((item) => item.owner === owner && item.status !== 'failed').map((item) => item.localId),
  ])];
  const rows = worksQuery.data.filter((row) => row.owner === owner && !hiddenIds.includes(row.localId));
  const visits = visitsQuery.data.filter((row) => row.owner === owner);
  const { metadata, ready } = useVenueMetadata([...visits.map((row) => row.venueId), ...rows.flatMap((row) => row.venueId ? [row.venueId] : [])], owner);
  const visitTerms = linkedVisitSearchTerms(owner, encounters.data, visits, metadata);
  const works = rows.map((row) => ({ ...row, photoCount: photos.data.filter((photo) => photo.owner === owner && photo.savedLocalId === row.localId).length, visitCount: encounters.data.filter((encounter) => encounter.owner === owner && encounter.savedLocalId === row.localId).length,
    city: row.venueId ? metadata.get(row.venueId)?.city : undefined, visitSearchTerms: visitTerms.get(row.localId) }));
  return { owner, works, hiddenIds, visits: visitSummaries(visits, works, metadata, owner, encounters.data),
    loading: !worksQuery.updatedAt || !visitsQuery.updatedAt || !ready, error: worksQuery.error ?? visitsQuery.error };
}
